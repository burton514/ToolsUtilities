"""audio_vocals_leap_xe — tách giọng hát và nhạc nền bằng BS-RoFormer Leap Xe (pcunwa/BS-Roformer-Leap, thư mục Xe/).

Model BS-RoFormer chuyên giọng hát (dim 256, 16 lớp, ~67 triệu tham số), học trên đoạn 20 giây. Chạy bằng
`mediatool_sdk.bs_roformer` (numpy + onnxruntime, không cần PyTorch) — đã đối chiếu với code gốc ZFTurbo: sai khác
~65 dB SNR (chỉ là sai số làm tròn float32).

Chạy cả bài như `demix` của ZFTurbo/Music-Source-Separation-Training: đoạn 881 559 mẫu (20 s), cửa sổ mờ dần 10% hai mép,
đệm phản chiếu hai đầu bài; `quality = best` chồng 50% (num_overlap = 2 như cấu hình gốc), `standard` chỉ chồng đúng phần
mờ dần (mỗi mẫu chạy ~1,1 lần). Bộ đệm chỉ một đoạn → RAM không tăng theo độ dài bài.

Nhạc nền: `subtract` = bài gốc − giọng (giữ trọn mọi thứ không phải giọng), `model` = chạy thêm model nhạc nền riêng của
Leap Xe (`bs_leap_xe_inst.ckpt`, cùng kiến trúc) — sạch giọng hơn, lâu gấp đôi.
"""
from __future__ import annotations

import importlib.util
import math
from typing import Literal

from pydantic import BaseModel, Field

from mediatool_sdk import AudioFile, BaseTool, Context, Estimate, MediaFile, Result, ToolError

SR = 44100
CHUNK = 881_559                     # audio.chunk_size trong Xe/leap_xe_config_voc.yaml (20 s)
FADE = CHUNK // 10
# model.freqs_per_bands trong Xe/leap_xe_config_voc.yaml (và _inst.yaml, giống hệt) — 90 băng, tổng 1025 bin STFT
BANDS = (2,) * 24 + (4,) * 36 + (12,) * 16 + (24,) * 8 + (48,) * 4 + (128, 129)
SEC_PER_CHUNK = 84.0                # đo: bài 60 s (4 đoạn 20 s) mất 336 s trên CPU 6 nhân (i5-11400H), một model
QUALITY_LABELS = {"standard": "Chuẩn (nối đoạn mờ dần, nhanh gấp đôi)", "best": "Kỹ nhất (chồng 50% như cấu hình gốc)"}


def step_for(quality: str) -> int:
    return CHUNK // 2 if quality == "best" else CHUNK - FADE


def n_chunks(length: int, step: int) -> int:
    border = CHUNK - step
    padded = length + 2 * border if (length > 2 * border and border > 0) else length
    return max(1, math.ceil(padded / step))


class Inputs(BaseModel):
    media: MediaFile = Field(description="Bài hát: file nhạc hoặc video có tiếng (MV)")


class Params(BaseModel):
    instrumental: Literal["subtract", "model"] = Field(
        "subtract", description="Cách lấy nhạc nền: bài gốc trừ giọng (nhanh) hoặc chạy thêm model nhạc nền riêng (sạch giọng hơn, lâu gấp đôi)",
        json_schema_extra={"x-labels": {"subtract": "Bài gốc − giọng (nhanh)", "model": "Model nhạc nền riêng (sạch hơn, ×2 thời gian)"}})
    quality: Literal["standard", "best"] = Field(
        "standard", description="Độ chồng giữa các đoạn 20 giây: chồng nhiều chỗ nối mượt hơn một chút nhưng chạy lâu gấp đôi",
        json_schema_extra={"x-labels": QUALITY_LABELS})
    format: Literal["wav", "flac", "mp3"] = Field(
        "wav", description="Định dạng file xuất: wav (không nén), flac (nén không mất chất lượng), mp3 (nhẹ nhất)",
        json_schema_extra={"x-labels": {"wav": "WAV", "flac": "FLAC", "mp3": "MP3 320 kbps"}})


class Outputs(BaseModel):
    vocals: AudioFile = Field(description="Giọng hát đã tách — dùng cho căn lời (lyrics_align), chép lời")
    instrumental: AudioFile = Field(description="Nhạc nền không lời — dùng làm nhạc karaoke")


class VocalsLeapXeTool(BaseTool[Inputs, Params, Outputs]):
    def check(self, ctx: Context) -> None:
        ctx.require_binary("ffmpeg")
        for pkg in ("numpy", "onnxruntime", "onnx"):
            if importlib.util.find_spec(pkg) is None:
                raise ToolError("MISSING_PACKAGE", f"Máy chạy tool chưa cài {pkg} (pip install {pkg})")

    def validate(self, inputs: Inputs, params: Params, ctx: Context) -> None:
        ctx.guards.max_duration("media", inputs.media, 3 * 3600)
        d = inputs.media.duration_s or 600
        ctx.guards.free_disk(int(d * SR * (8 + 4 * 2) * 1.1))   # PCM float32 tạm + 2 WAV 16-bit

    def estimate(self, inputs: Inputs, params: Params) -> Estimate:
        d = inputs.media.duration_s or 240
        models = 2 if params.instrumental == "model" else 1
        return Estimate(ram_mb=1700 + 400 * (models - 1),
                        seconds=n_chunks(int(d * SR), step_for(params.quality)) * SEC_PER_CHUNK * models + 10)

    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        import numpy as np  # import nặng: chỉ khi chạy

        from mediatool_sdk.bs_roformer import BSRoformer
        from mediatool_sdk.stems import decode_stereo, duration_text, finish, separate_roformer, vocal_ratio

        pcm = decode_stereo(ctx, inputs.media.path, inputs.media.duration_s)
        total = pcm.shape[0]
        ctx.progress(0.05, "Đang nạp model BS-RoFormer Leap Xe")
        voc = BSRoformer(str(ctx.models.get("leap_xe_vocals")), BANDS, gpu=ctx.device.startswith("cuda"), ctx=ctx)
        inst = BSRoformer(str(ctx.models.get("leap_xe_instrumental")), BANDS, gpu=voc.on_gpu) if params.instrumental == "model" else None

        def infer(x):
            v = voc(x, cancel=ctx.check_cancelled)[0]
            i = inst(x, cancel=ctx.check_cancelled)[0] if inst else x - v
            return np.stack([v, i])

        wavs = {k: ctx.workdir / f"{k}.wav" for k in ("vocals", "instrumental")}
        try:
            sink = separate_roformer(ctx, pcm, CHUNK, step_for(params.quality), infer, ["vocals", "instrumental"], wavs,
                                     message="Đang tách giọng")
        finally:
            del pcm
        (ctx.workdir / "mix.f32").unlink(missing_ok=True)

        length = total / SR
        out = finish(ctx, wavs, params.format, length)
        warnings = []
        ratio = vocal_ratio(sink.energy)
        if ratio < 0.01:
            warnings.append("Gần như không thấy giọng hát trong bài (bản nhạc không lời?) — file giọng hát gần như im lặng")
        how = "model nhạc nền riêng" if inst else "bài gốc − giọng"
        return Result(outputs=Outputs(**out), warnings=warnings,
                      summary=f"Đã tách giọng hát + nhạc nền ({how}) từ bài dài {duration_text(length)} bằng BS-RoFormer Leap Xe{' (GPU)' if voc.on_gpu else ''} · "
                              f"giọng chiếm {ratio * 100:.0f}% năng lượng")

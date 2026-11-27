"""audio_stems6_sw — tách bài hát thành 6 phần (giọng, trống, bass, guitar, piano, khác) bằng BS-RoFormer SW.

Model BS-RoFormer "SW" 6 stem (dim 256, 12 lớp, ~175 triệu tham số — phần lớn là 6 bộ ước lượng mặt nạ), học trên đoạn
588 800 mẫu (13,35 s). Bản checkpoint "BS-Rofo-SW-Fixed" gốc của jarredou; tài khoản gốc đã xóa nên tải từ bản sao
nguyên vẹn koidn/BS-RoFormer-SW-6stem (sha256 trùng với SHA256SUMS của bản sao). Chạy bằng `mediatool_sdk.bs_roformer`
(numpy + onnxruntime, không cần PyTorch) — đối chiếu với code gốc ZFTurbo: sai khác ~130 dB SNR.

Chạy cả bài như `demix` của ZFTurbo (xem `mediatool_sdk.stems.separate_roformer`). Nhạc nền = tổng 5 phần không phải giọng.
"""
from __future__ import annotations

import importlib.util
import math
from typing import Literal

from pydantic import BaseModel, Field

from mediatool_sdk import AudioFile, BaseTool, Context, Estimate, MediaFile, Result, ToolError

SR = 44100
CHUNK = 588_800                     # audio.chunk_size trong BS-Rofo-SW-Fixed.yaml (13,35 s)
FADE = CHUNK // 10
SOURCES = ("bass", "drums", "other", "vocals", "guitar", "piano")   # training.instruments — đúng thứ tự mặt nạ trong model
# model.freqs_per_bands trong BS-Rofo-SW-Fixed.yaml — 62 băng, tổng 1025 bin STFT
BANDS = (2,) * 24 + (4,) * 12 + (12,) * 8 + (24,) * 8 + (48,) * 8 + (128, 129)
SEC_PER_CHUNK = 28.0                # đo: bài 60 s (6 đoạn 13,35 s) mất 165 s trên CPU 6 nhân (i5-11400H)
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
    quality: Literal["standard", "best"] = Field(
        "standard", description="Độ chồng giữa các đoạn 13 giây: chồng nhiều chỗ nối mượt hơn một chút nhưng chạy lâu gấp đôi",
        json_schema_extra={"x-labels": QUALITY_LABELS})
    format: Literal["wav", "flac", "mp3"] = Field(
        "wav", description="Định dạng file xuất: wav (không nén), flac (nén không mất chất lượng), mp3 (nhẹ nhất)",
        json_schema_extra={"x-labels": {"wav": "WAV", "flac": "FLAC", "mp3": "MP3 320 kbps"}})


class Outputs(BaseModel):
    vocals: AudioFile = Field(description="Giọng hát — dùng cho căn lời (lyrics_align), chép lời")
    instrumental: AudioFile = Field(description="Nhạc nền không lời (tổng 5 phần nhạc cụ) — dùng làm nhạc karaoke")
    drums: AudioFile = Field(description="Trống")
    bass: AudioFile = Field(description="Bass")
    guitar: AudioFile = Field(description="Guitar")
    piano: AudioFile = Field(description="Piano / phím")
    other: AudioFile = Field(description="Nhạc cụ khác: dây, kèn, synth, hiệu ứng…")


class Stems6SWTool(BaseTool[Inputs, Params, Outputs]):
    def check(self, ctx: Context) -> None:
        ctx.require_binary("ffmpeg")
        for pkg in ("numpy", "onnxruntime", "onnx"):
            if importlib.util.find_spec(pkg) is None:
                raise ToolError("MISSING_PACKAGE", f"Máy chạy tool chưa cài {pkg} (pip install {pkg})")

    def validate(self, inputs: Inputs, params: Params, ctx: Context) -> None:
        ctx.guards.max_duration("media", inputs.media, 3 * 3600)
        d = inputs.media.duration_s or 600
        ctx.guards.free_disk(int(d * SR * (8 + 4 * 7) * 1.1))   # PCM float32 tạm + 7 WAV 16-bit

    def estimate(self, inputs: Inputs, params: Params) -> Estimate:
        d = inputs.media.duration_s or 240
        return Estimate(ram_mb=2300, seconds=n_chunks(int(d * SR), step_for(params.quality)) * SEC_PER_CHUNK + 15)

    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        from mediatool_sdk.bs_roformer import BSRoformer  # import nặng: chỉ khi chạy
        from mediatool_sdk.stems import decode_stereo, duration_text, finish, separate_roformer, vocal_ratio

        pcm = decode_stereo(ctx, inputs.media.path, inputs.media.duration_s)
        total = pcm.shape[0]
        ctx.progress(0.05, "Đang nạp model BS-RoFormer SW")
        model = BSRoformer(str(ctx.models.get("bs_roformer_sw")), BANDS, gpu=ctx.device.startswith("cuda"), ctx=ctx)
        if model.n_stems != len(SOURCES):
            raise ToolError("MODEL_UNAVAILABLE", f"Checkpoint có {model.n_stems} phần, cần {len(SOURCES)}")

        wavs = {k: ctx.workdir / f"{k}.wav" for k in ("vocals", "instrumental", "drums", "bass", "guitar", "piano", "other")}
        try:
            sink = separate_roformer(ctx, pcm, CHUNK, step_for(params.quality),
                                     lambda x: model(x, cancel=ctx.check_cancelled), SOURCES, wavs,
                                     {"instrumental": [s for s in SOURCES if s != "vocals"]}, message="Đang tách 6 phần")
        finally:
            del pcm
        (ctx.workdir / "mix.f32").unlink(missing_ok=True)

        length = total / SR
        out = finish(ctx, wavs, params.format, length)
        warnings = []
        ratio = vocal_ratio(sink.energy)
        if ratio < 0.01:
            warnings.append("Gần như không thấy giọng hát trong bài (bản nhạc không lời?) — file giọng hát gần như im lặng")
        inst = sum(sink.energy.get(s, 0.0) for s in SOURCES if s != "vocals") or 1.0
        share = ", ".join(f"{n} {sink.energy.get(s, 0.0) / inst * 100:.0f}%"
                          for s, n in (("drums", "trống"), ("bass", "bass"), ("guitar", "guitar"), ("piano", "piano"), ("other", "khác")))
        return Result(outputs=Outputs(**out), warnings=warnings,
                      summary=f"Đã tách 6 phần từ bài dài {duration_text(length)} bằng BS-RoFormer SW{' (GPU)' if model.on_gpu else ''} · giọng chiếm "
                              f"{ratio * 100:.0f}% năng lượng; nhạc nền: {share}")

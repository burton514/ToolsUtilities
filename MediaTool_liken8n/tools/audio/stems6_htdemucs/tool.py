"""audio_stems6_htdemucs — tách bài hát thành 6 phần (giọng, trống, bass, guitar, piano, khác) bằng HTDemucs 6s, nhẹ máy.

HT-Demucs v4 bản 6 nguồn (`htdemucs_6s`, Meta, MIT) xuất ONNX một file (StemSplitio/htdemucs-6s-onnx, MIT): nhận đoạn
stereo 44,1 kHz dài cố định 7,8 giây (343 980 mẫu), trả [drums, bass, other, vocals, guitar, piano]. STFT / iSTFT nằm trong
model nên chỉ cần numpy + onnxruntime.

Chạy cả bài như `demucs.apply`: chuẩn hóa theo kênh mono của cả bài (trừ trung bình, chia độ lệch chuẩn — như CLI demucs),
các đoạn chồng `overlap` (mặc định 25%), trộn bằng trọng số tam giác; bộ đệm chỉ một đoạn → RAM không tăng theo độ dài bài.
Nhạc nền = tổng 5 phần không phải giọng (giống `demucs --two-stems vocals`).
"""
from __future__ import annotations

import importlib.util
import math
from typing import Literal

from pydantic import BaseModel, Field

from mediatool_sdk import AudioFile, BaseTool, Context, Estimate, MediaFile, Result, ToolError

SR = 44100
SEGMENT = 343_980                   # 7,8 giây — độ dài đoạn cố định của bản ONNX
SOURCES = ("drums", "bass", "other", "vocals", "guitar", "piano")
OVERLAP = {"standard": 0.25, "best": 0.5}
QUALITY_LABELS = {"standard": "Chuẩn (chồng 25% như demucs)", "best": "Kỹ nhất (chồng 50%, lâu gấp rưỡi)"}
SEC_PER_CHUNK = 4.5                 # đo: bài 60 s (10 đoạn 7,8 s) mất 41 s trên CPU 6 nhân (i5-11400H)


def mix_stats(np, pcm, block: int = SR * 30) -> tuple[float, float]:
    """Trung bình và độ lệch chuẩn của kênh mono (L+R)/2, tính từng khối để không nạp cả bài."""
    n = pcm.shape[0]
    s = s2 = 0.0
    for a in range(0, n, block):
        m = pcm[a:a + block].mean(axis=1, dtype=np.float64)
        s += float(m.sum())
        s2 += float((m * m).sum())
    mean = s / max(n, 1)
    var = max(0.0, s2 / max(n, 1) - mean * mean)
    return mean, float(np.sqrt(var)) or 1.0


def chunk_starts(total: int, overlap: float) -> list[int]:
    stride = max(1, int(SEGMENT * (1 - overlap)))
    return list(range(0, max(total, 1), stride))


class Inputs(BaseModel):
    media: MediaFile = Field(description="Bài hát: file nhạc hoặc video có tiếng (MV)")


class Params(BaseModel):
    quality: Literal["standard", "best"] = Field(
        "standard", description="Độ chồng giữa các đoạn 7,8 giây: chồng nhiều chỗ nối mượt hơn nhưng chạy lâu hơn",
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


class Stems6HTDemucsTool(BaseTool[Inputs, Params, Outputs]):
    def check(self, ctx: Context) -> None:
        ctx.require_binary("ffmpeg")
        for pkg in ("numpy", "onnxruntime"):
            if importlib.util.find_spec(pkg) is None:
                raise ToolError("MISSING_PACKAGE", f"Máy chạy tool chưa cài {pkg} (pip install {pkg})")

    def validate(self, inputs: Inputs, params: Params, ctx: Context) -> None:
        ctx.guards.max_duration("media", inputs.media, 3 * 3600)
        d = inputs.media.duration_s or 600
        ctx.guards.free_disk(int(d * SR * (8 + 4 * 7) * 1.1))   # PCM float32 tạm + 7 WAV 16-bit

    def estimate(self, inputs: Inputs, params: Params) -> Estimate:
        d = inputs.media.duration_s or 240
        return Estimate(ram_mb=1300, seconds=len(chunk_starts(int(d * SR), OVERLAP[params.quality])) * SEC_PER_CHUNK + 10)

    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        import numpy as np  # import nặng: chỉ khi chạy
        import onnxruntime as ort

        from mediatool_sdk.device import ort_session
        from mediatool_sdk.stems import StemWriter, decode_stereo, duration_text, finish, overlap_add, triangle_weight, vocal_ratio

        pcm = decode_stereo(ctx, inputs.media.path, inputs.media.duration_s)
        total = pcm.shape[0]
        ctx.progress(0.05, "Đang nạp model HTDemucs 6s")
        opts = ort.SessionOptions()
        # Tối ưu đồ thị làm phình trọng số fp16 → fp32 nhiều lần (RAM vài GB); tắt đi RAM ~1 GB, tốc độ gần như cũ.
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        opts.enable_cpu_mem_arena = False
        opts.enable_mem_pattern = False
        sess, on_gpu = ort_session(ctx.models.get("htdemucs_6s"), opts, ctx, gpu=ctx.device.startswith("cuda"))

        mean, std = mix_stats(np, pcm)
        starts = chunk_starts(total, OVERLAP[params.quality])
        weight = triangle_weight(SEGMENT)

        def read(a: int, n: int):
            return ((np.asarray(pcm[a:a + n]) - mean) / std).T

        def infer(x):
            ctx.check_cancelled()
            return sess.run(["stems"], {"mix": x[None]})[0][0] * std + mean

        wavs = {k: ctx.workdir / f"{k}.wav" for k in ("vocals", "instrumental", "drums", "bass", "guitar", "piano", "other")}
        sink = StemWriter(SOURCES, wavs, {"instrumental": [s for s in SOURCES if s != "vocals"]})
        try:
            overlap_add(read, total, SEGMENT, starts, infer, lambda k: weight, sink,
                        lambda f: ctx.progress(0.08 + 0.85 * f, f"Đang tách 6 phần (xong {round(f * len(starts))}/{len(starts)} đoạn)"))
        finally:
            sink.close()
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
                      summary=f"Đã tách 6 phần từ bài dài {duration_text(length)} bằng HTDemucs 6s{' (GPU)' if on_gpu else ''} · giọng chiếm "
                              f"{ratio * 100:.0f}% năng lượng; nhạc nền: {share}")

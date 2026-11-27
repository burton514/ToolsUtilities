"""speech_zipformer_30m — chép lời nói tiếng Việt bằng ZipFormer-30M của hynt (repo hynt/Zipformer-30M-RNNT-6000h).

Nguồn: https://huggingface.co/hynt/Zipformer-30M-RNNT-6000h — ZipFormer 30 triệu tham số, RNN-Transducer, học trên ~6.000 giờ
tiếng Việt; kiến trúc này giành giải nhất VLSP 2025. Lỗi từ (WER) 8–12% trên các bộ VLSP 2020–2025.
Ưu điểm: rất nhẹ (32 MB) và rất nhanh trên CPU (12 s âm thanh ~0,3 s) — hợp máy yếu, VPS, file dài.
License CC-BY-NC-ND-4.0: chỉ dùng phi thương mại (thay thế thương mại: speech_transcribe).

Toàn bộ xử lý (cắt đoạn, nhận dạng sherpa-onnx, thời gian từng từ, tách câu, ghi output) ở `mediatool_sdk.asr` — chung với
speech_zipformer_150m; output giống speech_transcribe nên thay thế cho nhau được trong mọi chuỗi.
"""
from __future__ import annotations

import importlib.util

from pydantic import BaseModel, Field

from mediatool_sdk import BaseTool, Context, MediaFile, Result, SubtitleFile, TextFile, ToolError, Transcript
from mediatool_sdk import asr

MODEL = "zipformer_30m_vi"


class Inputs(BaseModel):
    media: MediaFile = Field(description="Video hoặc audio có người nói tiếng Việt")


class Params(BaseModel):
    max_chars: int = Field(0, ge=0, le=120, description="Số ký tự tối đa mỗi dòng phụ đề; 0 = theo câu. Video dọc nên 16–24")


class Outputs(BaseModel):
    subtitle: SubtitleFile = Field(description="Phụ đề .srt")
    text: TextFile = Field(description="Lời chép thuần (.txt, mỗi câu một dòng)")
    transcript: Transcript = Field(description="Lời kèm thời gian từng dòng và từng từ (JSON) — cho compose_bind, speech_dub")


class ZipFormer30MTool(BaseTool[Inputs, Params, Outputs]):
    def check(self, ctx: Context) -> None:
        ctx.require_binary("ffmpeg")
        if importlib.util.find_spec("sherpa_onnx") is None:
            raise ToolError("MISSING_PACKAGE", "Máy chạy tool chưa cài sherpa-onnx (pip install sherpa-onnx)")

    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        items, dur, n = asr.run_zipformer(ctx, inputs.media.path, MODEL, params.max_chars)
        srt, txt, tr = asr.write_outputs(ctx.workdir, items, {"language": "vi", "duration": round(dur, 3), "model": MODEL})
        n_words = sum(len(i.get("children", [])) for i in items)
        return Result(outputs=Outputs(subtitle=srt, text=txt, transcript=tr),
                      summary=f"Đã chép {len(items)} dòng, {n_words} từ (ZipFormer-30M, {n} đoạn)")

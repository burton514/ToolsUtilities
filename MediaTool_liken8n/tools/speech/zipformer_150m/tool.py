"""speech_zipformer_150m — chép lời nói tiếng Việt bằng ZipFormer-150M của hynt (repo hynt/ZipFormer-150M-CR-CTC-RNNT-6000h).

Nguồn: https://huggingface.co/hynt/ZipFormer-150M-CR-CTC-RNNT-6000h — ZipFormer 153 triệu tham số, huấn luyện kết hợp
CR-CTC + CTC + RNN-T trên ~6.000 giờ tiếng Việt. Lỗi từ (WER) 6–8% trên VLSP 2023–2025 — chính xác nhất trong các model
tiếng Việt mở hiện có (hơn ZipFormer-30M, PhoWhisper-large, ChunkFormer).
Ưu điểm: độ chính xác cao nhất, nhất là tin tức / phỏng vấn / bài giảng; vẫn chạy được trên CPU (12 s âm thanh ~1 s).
Đổi lại: model 160 MB, chậm hơn bản 30M khoảng 3 lần, RAM cao hơn.
License CC-BY-NC-ND-4.0: chỉ dùng phi thương mại (thay thế thương mại: speech_transcribe).

Toàn bộ xử lý ở `mediatool_sdk.asr` — chung với speech_zipformer_30m; output giống speech_transcribe.
"""
from __future__ import annotations

import importlib.util

from pydantic import BaseModel, Field

from mediatool_sdk import BaseTool, Context, MediaFile, Result, SubtitleFile, TextFile, ToolError, Transcript
from mediatool_sdk import asr

MODEL = "zipformer_150m_vi"


class Inputs(BaseModel):
    media: MediaFile = Field(description="Video hoặc audio có người nói tiếng Việt")


class Params(BaseModel):
    max_chars: int = Field(0, ge=0, le=120, description="Số ký tự tối đa mỗi dòng phụ đề; 0 = theo câu. Video dọc nên 16–24")


class Outputs(BaseModel):
    subtitle: SubtitleFile = Field(description="Phụ đề .srt")
    text: TextFile = Field(description="Lời chép thuần (.txt, mỗi câu một dòng)")
    transcript: Transcript = Field(description="Lời kèm thời gian từng dòng và từng từ (JSON) — cho compose_bind, speech_dub")


class ZipFormer150MTool(BaseTool[Inputs, Params, Outputs]):
    def check(self, ctx: Context) -> None:
        ctx.require_binary("ffmpeg")
        if importlib.util.find_spec("sherpa_onnx") is None:
            raise ToolError("MISSING_PACKAGE", "Máy chạy tool chưa cài sherpa-onnx (pip install sherpa-onnx)")

    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        items, dur, n = asr.run_zipformer(ctx, inputs.media.path, MODEL, params.max_chars)
        srt, txt, tr = asr.write_outputs(ctx.workdir, items, {"language": "vi", "duration": round(dur, 3), "model": MODEL})
        n_words = sum(len(i.get("children", [])) for i in items)
        return Result(outputs=Outputs(subtitle=srt, text=txt, transcript=tr),
                      summary=f"Đã chép {len(items)} dòng, {n_words} từ (ZipFormer-150M, {n} đoạn)")

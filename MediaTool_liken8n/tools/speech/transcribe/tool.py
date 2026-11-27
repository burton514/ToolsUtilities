"""speech_transcribe — chép lời nói trong video / audio thành phụ đề có thời gian từng từ (chạy trên máy).

Một tool cho mọi ngôn ngữ; model chọn theo ngôn ngữ trong bảng `ENGINES` (thêm ngôn ngữ = thêm một dòng, không sửa code):
- tiếng Việt → PhoWhisper (VinAI, Whisper tinh chỉnh trên 844 giờ tiếng Việt) — Whisper gốc chép tiếng Việt sai nhiều;
- tiếng Anh và ngoại ngữ khác → Whisper (OpenAI).
Cả hai chạy trên faster-whisper (CTranslate2, int8 trên CPU) nên cùng một đường xử lý: ffmpeg giải mã về 16 kHz mono,
VAD bỏ đoạn im lặng, lấy thời gian từng từ. Đoạn quá dài (model chép cả 20–30 giây một lèo, ít dấu câu) được tách thành
câu tại chỗ ngắt hơi dài nhất (`timed.split_pauses`), rồi cắt dòng ngắn nếu cần (`timed.split_lines`).

Kết quả: `subtitle` (.srt), `text` (.txt) và `transcript` (TimedData: items = dòng, children = từ) — đúng định dạng mà
`mediatool_sdk.timed` / `compose_bind` / `speech_dub` đọc, nên nối thẳng vào chuỗi.
"""
from __future__ import annotations

import importlib.util
from typing import Any, Literal

from pydantic import BaseModel, Field

from mediatool_sdk import BaseTool, Context, MediaFile, Result, SubtitleFile, TextFile, ToolError, Transcript
from mediatool_sdk import asr, timed

# ngôn ngữ → {mức: model}; ngôn ngữ không có dòng riêng dùng "*" (Whisper đa ngôn ngữ)
ENGINES: dict[str, dict[str, str]] = {
    "vi": {"base": "phowhisper_small", "small": "phowhisper_medium"},
    "*": {"base": "whisper_base", "small": "whisper_small"},
}
LANGS = {
    "vi": "Tiếng Việt", "en": "Tiếng Anh", "zh": "Tiếng Trung", "ja": "Tiếng Nhật", "ko": "Tiếng Hàn",
    "th": "Tiếng Thái", "fr": "Tiếng Pháp", "de": "Tiếng Đức", "es": "Tiếng Tây Ban Nha",
}


def model_id(language: str, level: str) -> str:
    return ENGINES.get(language, ENGINES["*"])[level]


def hallucinated(duration: float, avg_logprob: float, no_speech_prob: float, word_probs: list[float]) -> bool:
    """Đoạn "tưởng tượng" của Whisper / PhoWhisper (hay gặp ở mép đoạn gần im lặng): quá ngắn để có một từ (< 0,2 s);
    hoặc 1–2 từ với độ tin cậy thấp; hoặc luật gốc của Whisper (nhiều khả năng không có tiếng nói + logprob thấp).
    Ngưỡng đo trên dữ liệu thật: câu thật ~0,9 / từ, mẩu ma 0,02–0,6 / từ."""
    if duration < 0.2:
        return True
    if no_speech_prob > 0.6 and avg_logprob < -1.0:
        return True
    mean = sum(word_probs) / len(word_probs) if word_probs else 0.0
    return len(word_probs) <= 2 and mean < 0.65 and avg_logprob < -0.5


class Inputs(BaseModel):
    media: MediaFile = Field(description="Video hoặc audio có người nói")


class Params(BaseModel):
    language: Literal["vi", "en", "zh", "ja", "ko", "th", "fr", "de", "es"] = Field(
        "vi", description="Ngôn ngữ đang nói — chọn đúng để dùng model hợp với ngôn ngữ đó", json_schema_extra={"x-labels": LANGS})
    model: Literal["base", "small"] = Field("base", description="Mức nhận dạng", json_schema_extra={"x-labels": {
        "base": "Nhanh (tiếng Việt 240 MB · ngôn ngữ khác 145 MB)",
        "small": "Chính xác hơn, chậm hơn (tiếng Việt 1,5 GB · ngôn ngữ khác 465 MB)"}})
    max_chars: int = Field(0, ge=0, le=120, description="Số ký tự tối đa mỗi dòng phụ đề; 0 = theo câu. Video dọc nên 16–24")
    prompt: str = Field("", max_length=300, description="Gợi ý từ ngữ (tên riêng, thuật ngữ) để nhận dạng đúng hơn; có thể bỏ trống")


class Outputs(BaseModel):
    subtitle: SubtitleFile = Field(description="Phụ đề .srt")
    text: TextFile = Field(description="Lời chép thuần (.txt, mỗi câu một dòng) — sửa dễ, đưa vào tool đọc văn bản")
    transcript: Transcript = Field(description="Lời kèm thời gian từng dòng và từng từ (JSON) — cho compose_bind kiểu TikTok / karaoke, speech_dub")


class SpeechTranscribeTool(BaseTool[Inputs, Params, Outputs]):
    def check(self, ctx: Context) -> None:
        ctx.require_binary("ffmpeg")
        if importlib.util.find_spec("faster_whisper") is None:
            raise ToolError("MISSING_PACKAGE", "Máy chạy tool chưa cài faster-whisper (pip install faster-whisper)")

    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        import numpy as np  # import nặng: chỉ khi chạy
        from faster_whisper import WhisperModel

        raw = ctx.workdir / "audio.f32"
        total = inputs.media.duration_s
        ctx.ffmpeg(["-y", "-i", str(inputs.media.path), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", str(raw)],
                   total_seconds=total, progress_range=(0.0, 0.05), message="Đang tách âm thanh")
        if not raw.is_file() or raw.stat().st_size < 16000 * 4 * 0.2:
            raise ToolError("NO_AUDIO", "File không có tiếng để nhận dạng")
        audio = np.fromfile(raw, dtype=np.float32)  # 16 kHz mono; ffmpeg giải mã thay cho PyAV

        mid = model_id(params.language, params.model)
        ctx.progress(0.05, "Đang chuẩn bị model nhận dạng")
        model_dir = ctx.models.get(mid)
        gpu = ctx.device.startswith("cuda")
        model = WhisperModel(str(model_dir), device="cuda" if gpu else "cpu", compute_type="float16" if gpu else "int8")
        opts = dict(language=params.language, task="transcribe", word_timestamps=True, beam_size=5,
                    initial_prompt=params.prompt or None, condition_on_previous_text=False)
        segments, info = model.transcribe(audio, vad_filter=True, vad_parameters={"min_silence_duration_ms": 500}, **opts)
        if asr.looks_like_music(audio, info.duration_after_vad, info.duration):
            # bộ lọc tiếng nói (Silero VAD) coi giọng HÁT lẫn nhạc là "không phải tiếng nói" → nghe cả file
            ctx.log.warning("File có vẻ là bài hát / có nhạc nền to: đang nghe cả file. Lời bài hát chép tự động hay sai — "
                            "có lời sẵn thì dùng tool 'Căn lời bài hát theo nhạc' (lyrics_align) để có thời gian chính xác")
            segments, info = model.transcribe(audio, vad_filter=False, **opts)
        dur = info.duration or total or 1.0
        ctx.progress(0.1, "Đang nghe và chép lời")
        items: list[dict[str, Any]] = []
        dropped = 0
        for s in segments:  # generator: nhận dạng chạy dần theo từng đoạn
            ctx.check_cancelled()
            if hallucinated(s.end - s.start, s.avg_logprob, s.no_speech_prob, [w.probability for w in (s.words or [])]):
                dropped += 1
                continue
            words = [{"start": round(w.start, 3), "end": round(w.end, 3), "text": w.word.strip()}
                     for w in (s.words or []) if w.word.strip()]
            item: dict[str, Any] = {"start": round(s.start, 3), "end": round(s.end, 3), "text": " ".join(s.text.split())}
            if words:
                item["children"] = words
            if item["text"]:
                for sent in timed.split_pauses(item):
                    items.extend(timed.split_lines(asr.sentence_case(sent), params.max_chars))
            ctx.progress(0.1 + 0.88 * min(1.0, s.end / dur), f"Đã nghe {int(s.end)}/{int(dur)} giây")

        if dropped:
            ctx.log.info(f"Bỏ {dropped} đoạn nhận dạng nhầm (quá ngắn / độ tin cậy thấp)")
        if not items:
            ctx.log.warning("Không nghe thấy lời nói nào trong file")
        srt, txt, tr = asr.write_outputs(ctx.workdir, items, {"language": params.language, "duration": round(dur, 3), "model": mid})
        n_words = sum(len(i.get("children", [])) for i in items)
        return Result(outputs=Outputs(subtitle=srt, text=txt, transcript=tr),
                      summary=f"Đã chép {len(items)} dòng, {n_words} từ ({LANGS[params.language]})")

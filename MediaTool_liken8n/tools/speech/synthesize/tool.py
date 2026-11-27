"""speech_synthesize — đọc văn bản tiếng Việt thành giọng nói tự nhiên (VieNeu-TTS, chạy trên máy).

Văn bản được chia câu (bộ tách câu của VieNeu, hiểu ngoặc kép / viết tắt); mỗi câu đọc riêng (VieNeu tự chuẩn hóa số,
ngày tháng, đơn vị, từ tiếng Anh), rồi ghép với khoảng nghỉ theo loại ranh giới: hết đoạn 0,7 s, hết câu 0,5 s,
dấu phẩy 0,3 s — đã tính phần im lặng sẵn có nên nhịp đọc đều. Tốc độ đổi bằng Rubber Band (giữ cao độ) với model
Turbo, đổi ngay lúc sinh với model Nhẹ. Cuối cùng chuẩn hóa độ to EBU R128 hai lượt.

Vì biết chính xác câu nào nằm ở đâu trong audio, tool trả luôn phụ đề .srt và TimedData — nối thẳng vào compose_bind.
Toàn bộ phần dùng chung (nạp model, giọng, ghép, tốc độ, độ to) ở `mediatool_sdk.speech`.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from mediatool_sdk import AudioFile, BaseTool, Context, InputError, Result, SubtitleFile, TextFile, Transcript, VoiceProfile
from mediatool_sdk import speech, timed

_VOICES, _VOICE_LABELS = speech.voice_choices()


class Inputs(BaseModel):
    script: TextFile | None = Field(None, description="Văn bản cần đọc dạng file .txt (từ bước trước hoặc tải lên); có thì dùng thay ô văn bản")
    voice_file: VoiceProfile | None = Field(None, description="Giọng riêng đã lưu (tạo bằng tool 'Lưu giọng đọc'); có thì dùng thay giọng có sẵn")


class Params(BaseModel):
    text: str = Field("", max_length=20000, description="Văn bản cần đọc. Xuống dòng = sang đoạn mới (nghỉ lâu hơn). Chèn [cười], [thở dài], [hắng giọng] để thêm biểu cảm",
                      json_schema_extra={"x-multiline": True})
    voice: str = Field(speech.DEFAULT_VOICE, description="Giọng đọc có sẵn (⭐ = giọng tuyển chọn)",
                       json_schema_extra={"enum": _VOICES, "x-labels": _VOICE_LABELS})
    model: Literal["turbo", "turbo_fast", "nano"] = Field("turbo", description="Model đọc", json_schema_extra={"x-labels": speech.MODELS})
    speed: float = Field(1.0, ge=0.7, le=1.5, description="Tốc độ đọc (1 = tự nhiên; 1,2 = nhanh hơn 20%), giữ nguyên cao độ giọng")
    pause: float = Field(1.0, ge=0.5, le=2.0, description="Độ dài khoảng nghỉ giữa các câu (1 = tự nhiên)")
    expressiveness: float = Field(0.8, ge=0.3, le=1.1, description="Độ biểu cảm (model Turbo): thấp = đều đều, ổn định; cao = nhiều cảm xúc hơn. 0,8 ổn định nhất")
    seed: int = Field(0, ge=0, le=1_000_000, description="Số cố định để đọc lại y hệt lần trước; 0 = mỗi lần một khác")
    caption_chars: int = Field(42, ge=0, le=120, description="Số ký tự tối đa mỗi dòng phụ đề kèm theo (0 = nguyên câu; video dọc nên 16–24)")
    loudness: Literal["speech", "broadcast", "none"] = Field("speech", description="Chuẩn hóa độ to", json_schema_extra={
        "x-labels": {"speech": "Mạng xã hội / podcast (−16 LUFS)", "broadcast": "Truyền hình (−23 LUFS)", "none": "Giữ nguyên"}})
    format: Literal["wav", "mp3"] = Field("wav", description="Định dạng audio", json_schema_extra={"x-labels": {"wav": "WAV — chất lượng gốc", "mp3": "MP3 — nhẹ để gửi"}})


class Outputs(BaseModel):
    audio: AudioFile = Field(description="Giọng đọc (mono 48 kHz)")
    subtitle: SubtitleFile = Field(description="Phụ đề .srt khớp với giọng đọc")
    transcript: Transcript = Field(description="Thời gian từng câu / dòng / từ (JSON) — cho compose_bind chèn chữ chạy theo giọng")


class SpeechSynthesizeTool(BaseTool[Inputs, Params, Outputs]):
    def check(self, ctx: Context) -> None:
        ctx.require_binary("ffmpeg")

    @staticmethod
    def _text(inputs: Inputs, params: Params) -> str:
        return inputs.script.read() if inputs.script is not None else params.text

    def validate(self, inputs: Inputs, params: Params, ctx: Context) -> None:
        text = self._text(inputs, params)
        if len(text) > 50000:
            raise InputError("script", "Văn bản quá dài (tối đa 50.000 ký tự mỗi lần) — chia thành nhiều phần")
        if not speech.display_text(text) and "[" not in text:
            raise InputError("script" if inputs.script else "text", "Hãy nhập văn bản cần đọc")
        if inputs.voice_file is not None:
            speech.read_profile(inputs.voice_file.path)

    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        units = speech.script_units(self._text(inputs, params))
        if not units:
            raise InputError("text", "Không tìm thấy câu nào để đọc")
        ctx.progress(0.02, "Đang nạp model giọng đọc")
        sp = speech.load(ctx, params.model)
        profile = speech.read_profile(inputs.voice_file.path) if inputs.voice_file else None
        voice = sp.voice(params.voice, profile, warn=ctx.log.warning)
        name = profile.get("name") if profile else params.voice

        ctx.progress(0.2, f"Đang đọc {len(units)} câu")
        native_speed = sp.engine_key == "v3nano"
        wavs = sp.say([u["text"] for u in units], voice, temperature=params.expressiveness, seed=params.seed,
                      speed=params.speed if native_speed else 1.0,
                      on_item=lambda i, n: ctx.progress(0.2 + 0.7 * i / n, f"Đã đọc {i}/{n} câu"), should_stop=ctx.is_cancelled)
        ctx.check_cancelled()
        track, spans = speech.join(wavs, sp.sr, [u["gap"] for u in units], pause=params.pause)
        k = 1.0
        if not native_speed and abs(params.speed - 1.0) > 0.005:
            ctx.progress(0.92, "Đang chỉnh tốc độ")
            track, k = speech.stretch(track, sp.sr, params.speed), params.speed

        ctx.progress(0.95, "Đang chuẩn hóa âm lượng")
        out = speech.finish(track, sp.sr, ctx.workdir / f"speech.{params.format}", params.loudness)

        items: list[dict[str, Any]] = []
        for u, (a, b) in zip(units, spans):
            if not u["display"]:
                continue  # chỉ có thẻ cảm xúc: có tiếng nhưng không có chữ
            it = {"start": round(a / k, 3), "end": round(b / k, 3), "text": u["display"]}
            it["children"] = timed.estimate_words(it)
            items.extend(timed.split_lines(it, params.caption_chars))
        srt = ctx.workdir / "speech.srt"
        srt.write_text(timed.to_srt(items), encoding="utf-8")
        tr = Transcript.write(ctx.workdir / "speech.json", {
            "language": "vi", "voice": name, "model": sp.model, "duration": round(len(track) / sp.sr / k, 3), "items": items})
        audio = AudioFile(path=out)
        return Result(outputs=Outputs(audio=audio, subtitle=SubtitleFile(path=srt), transcript=tr),
                      summary=f"Đã đọc {len(units)} câu bằng giọng {name}, dài {audio.duration_text}")

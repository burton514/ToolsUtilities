"""speech_voice_add — lưu một giọng đọc riêng từ clip mẫu, để các tool đọc / lồng tiếng dùng lại.

1. ffmpeg giải mã clip (audio hoặc video) về mono 44,1 kHz.
2. Chọn đoạn mẫu: người dùng chỉ định, hoặc TỰ CHỌN cửa sổ 10 giây có nhiều tiếng nói nhất và ít bị vỡ tiếng nhất
   (năng lượng theo khung 20 ms, ngưỡng tiếng nói = nền ồn + 12 dB), mép cửa sổ dời về chỗ lặng gần nhất để không
   cắt giữa chữ.
3. VieNeu lấy đặc trưng giọng (khử nhiễu → x-vector 192 chiều + mã tham chiếu) — một lần, lưu vào hồ sơ.
4. Hồ sơ giọng (JSON, asset `voice`) giữ cả clip mẫu (FLAC) nên dùng được với model khác về sau.
5. Đọc thử một câu bằng giọng mới để nghe ngay.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Literal

from pydantic import BaseModel, Field

from mediatool_sdk import AudioFile, BaseTool, Context, InputError, MediaFile, Result, VoiceProfile
from mediatool_sdk import speech

SR = 44100
WINDOW_S = 10.0
FRAME_S = 0.02


class Inputs(BaseModel):
    audio: MediaFile = Field(description="Clip có giọng cần lưu (audio hoặc video), một người nói, càng ít nhạc / tạp âm càng tốt")


class Params(BaseModel):
    name: str = Field(min_length=1, max_length=60, description="Tên giọng (ví dụ: Giọng của Lan)")
    consent: bool = Field(False, description="Tôi là chủ giọng nói này hoặc đã được chủ giọng đồng ý cho nhân bản")
    start: float = Field(0, ge=0, description="Lấy mẫu từ giây này")
    duration: float = Field(0, ge=0, le=30, description="Độ dài đoạn mẫu (giây); 0 = tự chọn 10 giây rõ tiếng nhất. Tốt nhất 6–15 giây")
    denoise: bool = Field(True, description="Khử tạp âm clip mẫu trước khi lấy giọng (tắt nếu clip đã rất sạch)")
    model: Literal["turbo", "turbo_fast", "nano"] = Field("turbo", description="Model sẽ dùng giọng này (model khác vẫn dùng được, chỉ chậm hơn vài giây lần đầu)",
                                                          json_schema_extra={"x-labels": speech.MODELS})
    description: str = Field("", max_length=200, description="Ghi chú (giới tính, vùng miền, phong cách…)")
    preview_text: str = Field("Xin chào, đây là giọng đọc vừa được lưu. Bạn nghe thử xem có giống không nhé!", max_length=300,
                              description="Câu đọc thử bằng giọng mới")


class Outputs(BaseModel):
    voice: VoiceProfile = Field(description="Hồ sơ giọng — đưa vào ô 'Giọng riêng' của tool đọc / lồng tiếng")
    preview: AudioFile = Field(description="Câu đọc thử bằng giọng mới")
    sample: AudioFile = Field(description="Đoạn mẫu đã được chọn từ clip (để kiểm tra)")


def pick_window(wav: Any, sr: int, length: float = WINDOW_S) -> tuple[int, int, dict[str, float]]:
    """Cửa sổ `length` giây nhiều tiếng nói nhất, ít vỡ tiếng nhất; mép dời về chỗ lặng gần nhất (±0,4 s).
    Trả (mẫu đầu, mẫu cuối, thống kê)."""
    import numpy as np

    hop = int(FRAME_S * sr)
    n = len(wav) // hop
    if n == 0:
        return 0, len(wav), {"voiced_s": 0.0, "clip_ratio": 0.0}
    frames = wav[: n * hop].reshape(n, hop)
    db = 20 * np.log10(np.sqrt((frames ** 2).mean(axis=1)) + 1e-9)
    floor = float(np.percentile(db, 10))
    voiced = db > max(-50.0, floor + 12.0)
    clipped = (np.abs(frames) > 0.985).any(axis=1)
    w = max(1, min(n, int(length / FRAME_S)))
    score = np.convolve(voiced.astype(float) - 3.0 * clipped, np.ones(w), mode="valid")  # tổng trên mỗi cửa sổ
    a = int(np.argmax(score))
    b = a + w

    def quiet_near(i: int) -> int:
        r = int(0.4 / FRAME_S)
        lo, hi = max(0, i - r), min(n, i + r + 1)
        return lo + int(np.argmin(db[lo:hi])) if hi > lo else i

    a, b = quiet_near(a), quiet_near(b) if b < n else n
    if b - a < w // 2:
        a, b = max(0, b - w), b
    stats = {"voiced_s": float(voiced[a:b].sum() * FRAME_S), "clip_ratio": float(clipped[a:b].mean()) if b > a else 0.0,
             "noise_db": floor}
    return a * hop, min(len(wav), b * hop), stats


class SpeechVoiceAddTool(BaseTool[Inputs, Params, Outputs]):
    def check(self, ctx: Context) -> None:
        ctx.require_binary("ffmpeg")

    def validate(self, inputs: Inputs, params: Params, ctx: Context) -> None:
        if not params.consent:
            raise InputError("consent", "Chỉ nhân bản giọng của chính bạn hoặc người đã đồng ý — hãy đánh dấu xác nhận")
        if not params.name.strip():
            raise InputError("name", "Hãy đặt tên cho giọng")

    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        import numpy as np

        ctx.progress(0.02, "Đang đọc clip mẫu")
        span = params.duration if params.duration else 120.0  # tự chọn: tìm trong 2 phút đầu (tính từ `start`)
        wav = speech.read_audio(inputs.audio.path, SR, params.start, span)
        if len(wav) < SR:
            raise InputError("audio", "Clip quá ngắn hoặc không có tiếng (cần ít nhất 3 giây giọng nói)")
        a, b, st = pick_window(wav, SR, params.duration or WINDOW_S)
        ref = wav[a:b].astype(np.float32)
        if st["voiced_s"] < 3.0:
            raise InputError("audio", f"Chỉ nghe được {st['voiced_s']:.1f} giây giọng nói — cần ít nhất 3 giây, nên 6–15 giây")
        if st["clip_ratio"] > 0.01:
            ctx.log.warning("Clip mẫu bị vỡ tiếng (thu quá to) — giọng nhân bản có thể bị rè, nên thu lại nhỏ hơn")
        if st["noise_db"] > -45:
            ctx.log.warning("Clip mẫu khá ồn — đã khử nhiễu, nhưng clip sạch sẽ cho giọng giống hơn")
        peak = float(np.abs(ref).max())
        if 0 < peak < 0.5:  # đưa đỉnh về -1 dBFS cho bộ mã hóa giọng (không đổi âm sắc)
            ref = ref * (0.89 / peak)

        ctx.progress(0.1, "Đang nạp model giọng đọc")
        sp = speech.load(ctx, params.model)
        ctx.progress(0.45, "Đang lấy đặc trưng giọng")
        sec = sp.enroll(ref, SR, denoise=params.denoise)
        name = re.sub(r"\s+", " ", params.name).strip()
        prof = speech.make_profile(name, ref, SR, description=params.description, denoise=params.denoise,
                                   engines={sp.engine_key: sec})
        ascii_name = unicodedata.normalize("NFKD", name.replace("đ", "d").replace("Đ", "D")).encode("ascii", "ignore").decode()
        slug = re.sub(r"[^a-z0-9]+", "_", ascii_name.lower()).strip("_") or "voice"

        ctx.progress(0.6, "Đang đọc thử")
        text = params.preview_text.strip() or "Xin chào, đây là giọng đọc vừa được lưu."
        units = speech.script_units(text)
        wavs = sp.say([u["text"] for u in units], sp.voice(profile=prof), seed=1)
        track, _ = speech.join(wavs, sp.sr, [u["gap"] for u in units])

        # độ giống: cosine giữa x-vector của clip mẫu và của câu đọc thử (cùng bộ mã hóa người nói)
        ctx.progress(0.85, "Đang đo độ giống giọng")
        emb_ref = np.asarray(sec["speaker_emb"], dtype=np.float32)
        emb_out = np.asarray(sp.enroll(track, sp.sr, denoise=False)["speaker_emb"], dtype=np.float32)
        sim = float(emb_ref @ emb_out / (np.linalg.norm(emb_ref) * np.linalg.norm(emb_out) + 1e-9))
        prof["quality"] = {"similarity": round(sim, 3), "voiced_s": round(st["voiced_s"], 2), "noise_db": round(st["noise_db"], 1)}
        if sim < 0.5:
            ctx.log.warning(f"Giọng đọc thử chưa giống clip mẫu lắm (độ giống {sim:.2f}) — thử clip sạch hơn, dài 8–15 giây, một người nói")
        voice = VoiceProfile.write(ctx.workdir / f"giong_{slug}.json", prof)

        preview = speech.finish(track, sp.sr, ctx.workdir / "preview.wav")
        sample = speech.finish(ref, SR, ctx.workdir / "sample.wav", "none")
        t0 = params.start + a / SR
        return Result(outputs=Outputs(voice=voice, preview=AudioFile(path=preview), sample=AudioFile(path=sample)),
                      summary=f"Đã lưu giọng '{name}' từ đoạn {t0:.1f}–{t0 + len(ref) / SR:.1f} giây "
                              f"({st['voiced_s']:.1f} giây giọng nói, độ giống {sim:.0%})")

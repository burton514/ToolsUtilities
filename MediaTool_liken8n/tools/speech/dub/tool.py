"""speech_dub — lồng tiếng theo phụ đề: đọc từng câu đúng mốc thời gian, (tùy chọn) trộn vào video.

Thuật toán khớp khung thời gian (mỗi câu một "khung" từ lúc câu bắt đầu đến lúc câu SAU bắt đầu):
1. Đọc từng câu (VieNeu), cắt im lặng thừa hai đầu.
2. `fit = speed`: câu dài hơn khung thì đọc nhanh lên vừa khung, tối đa `max_speed` lần (Rubber Band giữ cao độ với
   Turbo; model Nhẹ đọc lại ở tốc độ mới — tự nhiên hơn kéo giãn). Vẫn chưa vừa thì phần thừa đẩy câu sau lùi lại.
   `fit = natural`: không đổi tốc độ, câu thừa đẩy câu sau lùi lại (không bao giờ đè tiếng nhau).
3. Có video: trộn giọng mới với tiếng gốc — tiếng gốc giảm còn `original_volume`% và tự "nhường" (sidechain
   compress) mỗi khi giọng mới cất lên, giữa các câu thì nhạc nền trở lại; hình giữ nguyên (không mã hóa lại).
Ra: audio lồng tiếng, phụ đề + TimedData theo mốc THẬT sau khi khớp (nối thẳng vào compose_bind), video nếu có.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from mediatool_sdk import (AudioFile, BaseTool, Context, InputError, JsonData, Result, SubtitleFile, ToolError,
                           Transcript, VideoFile, VoiceProfile)
from mediatool_sdk import ffmpeg, speech, timed

_VOICES, _VOICE_LABELS = speech.voice_choices()
GAP = 0.08  # khoảng hở tối thiểu giữa hai câu (giây)


class Inputs(BaseModel):
    subtitle: SubtitleFile | None = Field(None, description="Phụ đề có thời gian (.srt / .vtt) — lời cần đọc")
    data: JsonData | None = Field(None, description="Hoặc dữ liệu thời gian JSON (kết quả phiên âm…) thay cho file phụ đề")
    video: VideoFile | None = Field(None, description="Video cần lồng tiếng (tùy chọn) — có thì trả thêm video đã lồng")
    voice_file: VoiceProfile | None = Field(None, description="Giọng riêng đã lưu (tạo bằng tool 'Lưu giọng đọc')")


class Params(BaseModel):
    voice: str = Field(speech.DEFAULT_VOICE, description="Giọng đọc có sẵn (⭐ = giọng tuyển chọn)",
                       json_schema_extra={"enum": _VOICES, "x-labels": _VOICE_LABELS})
    model: Literal["turbo", "turbo_fast", "nano"] = Field("turbo", description="Model đọc", json_schema_extra={"x-labels": speech.MODELS})
    fit: Literal["speed", "natural"] = Field("speed", description="Câu đọc dài hơn khung thời gian thì", json_schema_extra={
        "x-labels": {"speed": "Đọc nhanh lên cho vừa (khuyên dùng)", "natural": "Giữ tốc độ, lùi câu sau"}})
    max_speed: float = Field(1.3, ge=1.0, le=1.6, description="Tăng tốc tối đa khi cần cho vừa khung (1,3 = nhanh hơn 30%, vẫn tự nhiên)")
    speed: float = Field(1.0, ge=0.8, le=1.3, description="Tốc độ đọc chung cho mọi câu")
    original_volume: int = Field(20, ge=0, le=100, description="Giữ lại bao nhiêu % tiếng gốc của video (nhạc nền, tiếng động); 0 = bỏ hẳn")
    duck: bool = Field(True, description="Tiếng gốc tự nhỏ xuống khi giọng mới nói, lớn lại khi nghỉ")
    expressiveness: float = Field(0.8, ge=0.3, le=1.1, description="Độ biểu cảm (model Turbo); 0,8 ổn định nhất")
    seed: int = Field(0, ge=0, le=1_000_000, description="Số cố định để đọc lại y hệt; 0 = mỗi lần một khác")
    loudness: Literal["speech", "broadcast", "none"] = Field("speech", description="Chuẩn hóa độ to giọng lồng", json_schema_extra={
        "x-labels": {"speech": "Mạng xã hội / podcast (−16 LUFS)", "broadcast": "Truyền hình (−23 LUFS)", "none": "Giữ nguyên"}})


class Outputs(BaseModel):
    audio: AudioFile = Field(description="Giọng lồng tiếng (đúng mốc thời gian, im lặng giữa các câu)")
    subtitle: SubtitleFile = Field(description="Phụ đề theo mốc thời gian thật sau khi khớp")
    transcript: Transcript = Field(description="Thời gian từng câu / từ (JSON) — cho compose_bind chèn chữ khớp giọng mới")
    video: VideoFile | None = Field(None, description="Video đã lồng tiếng (khi có video đầu vào)")


def place(durations: list[float], cues: list[dict[str, Any]], fit: str, max_speed: float, gap: float = GAP
          ) -> tuple[list[float], list[float], dict[str, float]]:
    """Khớp các câu vào khung thời gian. durations: độ dài câu (giây, tốc độ gốc). Trả (hệ số tăng tốc, mốc đặt, thống kê).
    Khung của câu i = từ cues[i].start đến cues[i+1].start − gap (câu cuối: tới hết câu hoặc vô hạn)."""
    factors, starts = [], []
    cursor, sped, pushed, max_push, max_f = 0.0, 0, 0, 0.0, 1.0
    for i, (d, c) in enumerate(zip(durations, cues)):
        slot = (cues[i + 1]["start"] - c["start"] - gap) if i + 1 < len(cues) else max(c["end"] - c["start"], d)
        f = 1.0
        if fit == "speed" and d > slot > 0:
            f = min(max_speed, d / slot)
            if f < 1.01:
                f = 1.0
        at = max(c["start"], cursor)
        if at > c["start"] + 1e-3:
            pushed += 1
            max_push = max(max_push, at - c["start"])
        if f > 1.0:
            sped += 1
            max_f = max(max_f, f)
        factors.append(f)
        starts.append(at)
        cursor = at + d / f + gap
    return factors, starts, {"sped": sped, "max_speed": max_f, "pushed": pushed, "max_push": max_push}


class SpeechDubTool(BaseTool[Inputs, Params, Outputs]):
    def check(self, ctx: Context) -> None:
        ctx.require_binary("ffmpeg")

    def validate(self, inputs: Inputs, params: Params, ctx: Context) -> None:
        if (inputs.subtitle is None) == (inputs.data is None):
            raise InputError("subtitle", "Hãy đưa MỘT nguồn lời có thời gian: file phụ đề hoặc dữ liệu JSON")
        if inputs.voice_file is not None:
            speech.read_profile(inputs.voice_file.path)

    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        import numpy as np

        src = inputs.subtitle or inputs.data
        cues = sorted((c for c in timed.load(src.path) if speech.display_text(c.get("text", ""))), key=lambda c: c["start"])
        if not cues:
            raise InputError("subtitle" if inputs.subtitle else "data", "Không có câu nào có thời gian để đọc")
        ctx.progress(0.02, f"{len(cues)} câu — đang nạp model giọng đọc")
        sp = speech.load(ctx, params.model)
        profile = speech.read_profile(inputs.voice_file.path) if inputs.voice_file else None
        voice = sp.voice(params.voice, profile, warn=ctx.log.warning)
        name = profile.get("name") if profile else params.voice
        nano = sp.engine_key == "v3nano"
        texts = [" ".join(c["text"].split()) for c in cues]

        def say(ts: list[str], speed: float, rng: tuple[float, float]) -> list[Any]:
            a, b = rng
            return sp.say(ts, voice, temperature=params.expressiveness, seed=params.seed, speed=speed,
                          on_item=lambda i, n: ctx.progress(a + (b - a) * i / n, f"Đã đọc {i}/{n} câu"), should_stop=ctx.is_cancelled)

        wavs = [speech.trim(w, sp.sr) for w in say(texts, params.speed if nano else 1.0, (0.15, 0.75))]
        ctx.check_cancelled()
        if not nano and abs(params.speed - 1.0) > 0.005:
            wavs = [speech.stretch(w, sp.sr, params.speed) for w in wavs]

        # khớp khung thời gian
        factors, starts, st = place([len(w) / sp.sr for w in wavs], cues, params.fit, params.max_speed)
        need = [i for i, f in enumerate(factors) if f > 1.0]
        if need:
            ctx.progress(0.78, f"Đang chỉnh tốc độ {len(need)} câu cho vừa thời gian")
            if nano:  # Nano đọc lại ở tốc độ mới: tự nhiên hơn kéo giãn
                for k, i in enumerate(need):
                    ctx.check_cancelled()
                    w = sp.say([texts[i]], voice, seed=params.seed, speed=params.speed * factors[i])[0]
                    wavs[i] = speech.trim(w, sp.sr)
                    ctx.progress(0.78 + 0.1 * (k + 1) / len(need), f"Đọc lại nhanh hơn {k + 1}/{len(need)} câu")
            else:
                for i in need:
                    wavs[i] = speech.stretch(wavs[i], sp.sr, factors[i])
            # đặt lại theo độ dài thật sau khi chỉnh (kéo giãn không tuyệt đối chính xác)
            _, starts, _ = place([len(w) / sp.sr for w in wavs], cues, "natural", 1.0)

        end = max(s + len(w) / sp.sr for s, w in zip(starts, wavs))
        vdur = ffmpeg.duration(inputs.video.path) if inputs.video else None
        total = max(end + 0.3, vdur or 0.0)
        track = np.zeros(int(total * sp.sr) + 1, dtype=np.float32)
        items = []
        for c, s, w, t in zip(cues, starts, wavs, texts):
            i0 = int(round(s * sp.sr))
            track[i0:i0 + len(w)] += w
            lead, tail = speech.edge_silence(w, sp.sr)
            it = {"start": round(s + lead / sp.sr, 3), "end": round(s + (len(w) - tail) / sp.sr, 3), "text": speech.display_text(t)}
            it["children"] = timed.estimate_words(it)
            items.append(it)

        ctx.progress(0.9, "Đang chuẩn hóa âm lượng")
        audio = speech.finish(track, sp.sr, ctx.workdir / "dub.wav", params.loudness)
        srt = ctx.workdir / "dub.srt"
        srt.write_text(timed.to_srt(items), encoding="utf-8")
        tr = Transcript.write(ctx.workdir / "dub.json", {"language": "vi", "voice": name, "model": sp.model,
                                                         "duration": round(total, 3), "items": items})
        video = None
        if inputs.video:
            ctx.progress(0.94, "Đang trộn tiếng vào video")
            video = VideoFile(path=self._mux(inputs.video, audio, params, ctx))
            if vdur and end > vdur + 0.05:
                ctx.log.warning(f"Giọng lồng dài hơn video {end - vdur:.1f} giây — phần cuối bị cắt theo độ dài video")

        notes = []
        if st["sped"]:
            notes.append(f"{st['sped']} câu đọc nhanh lên (tối đa {st['max_speed']:.2f}×)")
        if st["pushed"]:
            notes.append(f"{st['pushed']} câu lùi lại (tối đa {st['max_push']:.1f} giây)")
        summary = f"Đã lồng {len(cues)} câu bằng giọng {name}" + (f"; {', '.join(notes)}" if notes else "; mọi câu khớp mốc thời gian")
        return Result(outputs=Outputs(audio=AudioFile(path=audio), subtitle=SubtitleFile(path=srt), transcript=tr, video=video),
                      summary=summary)

    @staticmethod
    def _mux(video: VideoFile, dub: Any, params: Params, ctx: Context) -> Any:
        info = ffmpeg.probe(video.path)
        has_audio = any(s.get("codec_type") == "audio" for s in info.get("streams", []))
        out = ctx.workdir / "video_dub.mp4"
        vol = params.original_volume / 100
        if has_audio and vol > 0:
            g = f"[0:a]aresample=48000,aformat=channel_layouts=stereo,volume={vol:.3f}[bg];[1:a]aresample=48000,aformat=channel_layouts=stereo"
            if params.duck:  # tiếng gốc nhường giọng: nén theo tín hiệu giọng (ngưỡng thấp, nhả 400 ms cho tự nhiên)
                g += ",asplit=2[v1][v2];[bg][v1]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=400[duck];[duck][v2]"
            else:
                g += "[v2];[bg][v2]"
            g += "amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]"
            amap = ["-filter_complex", g, "-map", "0:v:0", "-map", "[a]"]
        else:
            amap = ["-filter_complex", "[1:a]aresample=48000,aformat=channel_layouts=stereo[a]", "-map", "0:v:0", "-map", "[a]"]
        dur = ffmpeg.duration(video.path)
        ctx.ffmpeg(["-y", "-i", str(video.path), "-i", str(dub), *amap, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                    *(["-t", f"{dur:.3f}"] if dur else []), "-movflags", "+faststart", str(out)],
                   total_seconds=dur, progress_range=(0.94, 0.99))
        if not out.is_file():
            raise ToolError("MUX_FAILED", "Không trộn được tiếng vào video")
        return out

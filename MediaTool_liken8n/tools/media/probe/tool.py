from __future__ import annotations

from pydantic import BaseModel, Field

from mediatool_sdk import BaseTool, Context, JsonData, MediaFile, NoParams, Result


class Inputs(BaseModel):
    file: MediaFile = Field(description="File video hoặc audio cần xem thông tin")


class Outputs(BaseModel):
    info: JsonData = Field(description="Thông tin file: thời lượng, khung hình, fps, âm thanh, phụ đề, các luồng")


def _fps(rate: str | None) -> float | None:
    try:
        num, _, den = (rate or "").partition("/")
        return round(float(num) / float(den or 1), 3) if float(den or 1) else None
    except ValueError:
        return None


def _mmss(seconds: float | None) -> str:
    if seconds is None:
        return "?"
    s = int(round(seconds))
    return f"{s // 60}:{s % 60:02d}"


class ProbeTool(BaseTool[Inputs, NoParams, Outputs]):
    def check(self, ctx: Context) -> None:
        ctx.require_binary("ffprobe")

    def run(self, inputs: Inputs, params: NoParams, ctx: Context) -> Result[Outputs]:
        ctx.progress(0.1, "Đang đọc thông tin file")
        raw = ctx.probe(inputs.file.path)
        fmt = raw.get("format", {})
        streams = raw.get("streams", [])
        video = next((s for s in streams if s.get("codec_type") == "video"
                      and not (s.get("disposition") or {}).get("attached_pic")), None)
        audio = [s for s in streams if s.get("codec_type") == "audio"]
        subs = [s for s in streams if s.get("codec_type") == "subtitle"]
        duration = float(fmt["duration"]) if fmt.get("duration") else None

        info = {
            "filename": inputs.file.filename,
            "size_bytes": inputs.file.size_bytes,
            "container": fmt.get("format_name"),
            "duration_s": duration,
            "bit_rate": int(fmt["bit_rate"]) if fmt.get("bit_rate") else None,
            "has_video": video is not None,
            "has_audio": bool(audio),
            "has_subtitles": bool(subs),
            "video": None if video is None else {
                "codec": video.get("codec_name"),
                "width": video.get("width"),
                "height": video.get("height"),
                "fps": _fps(video.get("avg_frame_rate") or video.get("r_frame_rate")),
            },
            "audio_tracks": [
                {"index": i + 1, "codec": a.get("codec_name"), "sample_rate": int(a.get("sample_rate") or 0) or None,
                 "channels": a.get("channels"), "language": (a.get("tags") or {}).get("language")}
                for i, a in enumerate(audio)
            ],
            "subtitle_tracks": [
                {"index": i + 1, "codec": s.get("codec_name"), "language": (s.get("tags") or {}).get("language")}
                for i, s in enumerate(subs)
            ],
        }
        out = JsonData.write(ctx.workdir / "info.json", info)

        if video:
            v = info["video"]
            summary = f"Video {v['width']}×{v['height']}, {v['fps']} fps, dài {_mmss(duration)}"
            summary += ", có tiếng" if audio else ", không có tiếng"
        elif audio:
            summary = f"Audio {audio[0].get('codec_name')}, dài {_mmss(duration)}"
        else:
            summary = "File không có hình hay tiếng"
        if subs:
            summary += f", {len(subs)} phụ đề"
        return Result(outputs=Outputs(info=out), summary=summary)

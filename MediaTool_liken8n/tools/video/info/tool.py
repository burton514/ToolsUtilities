"""video_info — thông tin cơ bản của video, trình bày dễ hiểu cho người dùng."""
from __future__ import annotations

from pydantic import BaseModel, Field

from mediatool_sdk import BaseTool, Context, JsonData, NoParams, Result, VideoFile


class Inputs(BaseModel):
    video: VideoFile = Field(description="Video cần xem thông tin")


class Outputs(BaseModel):
    info: JsonData = Field(description="Thông tin video: danh sách mục dễ đọc (nhãn + giá trị) và số liệu gốc")


def _duration(seconds: float) -> str:
    s = int(round(seconds))
    h, rem = divmod(s, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def _size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n} B"


def _quality(height: int) -> str:
    if height >= 2160:
        return "4K"
    if height >= 1440:
        return "2K"
    if height >= 1080:
        return "Full HD (1080p)"
    if height >= 720:
        return "HD (720p)"
    return f"SD ({height}p)"


def _ratio(w: int, h: int) -> str:
    r = w / h if h else 0
    for name, v in (("16:9", 16 / 9), ("9:16 (dọc)", 9 / 16), ("1:1 (vuông)", 1), ("4:3", 4 / 3), ("4:5", 4 / 5), ("21:9", 21 / 9)):
        if abs(r - v) < 0.03:
            return name
    return f"{w}:{h}"


class VideoInfoTool(BaseTool[Inputs, NoParams, Outputs]):
    def check(self, ctx: Context) -> None:
        ctx.require_binary("ffprobe")

    def run(self, inputs: Inputs, params: NoParams, ctx: Context) -> Result[Outputs]:
        raw = ctx.probe(inputs.video.path)
        fmt = raw.get("format", {})
        streams = raw.get("streams", [])
        v = next((s for s in streams if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")), None)
        a = next((s for s in streams if s.get("codec_type") == "audio"), None)

        duration = float(fmt.get("duration") or 0)
        size = inputs.video.size_bytes
        w, h = (v.get("width", 0), v.get("height", 0)) if v else (0, 0)
        num, _, den = ((v or {}).get("avg_frame_rate") or "0/1").partition("/")
        fps = round(float(num) / float(den or 1), 2) if float(den or 1) else 0

        items = [
            ("Tên file", inputs.video.filename),
            ("Thời lượng", _duration(duration)),
            ("Kích thước khung hình", f"{w} × {h}" if v else "Không có hình"),
            ("Chất lượng", _quality(h) if v else "—"),
            ("Tỉ lệ khung", _ratio(w, h) if v else "—"),
            ("Số hình mỗi giây", f"{fps:g} fps" if fps else "—"),
            ("Dung lượng", _size(size)),
            ("Âm thanh", ("Có, " + ("stereo" if a.get("channels") == 2 else f"{a.get('channels')} kênh")) if a else "Không có tiếng"),
            ("Định dạng", inputs.video.path.suffix.lstrip(".").upper() or (fmt.get("format_name") or "?").split(",")[0].upper()),
        ]
        out = JsonData.write(ctx.workdir / "video_info.json", {
            "items": [{"label": k, "value": val} for k, val in items],
            "raw": {
                "duration_s": duration, "size_bytes": size, "width": w, "height": h, "fps": fps,
                "video_codec": (v or {}).get("codec_name"), "audio_codec": (a or {}).get("codec_name"),
                "has_audio": a is not None,
            },
        })
        summary = f"Video {_duration(duration)}, {_quality(h)} ({w}×{h}), {_size(size)}, " + ("có tiếng" if a else "không có tiếng")
        return Result(outputs=Outputs(info=out), summary=summary)

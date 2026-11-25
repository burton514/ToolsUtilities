"""Kiểu asset. Mỗi kiểu mang một `format` ngữ nghĩa, dùng để nối output tool này vào input tool khác.

Asset luôn được truyền theo tham chiếu (đường dẫn file), không bao giờ truyền bytes.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, ClassVar

from pydantic import BaseModel, ConfigDict, Field

# Input khai báo format bên trái nhận được asset có format bên phải.
FORMAT_COMPAT: dict[str, set[str]] = {
    "media": {"media", "video", "audio"},
    "json": {"json", "transcript", "timed_lyrics", "beat_grid", "scene_list", "time_ranges", "composition", "text_style"},
}


def accepts(expected: str, actual: str) -> bool:
    """Input khai báo `expected` có nhận asset `actual` không. "file" nhận mọi loại."""
    return expected in ("file", actual) or actual in FORMAT_COMPAT.get(expected, set())


class Asset(BaseModel):
    """Lớp gốc của mọi asset."""

    model_config = ConfigDict(extra="allow", arbitrary_types_allowed=True)
    FORMAT: ClassVar[str] = "file"

    path: Path
    asset_id: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)

    @property
    def size_bytes(self) -> int:
        try:
            return self.path.stat().st_size
        except OSError:
            return 0

    @property
    def filename(self) -> str:
        return self.path.name


class _TimedMedia(Asset):
    @property
    def duration_s(self) -> float | None:
        if "duration_s" not in self.meta:
            from . import ffmpeg

            self.meta["duration_s"] = ffmpeg.duration(self.path)
        return self.meta["duration_s"]

    @property
    def duration_text(self) -> str:
        d = self.duration_s
        if d is None:
            return "?"
        d = int(round(d))
        h, rem = divmod(d, 3600)
        m, s = divmod(rem, 60)
        return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


class MediaFile(_TimedMedia):
    """Video hoặc audio (input nhận cả hai)."""
    FORMAT: ClassVar[str] = "media"


class VideoFile(_TimedMedia):
    FORMAT: ClassVar[str] = "video"


class AudioFile(_TimedMedia):
    FORMAT: ClassVar[str] = "audio"


class ImageFile(Asset):
    FORMAT: ClassVar[str] = "image"


class SubtitleFile(Asset):
    FORMAT: ClassVar[str] = "subtitle"


class FontFile(Asset):
    FORMAT: ClassVar[str] = "font"


class LutFile(Asset):
    FORMAT: ClassVar[str] = "lut"


class JsonData(Asset):
    """Dữ liệu có cấu trúc lưu dạng file JSON."""
    FORMAT: ClassVar[str] = "json"

    def load(self) -> Any:
        return json.loads(self.path.read_text(encoding="utf-8"))

    @classmethod
    def write(cls, path: Path, data: Any) -> "JsonData":
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return cls(path=path)


class ImageSequence(JsonData):
    """File JSON liệt kê các ảnh: {"frames": [{"path": ..., "time": ...}]}."""
    FORMAT: ClassVar[str] = "image_sequence"


class Transcript(JsonData):
    FORMAT: ClassVar[str] = "transcript"


class TimedLyrics(JsonData):
    FORMAT: ClassVar[str] = "timed_lyrics"


class BeatGrid(JsonData):
    FORMAT: ClassVar[str] = "beat_grid"


class SceneList(JsonData):
    FORMAT: ClassVar[str] = "scene_list"


class TimeRanges(JsonData):
    FORMAT: ClassVar[str] = "time_ranges"


class Composition(JsonData):
    FORMAT: ClassVar[str] = "composition"


class TextStyle(JsonData):
    FORMAT: ClassVar[str] = "text_style"


ASSET_TYPES: dict[str, type[Asset]] = {
    cls.FORMAT: cls
    for cls in (
        MediaFile, VideoFile, AudioFile, ImageFile, SubtitleFile, FontFile, LutFile, JsonData,
        ImageSequence, Transcript, TimedLyrics, BeatGrid, SceneList, TimeRanges, Composition, TextStyle,
    )
}

_EXT_FORMATS = {
    "video": {".mp4", ".mkv", ".mov", ".webm", ".avi", ".m4v", ".flv", ".3gp", ".ts"},
    "audio": {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma", ".aiff"},
    "image": {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"},
    "subtitle": {".srt", ".ass", ".ssa", ".vtt", ".lrc"},
    "font": {".ttf", ".otf", ".woff", ".woff2"},
    "lut": {".cube"},
    "json": {".json"},
}


def guess_format(path: str | Path) -> str:
    ext = Path(path).suffix.lower()
    for fmt, exts in _EXT_FORMATS.items():
        if ext in exts:
            return fmt
    return "file"

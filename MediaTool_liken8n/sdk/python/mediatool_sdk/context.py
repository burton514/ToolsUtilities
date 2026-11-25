"""Context: mọi thứ tool cần từ môi trường chạy. Tool không được tự lấy thông tin môi trường theo cách khác."""
from __future__ import annotations

import shutil
import threading
from pathlib import Path
from typing import Any, Callable

from . import ffmpeg as _ffmpeg
from .errors import Cancelled, InputError, ToolError

Emit = Callable[[dict[str, Any]], None]


class Log:
    def __init__(self, emit: Emit):
        self._emit = emit

    def _send(self, level: str, message: str) -> None:
        self._emit({"event": "log", "level": level, "message": str(message)})

    def info(self, message: str) -> None:
        self._send("info", message)

    def warning(self, message: str) -> None:
        self._send("warning", message)

    def error(self, message: str) -> None:
        self._send("error", message)


class Models:
    """Lấy đường dẫn model đã khai báo trong [[models]] của manifest."""

    def __init__(self, resolver: Callable[[str], Path] | None, declared: set[str]):
        self._resolver = resolver
        self._declared = declared

    def get(self, model_id: str) -> Path:
        if model_id not in self._declared:
            raise ToolError("MODEL_NOT_DECLARED", f"Model '{model_id}' chưa được khai báo trong [[models]] của manifest")
        if self._resolver is None:
            raise ToolError("MODEL_UNAVAILABLE", "Môi trường chạy hiện tại không cung cấp model")
        return self._resolver(model_id)


class Guards:
    """Kiểm tra trước khi chạy, để báo lỗi sớm và rõ ràng."""

    def __init__(self, workdir: Path):
        self._workdir = workdir

    def free_disk(self, at_least: int) -> None:
        free = shutil.disk_usage(self._workdir).free
        if free < at_least:
            raise ToolError(
                "NOT_ENOUGH_DISK",
                f"Không đủ dung lượng đĩa: còn {free // 2**20} MB, cần khoảng {at_least // 2**20} MB",
            )

    def max_duration(self, field: str, asset: Any, seconds: float) -> None:
        d = getattr(asset, "duration_s", None)
        if d is not None and d > seconds:
            raise InputError(field, f"File dài {d:.0f} giây, vượt giới hạn {seconds:.0f} giây")


class Limits:
    def __init__(self, ram_mb: int | None):
        self.ram_mb = ram_mb


class Context:
    def __init__(
        self,
        workdir: Path,
        emit: Emit,
        *,
        cancelled: threading.Event | None = None,
        model_resolver: Callable[[str], Path] | None = None,
        declared_models: set[str] | None = None,
        device: str = "cpu",
        ram_mb: int | None = None,
    ):
        self.workdir = Path(workdir)
        self.workdir.mkdir(parents=True, exist_ok=True)
        self._emit = emit
        self._cancelled = cancelled or threading.Event()
        self.log = Log(emit)
        self.models = Models(model_resolver, declared_models or set())
        self.guards = Guards(self.workdir)
        self.device = device
        self.limits = Limits(ram_mb)
        self._last_progress = -1.0

    # --- tiến độ & hủy -------------------------------------------------
    def progress(self, fraction: float, message: str = "") -> None:
        fraction = max(0.0, min(1.0, float(fraction)))
        # tránh gửi quá dày: chỉ gửi khi đổi >= 0.5% hoặc có message
        if message or abs(fraction - self._last_progress) >= 0.005:
            self._last_progress = fraction
            self._emit({"event": "progress", "value": round(fraction, 4), "message": message})

    def is_cancelled(self) -> bool:
        return self._cancelled.is_set()

    def check_cancelled(self) -> None:
        if self._cancelled.is_set():
            raise Cancelled()

    # --- môi trường ----------------------------------------------------
    def require_binary(self, name: str) -> str:
        found = _ffmpeg.find_binary(name) if name in ("ffmpeg", "ffprobe") else shutil.which(name)
        if not found:
            raise ToolError("MISSING_BINARY", f"Thiếu chương trình '{name}' trên máy chạy tool")
        return found

    def ffmpeg(
        self,
        args: list[str],
        *,
        total_seconds: float | None = None,
        progress_range: tuple[float, float] = (0.0, 1.0),
        message: str = "",
    ) -> None:
        """Chạy ffmpeg; tự quy đổi tiến độ vào khoảng progress_range và tôn trọng lệnh hủy."""
        a, b = progress_range
        if message:
            self.progress(a, message)
        _ffmpeg.run(
            args,
            total_seconds=total_seconds,
            on_progress=lambda f: self.progress(a + (b - a) * f),
            should_cancel=self.is_cancelled,
        )
        self.progress(b)

    def probe(self, path: str | Path) -> dict:
        return _ffmpeg.probe(path)

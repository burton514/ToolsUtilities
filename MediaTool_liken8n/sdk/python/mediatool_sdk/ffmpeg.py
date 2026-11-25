"""Tiện ích FFmpeg/ffprobe dùng chung cho mọi tool."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from collections import deque
from pathlib import Path
from typing import Callable

from .errors import Cancelled, ToolError


def find_binary(name: str) -> str | None:
    """Tìm binary: ưu tiên thư mục MEDIATOOL_FFMPEG_DIR, sau đó PATH."""
    custom = os.environ.get("MEDIATOOL_FFMPEG_DIR")
    if custom:
        for candidate in (Path(custom) / name, Path(custom) / f"{name}.exe"):
            if candidate.is_file():
                return str(candidate)
    return shutil.which(name)


def _require(name: str) -> str:
    path = find_binary(name)
    if not path:
        raise ToolError("MISSING_BINARY", f"Không tìm thấy '{name}'. Hãy cài FFmpeg hoặc đặt MEDIATOOL_FFMPEG_DIR.")
    return path


def probe(path: str | Path) -> dict:
    """Đọc thông tin file bằng ffprobe, trả JSON gốc (format + streams)."""
    exe = _require("ffprobe")
    proc = subprocess.run(
        [exe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if proc.returncode != 0:
        raise ToolError("PROBE_FAILED", f"Không đọc được file: {proc.stderr.strip()[-300:]}")
    return json.loads(proc.stdout or "{}")


def duration(path: str | Path) -> float | None:
    try:
        value = probe(path).get("format", {}).get("duration")
        return float(value) if value is not None else None
    except (ToolError, ValueError):
        return None


def run(
    args: list[str],
    *,
    total_seconds: float | None = None,
    on_progress: Callable[[float], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> None:
    """Chạy ffmpeg với args (không gồm tên chương trình).

    on_progress nhận tỉ lệ 0..1 (khi biết total_seconds). Lỗi → ToolError("FFMPEG_FAILED").
    """
    exe = _require("ffmpeg")
    cmd = [exe, "-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", *args]
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace",
    )
    stderr_tail: deque[str] = deque(maxlen=30)

    import threading

    def _drain() -> None:
        assert proc.stderr is not None
        for line in proc.stderr:
            stderr_tail.append(line.rstrip())

    t = threading.Thread(target=_drain, daemon=True)
    t.start()

    assert proc.stdout is not None
    for line in proc.stdout:
        if should_cancel and should_cancel():
            proc.kill()
            proc.wait()
            raise Cancelled()
        key, _, value = line.strip().partition("=")
        if key == "out_time_us" and total_seconds and on_progress:
            try:
                on_progress(min(1.0, max(0.0, int(value) / 1_000_000 / total_seconds)))
            except ValueError:
                pass
    code = proc.wait()
    t.join(timeout=2)
    if code != 0:
        raise ToolError("FFMPEG_FAILED", "FFmpeg lỗi: " + " | ".join(list(stderr_tail)[-5:]))

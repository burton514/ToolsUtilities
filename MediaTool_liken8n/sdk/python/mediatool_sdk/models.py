"""Lấy model theo `[[models]]` khi chạy tool ngoài core (unit test, `mediatool-dev run`).

Cùng quy tắc với core (`core/crates/jobs/src/models.rs`): mọi file phải có sha256, tải vào `.part`, kiểm mã băm rồi
mới đổi tên, đánh dấu `.verified`. Lưu ở `$MEDIATOOL_DATA/models/<id>/` (không có thì `~/.cache/mediatool/models`),
nên model đã tải khi test dùng lại được, và ngược lại.
"""
from __future__ import annotations

import hashlib
import os
import urllib.request
from pathlib import Path
from typing import Any, Callable


def models_dir() -> Path:
    data = os.environ.get("MEDIATOOL_DATA")
    return Path(data) / "models" if data else Path.home() / ".cache" / "mediatool" / "models"


def files(spec: dict[str, Any]) -> list[tuple[str, str, str]]:
    """[(tên file, url, sha256)] của model."""
    if spec.get("files"):
        return [(f["path"], f["url"], f["sha256"]) for f in spec["files"]]
    name = spec.get("file") or spec.get("url", "").rsplit("/", 1)[-1].split("?")[0] or "model.bin"
    return [(name, spec.get("url", ""), spec.get("sha256", ""))]


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def ensure(spec: dict[str, Any], root: Path | None = None, log: Callable[[str], None] = print) -> Path:
    """Đường dẫn model (file nếu một file, thư mục nếu nhiều file); tải lần đầu."""
    mid = str(spec.get("id", ""))
    if not mid or ".." in mid or "/" in mid or "\\" in mid:
        raise ValueError(f"id model không hợp lệ: '{mid}'")
    d = (root or models_dir()) / mid
    lst = files(spec)
    target = d if spec.get("files") else d / lst[0][0]
    if (d / ".verified").is_file() and all((d / p).is_file() for p, _, _ in lst):
        return target
    d.mkdir(parents=True, exist_ok=True)
    for p, url, sha in lst:
        parts = p.split("/")
        if not p or p.startswith("/") or "\\" in p or any(s in ("", ".", "..") for s in parts):
            raise ValueError(f"Model '{mid}': đường dẫn file không hợp lệ '{p}'")
        if not url or len(sha) != 64:
            raise ValueError(f"Model '{mid}' thiếu url hoặc sha256 cho '{p}'")
        dest = d / p
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.is_file() and _sha256(dest) == sha:
            continue
        log(f"Đang tải model {mid}: {p}")
        part = dest.with_suffix(dest.suffix + ".part")
        h = hashlib.sha256()
        with urllib.request.urlopen(url, timeout=60) as r, part.open("wb") as out:  # noqa: S310 — url từ manifest
            for b in iter(lambda: r.read(1 << 20), b""):
                out.write(b)
                h.update(b)
        if h.hexdigest() != sha:
            part.unlink(missing_ok=True)
            raise ValueError(f"Model '{mid}' ({p}): sai sha256 — file tải về không đúng, đã xóa")
        part.replace(dest)
    (d / ".verified").write_text("ok")
    return target


def resolver(manifest: dict[str, Any], log: Callable[[str], None] = print) -> Callable[[str], Path]:
    specs = {m["id"]: m for m in manifest.get("models", []) if isinstance(m, dict) and m.get("id")}
    return lambda mid: ensure(specs[mid], log=log)

"""Dựng hình dùng chung cho mọi tool: đọc thư viện, đo media, dựng composition, gọi engine native.

Tool dựng hình (áp hiệu ứng, chèn chữ theo phụ đề, mẫu dựng sẵn, xuất bản dựng…) đều đi qua đây, nên chỉ có
MỘT đường gọi engine `mediatool-render` (Rust: Skia + FFmpeg) và MỘT cách đọc thư viện `library/`.
Định dạng composition: docs/COMPOSITION_FORMAT.md.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tomllib
from pathlib import Path
from typing import Any

from .errors import ToolError

# ---------------------------------------------------------------- thư viện


def library_dir() -> Path:
    """`MEDIATOOL_LIBRARY`, hoặc thư mục `library/` của repo (dò ngược từ SDK)."""
    env = os.environ.get("MEDIATOOL_LIBRARY")
    if env:
        return Path(env)
    for p in Path(__file__).resolve().parents:
        if (p / "library" / "effects").is_dir():
            return p / "library"
    return Path("library")


def library_effects(kind: str | None = None) -> list[dict[str, Any]]:
    """Gói hiệu ứng trong thư viện: [{id, name, category, kind, description, params}] (đọc effect.toml)."""
    out = []
    root = library_dir() / "effects"
    for d in sorted(root.glob("*/effect.toml")) if root.is_dir() else []:
        try:
            m = tomllib.loads(d.read_text(encoding="utf-8"))
        except (OSError, tomllib.TOMLDecodeError):
            continue
        e = dict(m.get("effect", {}))
        e["params"] = m.get("param", [])
        if e.get("id") and (kind is None or e.get("kind", "effect") == kind):
            out.append(e)
    return out


CATEGORY_LABEL = {
    "look": "Bộ màu", "film": "Phim", "stylize": "Nghệ thuật", "distort": "Biến dạng",
    "light": "Ánh sáng", "key": "Tách nền màu", "transition": "Chuyển cảnh",
}


def effect_choices(kind: str | None = "effect") -> tuple[list[str], dict[str, str]]:
    """(danh sách id, nhãn tiếng Việt) để làm tham số chọn hiệu ứng (JSON Schema `enum` + `x-labels`)."""
    effects = library_effects(kind)
    ids = [e["id"] for e in effects]
    labels = {e["id"]: f"{CATEGORY_LABEL.get(e.get('category', ''), e.get('category', ''))} · {e['name']}" for e in effects}
    return ids, labels


def library_templates() -> list[dict[str, Any]]:
    """Mẫu dựng sẵn: library/templates/<id>/template.json → [{id, name, description, slots, ..., path}]."""
    out = []
    root = library_dir() / "templates"
    for f in sorted(root.glob("*/template.json")) if root.is_dir() else []:
        try:
            t = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        t["path"] = str(f)
        t.setdefault("id", f.parent.name)
        out.append(t)
    return out


# ---------------------------------------------------------------- đo media


def probe(path: str | Path) -> dict[str, Any]:
    """Thông số cơ bản của video/ảnh/âm thanh: width, height, duration_s, fps, has_audio, has_video."""
    exe = shutil.which("ffprobe")
    if not exe:
        raise ToolError("MISSING_BINARY", "Không tìm thấy ffprobe")
    r = subprocess.run([exe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise ToolError("PROBE_FAILED", f"Không đọc được file: {r.stderr.strip()[-200:]}")
    raw = json.loads(r.stdout or "{}")
    streams = raw.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    num, _, den = ((v or {}).get("avg_frame_rate") or "0/1").partition("/")
    fps = float(num) / float(den) if float(den or 0) else 0.0
    return {
        "width": int((v or {}).get("width") or 0), "height": int((v or {}).get("height") or 0),
        "duration_s": float((raw.get("format") or {}).get("duration") or 0), "fps": round(fps, 3),
        "has_audio": a is not None, "has_video": v is not None,
    }


# ---------------------------------------------------------------- dựng composition


def composition(width: int, height: int, fps: float = 30, duration: float = 5, background: str = "#000000") -> dict[str, Any]:
    w, h = max(2, int(width)) & ~1, max(2, int(height)) & ~1
    return {"version": 1, "canvas": {"width": w, "height": h, "fps": fps or 30, "background": background},
            "duration": duration, "markers": [], "layers": []}


def media_layer(path: str | Path, kind: str, start: float = 0, duration: float = 5, *, id: str = "media", fit: str = "contain", **extra: Any) -> dict[str, Any]:
    """Lớp video/ảnh/âm thanh phủ khung (kind: video | image | audio)."""
    layer: dict[str, Any] = {"id": id, "name": Path(path).name, "type": kind, "source": str(path), "start": start, "duration": duration}
    if kind != "audio":
        layer["fit"] = fit
    if kind in ("video", "audio"):
        layer.update({"trim_start": 0, "volume": 100, "muted": False})
    layer.update(extra)
    return layer


def text_layer(text: str, start: float, duration: float, *, id: str, style: dict[str, Any] | None = None, y: float = 0.5, **extra: Any) -> dict[str, Any]:
    layer = {"id": id, "name": text[:30], "type": "text", "text": text, "start": start, "duration": duration, "x": 0.5, "y": y,
             "style": {"font": "Noto Sans", "weight": 800, "size": 72, "fill": "#FFFFFF", "align": "center", "max_width": 0.9, **(style or {})}}
    layer.update(extra)
    return layer


# ---------------------------------------------------------------- gọi engine


def _engine() -> str:
    exe = os.environ.get("MEDIATOOL_RENDER") or shutil.which("mediatool-render")
    if not exe:
        raise ToolError("MISSING_BINARY", "Không tìm thấy engine 'mediatool-render'")
    return exe


def require_engine() -> None:
    _engine()


def _run(args: list[str], ctx: Any, progress_range: tuple[float, float]) -> dict[str, Any]:
    a, b = progress_range
    proc = subprocess.Popen([_engine(), *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    last: dict[str, Any] = {}
    error = None
    assert proc.stdout is not None
    for line in proc.stdout:
        if ctx is not None and ctx.is_cancelled():
            proc.kill()
            ctx.check_cancelled()
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "progress" in ev and ctx is not None:
            ctx.progress(a + (b - a) * float(ev["progress"]), ev.get("message", ""))
        elif "error" in ev:
            error = ev["error"]
        elif ev.get("done"):
            last = ev
    code = proc.wait()
    if code != 0 or error:
        tail = (proc.stderr.read() if proc.stderr else "")[-400:]
        raise ToolError("RENDER_FAILED", error or tail or f"engine thoát mã {code}")
    return last


def render(comp: dict[str, Any], out: Path, ctx: Any = None, quality: str = "standard", progress_range: tuple[float, float] = (0.0, 0.99)) -> Path:
    """Xuất composition thành video MP4 bằng engine native (xuất song song theo đoạn, có cache)."""
    src = Path(out).with_suffix(".composition.json")
    src.write_text(json.dumps(comp, ensure_ascii=False), encoding="utf-8")
    _run(["export", "--composition", str(src), "--out", str(out), "--quality", quality], ctx, progress_range)
    return Path(out)


def render_frame(comp: dict[str, Any], out: Path, time: float = 0.0, width: int | None = None) -> Path:
    """Render một khung hình (ảnh JPEG) — dùng cho đầu ra là ảnh (thumbnail, áp hiệu ứng cho ảnh…)."""
    src = Path(out).with_suffix(".composition.json")
    src.write_text(json.dumps(comp, ensure_ascii=False), encoding="utf-8")
    w = width or comp["canvas"]["width"]
    _run(["frame", "--composition", str(src), "--out", str(out), "--time", str(time), "--width", str(w)], None, (0, 1))
    return Path(out)


def edit(comp: dict[str, Any], ops: list[dict[str, Any]], workdir: Path) -> dict[str, Any]:
    """Áp danh sách thao tác lên composition bằng engine (cùng bảng lệnh mà editor/API dùng)."""
    src, ops_f, out = workdir / "edit.in.json", workdir / "edit.ops.json", workdir / "edit.out.json"
    src.write_text(json.dumps(comp, ensure_ascii=False), encoding="utf-8")
    ops_f.write_text(json.dumps(ops, ensure_ascii=False), encoding="utf-8")
    _run(["edit", "--composition", str(src), "--ops", str(ops_f), "--out", str(out)], None, (0, 1))
    return json.loads(out.read_text(encoding="utf-8"))

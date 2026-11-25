"""compose_render — lớp vỏ mỏng quanh engine native `mediatool-render` (Rust: Skia + FFmpeg).

Tool chỉ làm 2 việc: giải nguồn trong composition thành đường dẫn file, rồi gọi engine và chuyển tiến độ.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Literal

from pydantic import BaseModel, Field

from mediatool_sdk import BaseTool, Composition, Context, InputError, Result, ToolError, VideoFile
from mediatool_sdk.assets import Asset


class Inputs(BaseModel):
    composition: Composition = Field(description="Bản dựng (JSON) cần xuất thành video")
    media: list[Asset] = Field(default_factory=list, description="Các file nguồn mà bản dựng tham chiếu (video, ảnh, âm thanh)")


class Params(BaseModel):
    quality: Literal["draft", "standard", "high"] = Field(
        "standard", description="draft: 540p, nhanh để xem thử · standard: đúng khung bản dựng · high: chất lượng cao, chậm hơn")


class Outputs(BaseModel):
    video: VideoFile = Field(description="Video MP4 (H.264 + AAC) đã xuất")


def _engine() -> str:
    exe = os.environ.get("MEDIATOOL_RENDER") or shutil.which("mediatool-render")
    if not exe:
        raise ToolError("MISSING_BINARY", "Không tìm thấy engine 'mediatool-render'")
    return exe


class ComposeRenderTool(BaseTool[Inputs, Params, Outputs]):
    def check(self, ctx: Context) -> None:
        _engine()
        ctx.require_binary("ffmpeg")

    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        comp = inputs.composition.load()
        by_id = {m.asset_id: m for m in inputs.media if m.asset_id}
        by_name = {m.filename: m for m in inputs.media}

        # "asset:<id>" (từ editor/API) hoặc "file:<tên>" (ví dụ, test) → đường dẫn thật
        for layer in comp.get("layers", []):
            src = layer.get("source")
            if not src:
                continue
            kind, _, ref = src.partition(":")
            found = by_id.get(ref) if kind == "asset" else by_name.get(ref) if kind == "file" else None
            if found is None:
                raise InputError("media", f"Thiếu file nguồn '{src}' của lớp '{layer.get('name', layer.get('id'))}' trong input media")
            layer["source"] = str(found.path)

        resolved = ctx.workdir / "composition.resolved.json"
        resolved.write_text(json.dumps(comp, ensure_ascii=False), encoding="utf-8")
        out = ctx.workdir / "video.mp4"

        proc = subprocess.Popen(
            [_engine(), "export", "--composition", str(resolved), "--out", str(out), "--quality", params.quality],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace",
        )
        error = None
        assert proc.stdout is not None
        for line in proc.stdout:
            if ctx.is_cancelled():
                proc.kill()
                ctx.check_cancelled()
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "progress" in ev:
                ctx.progress(float(ev["progress"]) * 0.99, ev.get("message", ""))
            elif "error" in ev:
                error = ev["error"]
        code = proc.wait()
        if code != 0 or error:
            raise ToolError("RENDER_FAILED", error or (proc.stderr.read() if proc.stderr else "")[-400:] or f"engine thoát mã {code}")

        video = VideoFile(path=out)
        w, h = comp["canvas"]["width"], comp["canvas"]["height"]
        return Result(outputs=Outputs(video=video), summary=f"Đã xuất video {w}×{h} ({params.quality}), dài {video.duration_text}")

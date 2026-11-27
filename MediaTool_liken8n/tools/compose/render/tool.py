"""compose_render — lớp vỏ mỏng quanh engine native `mediatool-render` (Rust: Skia + FFmpeg).

Tool chỉ làm 2 việc: giải nguồn trong composition thành đường dẫn file, rồi xuất bằng `mediatool_sdk.compose.render`
(cùng đường gọi engine với mọi tool dựng hình khác: tiến độ, hủy, báo lỗi giống nhau).
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from mediatool_sdk import BaseTool, Composition, Context, InputError, Result, VideoFile
from mediatool_sdk import compose
from mediatool_sdk.assets import Asset


class Inputs(BaseModel):
    composition: Composition = Field(description="Bản dựng (JSON) cần xuất thành video")
    media: list[Asset] = Field(default_factory=list, description="Các file nguồn mà bản dựng tham chiếu (video, ảnh, âm thanh)")


class Params(BaseModel):
    quality: Literal["draft", "standard", "high"] = Field(
        "standard", description="Chất lượng video", json_schema_extra={"x-labels": {"draft": "Nháp — 540p, nhanh để xem thử", "standard": "Chuẩn — đúng khung bản dựng", "high": "Cao — đẹp nhất, chậm hơn"}})


class Outputs(BaseModel):
    video: VideoFile = Field(description="Video MP4 (H.264 + AAC) đã xuất")


def _stored_file(src: str) -> bool:
    """Đường dẫn file có thật nằm trong kho dữ liệu MediaTool (MEDIATOOL_DATA) — chỉ chấp nhận file của hệ thống."""
    data = os.environ.get("MEDIATOOL_DATA")
    p = Path(src)
    if not data or not p.is_absolute() or not p.is_file():
        return False
    try:
        p.resolve().relative_to(Path(data).resolve())
        return True
    except ValueError:
        return False


class ComposeRenderTool(BaseTool[Inputs, Params, Outputs]):
    def check(self, ctx: Context) -> None:
        compose.require_engine()
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
            # bản dựng do tool khác tạo (compose_bind, compose_template…) trỏ thẳng tới file asset trong kho dữ liệu
            if found is None and _stored_file(src):
                continue
            if found is None:
                raise InputError("media", f"Thiếu file nguồn '{src}' của lớp '{layer.get('name', layer.get('id'))}' trong input media")
            layer["source"] = str(found.path)

        out = compose.render(comp, ctx.workdir / "video.mp4", ctx, params.quality)

        video = VideoFile(path=out)
        w, h = comp["canvas"]["width"], comp["canvas"]["height"]
        return Result(outputs=Outputs(video=video), summary=f"Đã xuất video {w}×{h} ({params.quality}), dài {video.duration_text}")

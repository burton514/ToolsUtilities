"""compose_template — tạo video / ảnh từ mẫu dựng sẵn trong thư viện (màn tiêu đề, dải tên, đếm ngược, trích dẫn, thumbnail).

Mẫu là dữ liệu (`library/templates/<id>/template.json`): một bản dựng có chỗ trống `{{tên}}`. Tool điền chỗ trống
bằng chữ / ảnh / video người dùng đưa, chỉnh khung theo tỉ lệ, rồi render bằng engine (`mediatool_sdk.compose`).
"""
from __future__ import annotations

import copy
import json
import re
from typing import Any, Literal

from pydantic import BaseModel, Field

from mediatool_sdk import AudioFile, BaseTool, Composition, Context, ImageFile, InputError, Result, VideoFile
from mediatool_sdk import compose

_TEMPLATES = {t["id"]: t for t in compose.library_templates()}
_IDS = list(_TEMPLATES) or ["title_card"]
_LABELS = {k: f"{t.get('name', k)} ({'ảnh' if t.get('output') == 'image' else 'video'})" for k, t in _TEMPLATES.items()}
_SLOT = re.compile(r"\{\{(\w+)\}\}")


class Inputs(BaseModel):
    image: ImageFile | None = Field(None, description="Ảnh nền (tùy chọn)")
    video: VideoFile | None = Field(None, description="Video nền (tùy chọn) — mẫu dải tên nên dùng video")
    audio: AudioFile | None = Field(None, description="Nhạc nền (tùy chọn)")


class Params(BaseModel):
    template: str = Field("title_card" if "title_card" in _IDS else _IDS[0], description="Mẫu dựng sẵn", json_schema_extra={"enum": _IDS, "x-labels": _LABELS})
    title: str = Field("", max_length=200, description="Chữ chính (tiêu đề, tên, câu trích dẫn…); bỏ trống = chữ mẫu")
    subtitle: str = Field("", max_length=200, description="Chữ phụ (dòng mô tả, chức danh, tác giả…); bỏ trống = chữ mẫu")
    accent: str = Field("", pattern=r"^(#[0-9A-Fa-f]{6})?$", description="Màu nhấn dạng #RRGGBB; bỏ trống = màu của mẫu")
    ratio: Literal["16:9", "9:16", "1:1"] = Field("16:9", description="Khung hình", json_schema_extra={"x-labels": {"16:9": "16:9 — ngang (YouTube)", "9:16": "9:16 — dọc (TikTok, Reels)", "1:1": "1:1 — vuông"}})
    duration: float = Field(0, ge=0, le=600, description="Thời lượng (giây); 0 = theo mẫu (có video nền thì theo video)")
    quality: Literal["draft", "standard", "high"] = Field("standard", description="Chất lượng video", json_schema_extra={"x-labels": {"draft": "Nháp — nhanh để xem thử", "standard": "Chuẩn", "high": "Cao — đẹp nhất, chậm hơn"}})


class Outputs(BaseModel):
    video: VideoFile | None = Field(None, description="Video tạo từ mẫu (mẫu dạng video)")
    image: ImageFile | None = Field(None, description="Ảnh tạo từ mẫu (mẫu dạng ảnh, ví dụ thumbnail)")
    composition: Composition = Field(description="Bản dựng đã điền — sửa tiếp bằng compose_edit hoặc trong trình Dựng video")


def _fill(v: Any, values: dict[str, str]) -> Any:
    """Thay `{{tên}}` trong mọi chuỗi (đệ quy)."""
    if isinstance(v, str):
        return _SLOT.sub(lambda m: values.get(m.group(1), ""), v)
    if isinstance(v, list):
        return [_fill(x, values) for x in v]
    if isinstance(v, dict):
        return {k: _fill(x, values) for k, x in v.items()}
    return v


class ComposeTemplateTool(BaseTool[Inputs, Params, Outputs]):
    def check(self, ctx: Context) -> None:
        compose.require_engine()
        if not _TEMPLATES:
            raise RuntimeError("Thư viện chưa có mẫu nào (library/templates)")

    def validate(self, inputs: Inputs, params: Params, ctx: Context) -> None:
        if params.template not in _TEMPLATES:
            raise InputError("template", f"Không có mẫu '{params.template}'")

    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        t = _TEMPLATES[params.template]
        slots = t.get("slots", {})
        values = {k: str(s.get("default", "")) for k, s in slots.items() if s.get("kind") is None}
        if params.title:
            values["title"] = params.title
        if params.subtitle:
            values["subtitle"] = params.subtitle
        if params.accent:
            values["accent"] = params.accent
        files = {"image": inputs.image, "video": inputs.video}
        for k, f in files.items():
            if f is not None:
                values[k] = str(f.path)

        comp = _fill(copy.deepcopy(t["composition"]), values)
        comp["layers"] = [l for l in comp["layers"] if not l.get("_requires") or files.get(l["_requires"]) is not None]
        for l in comp["layers"]:
            l.pop("_requires", None)

        # khung + thời lượng
        w, h = {"16:9": (1920, 1080), "9:16": (1080, 1920), "1:1": (1080, 1080)}[params.ratio]
        comp["canvas"].update(width=w, height=h)
        base = float(t.get("duration", comp.get("duration", 5)))
        dur = params.duration or (compose.probe(inputs.video.path)["duration_s"] if inputs.video and t.get("output") != "image" else base)
        if abs(dur - base) > 1e-3 and t.get("output") != "image":
            k = dur / base
            for l in comp["layers"]:  # giãn đều nhịp của mẫu theo thời lượng mới
                if l.get("_bg") or l["type"] in ("video", "image") and l["start"] == 0 and abs(l["duration"] - base) < 1e-3:
                    l["duration"] = dur
                else:
                    l["start"], l["duration"] = l["start"] * k, l["duration"] * k
        comp["duration"] = dur
        if inputs.audio and t.get("output") != "image":
            comp["layers"].append(compose.media_layer(inputs.audio.path, "audio", 0, dur, id="music", fade_out=min(1.5, dur / 4)))

        comp_file = Composition.write(ctx.workdir / "composition.json", comp)
        name = t.get("name", params.template)
        if t.get("output") == "image":
            out = compose.render_frame(comp, ctx.workdir / "image.jpg", min(0.5, dur / 2))
            return Result(outputs=Outputs(image=ImageFile(path=out), composition=comp_file), summary=f"Đã tạo ảnh '{name}' {w}×{h}")
        out = compose.render(comp, ctx.workdir / "video.mp4", ctx, params.quality)
        v = VideoFile(path=out)
        return Result(outputs=Outputs(video=v, composition=comp_file), summary=f"Đã tạo video '{name}' {w}×{h}, dài {v.duration_text}")

"""media_apply — áp bộ màu / hiệu ứng trong thư viện cho video hoặc ảnh, kèm chỉnh sáng, tương phản, độ đậm màu.

Tool không tự vẽ gì: dựng một bản dựng một lớp (nguồn + hiệu ứng) rồi để engine native render
(`mediatool_sdk.compose`). Danh sách hiệu ứng đọc thẳng từ thư viện `library/effects`, thêm gói là tool có ngay.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from mediatool_sdk import BaseTool, Context, ImageFile, InputError, Result, VideoFile
from mediatool_sdk import compose

_IDS, _LABELS = compose.effect_choices("effect")
_IDS = ["none", *_IDS]
_LABELS = {"none": "Không dùng hiệu ứng (chỉ chỉnh màu)", **_LABELS}


class Inputs(BaseModel):
    video: VideoFile | None = Field(None, description="Video cần áp hiệu ứng (đưa video hoặc ảnh)")
    image: ImageFile | None = Field(None, description="Ảnh cần áp hiệu ứng (đưa video hoặc ảnh)")


class Params(BaseModel):
    effect: str = Field("teal_orange", description="Hiệu ứng: bộ màu, phim, nghệ thuật, biến dạng… lấy từ thư viện",
                        json_schema_extra={"enum": _IDS, "x-labels": _LABELS})
    strength: int = Field(100, ge=0, le=100, description="Độ mạnh của hiệu ứng: 0 = không thấy, 100 = đầy đủ")
    brightness: int = Field(0, ge=-100, le=100, description="Độ sáng: âm = tối hơn, dương = sáng hơn")
    contrast: int = Field(0, ge=-100, le=100, description="Tương phản: âm = dịu hơn, dương = gắt hơn")
    saturation: int = Field(0, ge=-100, le=100, description="Độ đậm màu: -100 = đen trắng, dương = rực hơn")
    quality: Literal["draft", "standard", "high"] = Field(
        "standard", description="Chất lượng video", json_schema_extra={"x-labels": {"draft": "Nháp — nhanh để xem thử", "standard": "Chuẩn — giữ kích thước gốc", "high": "Cao — đẹp nhất, chậm hơn"}})


class Outputs(BaseModel):
    video: VideoFile | None = Field(None, description="Video đã áp hiệu ứng (khi đầu vào là video)")
    image: ImageFile | None = Field(None, description="Ảnh đã áp hiệu ứng (khi đầu vào là ảnh)")


class MediaApplyTool(BaseTool[Inputs, Params, Outputs]):
    def check(self, ctx: Context) -> None:
        compose.require_engine()
        ctx.require_binary("ffprobe")

    def validate(self, inputs: Inputs, params: Params, ctx: Context) -> None:
        if (inputs.video is None) == (inputs.image is None):
            raise InputError("video", "Hãy đưa một video HOẶC một ảnh")
        if params.effect not in _IDS:
            raise InputError("effect", f"Không có hiệu ứng '{params.effect}' trong thư viện")

    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        src = inputs.video or inputs.image
        kind = "video" if inputs.video else "image"
        info = compose.probe(src.path)
        if not info["width"]:
            raise InputError(kind, "File không có hình")
        duration = info["duration_s"] if kind == "video" else 1.0
        comp = compose.composition(info["width"], info["height"], fps=info["fps"] or 30, duration=duration)

        effects = []
        for name, amount in (("brightness", params.brightness), ("contrast", params.contrast), ("saturation", params.saturation)):
            if amount:
                effects.append({"type": name, "amount": amount})
        if params.effect != "none" and params.strength > 0:
            effects.append({"type": params.effect, "amount": params.strength})
        comp["layers"].append(compose.media_layer(src.path, kind, 0, duration, fit="cover", effects=effects))

        name = _LABELS.get(params.effect, params.effect).split(" · ")[-1]
        what = f"'{name}' ({params.strength}%)" if params.effect != "none" else "chỉnh màu"
        if kind == "video":
            out = compose.render(comp, ctx.workdir / "video.mp4", ctx, params.quality)
            v = VideoFile(path=out)
            return Result(outputs=Outputs(video=v), summary=f"Đã áp {what} cho video {v.duration_text}")
        out = compose.render_frame(comp, ctx.workdir / "image.jpg", 0.0)
        return Result(outputs=Outputs(image=ImageFile(path=out)), summary=f"Đã áp {what} cho ảnh {info['width']}×{info['height']}")

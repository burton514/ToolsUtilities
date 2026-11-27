"""compose_edit — sửa bản dựng bằng danh sách thao tác (thêm/xóa/sắp lớp, đặt thuộc tính, thêm hiệu ứng, chuyển động…).

Thao tác do engine thực hiện (`mediatool-render edit`, cùng bảng lệnh với API `POST /v1/composition/edit`), nên mọi nơi
sửa bản dựng theo cùng một cách và bản dựng sau khi sửa luôn được kiểm tra hợp lệ.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from mediatool_sdk import BaseTool, Composition, Context, InputError, JsonData, Result, ToolError
from mediatool_sdk import compose, timed

OPS = ["add_layer", "update_layer", "remove_layer", "move_layer", "set", "add_effect", "add_animation", "add_marker", "merge"]


class Inputs(BaseModel):
    composition: Composition = Field(description="Bản dựng cần sửa (JSON)")
    markers: JsonData | None = Field(None, description="Dữ liệu thời gian thêm thành mốc của bản dựng: nhịp (music_beat_track), câu thoại, cảnh…")


class Params(BaseModel):
    ops: list[dict[str, Any]] = Field(
        description=(
            "Danh sách thao tác, chạy lần lượt. Mỗi thao tác có 'op': add_layer {layer, index?} · update_layer {target, patch} · "
            "remove_layer {target} · move_layer {target, index} · set {path, value} · add_effect {target, effect} · "
            "add_animation {target, animation} · add_marker {marker} · merge {patch}. "
            "target = id lớp, '*' (mọi lớp) hoặc 'type:text' (mọi lớp chữ). Ví dụ: "
            '[{"op":"add_effect","target":"*","effect":{"type":"film_grain"}}]'
        ),
        default_factory=list,
    )
    marker_kind: str = Field("", max_length=40, pattern=r"^[a-z0-9_]*$",
                             description="Loại mốc khi dữ liệu chưa có loại (ví dụ 'line', 'scene'); bỏ trống = 'cue'. Nhịp giữ beat / downbeat")


class Outputs(BaseModel):
    composition: Composition = Field(description="Bản dựng đã sửa")


def to_markers(data: object, kind: str) -> list[dict[str, object]]:
    """Dữ liệu thời gian bất kỳ → mốc của bản dựng. Có sẵn `markers` (BeatGrid…) thì dùng nguyên; còn lại đọc như
    TimedData (phụ đề, phiên âm, cảnh) — mỗi mục một mốc có đầu / cuối / nhãn."""
    if isinstance(data, dict) and isinstance(data.get("markers"), list):
        return [m for m in data["markers"] if isinstance(m, dict) and "start" in m]
    try:
        items = timed.from_transcript(data)
    except (KeyError, TypeError, ValueError) as e:
        raise InputError("markers", f"Không đọc được dữ liệu thời gian: {e}") from e
    return [{"id": f"{kind}{i + 1}", "start": it["start"], "end": it["end"], "label": it.get("text", ""), "kind": kind}
            for i, it in enumerate(items)]


class ComposeEditTool(BaseTool[Inputs, Params, Outputs]):
    def check(self, ctx: Context) -> None:
        compose.require_engine()

    def validate(self, inputs: Inputs, params: Params, ctx: Context) -> None:
        if not params.ops and inputs.markers is None:
            raise InputError("ops", "Cần ít nhất một thao tác hoặc dữ liệu mốc thời gian")
        for i, op in enumerate(params.ops, 1):
            if op.get("op") not in OPS:
                raise InputError("ops", f"Thao tác #{i}: 'op' phải là một trong {', '.join(OPS)}")

    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        ops = list(params.ops)
        if inputs.markers is not None:
            ops += [{"op": "add_marker", "marker": m} for m in to_markers(inputs.markers.load(), params.marker_kind or "cue")]
        try:
            edited = compose.edit(inputs.composition.load(), ops, ctx.workdir)
        except ToolError as e:
            raise InputError("ops", f"Không áp được thao tác: {e}") from e
        out = Composition.write(ctx.workdir / "composition.json", edited)
        n = len(edited.get("layers", []))
        nm = len(ops) - len(params.ops)
        extra = f", thêm {nm} mốc thời gian" if nm else ""
        return Result(outputs=Outputs(composition=out), summary=f"Đã áp {len(params.ops)} thao tác{extra}; bản dựng còn {n} lớp")

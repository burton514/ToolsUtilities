"""Chạy một tool: dùng chung cho worker (production), CLI mediatool-dev và unit test."""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Callable

from pydantic import BaseModel, ValidationError

from .assets import Asset, accepts
from .context import Context, Emit
from .errors import InputError, ToolError
from .loader import load_tool_class, read_manifest
from .schema import _unwrap
from .tool import Result


def _asset_from_raw(cls: type[Asset], field: str, raw: Any, base_dir: Path | None) -> Asset:
    """raw: {"format","path","asset_id","meta"} hoặc chuỗi đường dẫn."""
    if isinstance(raw, (str, Path)):
        raw = {"path": str(raw)}
    if not isinstance(raw, dict) or "path" not in raw:
        raise InputError(field, f"Input '{field}' phải là một file")
    path = Path(raw["path"])
    if not path.is_absolute() and base_dir is not None:
        path = (base_dir / path).resolve()
    if not path.exists():
        raise InputError(field, f"Không tìm thấy file của input '{field}': {path}")
    fmt = raw.get("format")
    if fmt and not accepts(cls.FORMAT, fmt):
        raise InputError(field, f"Input '{field}' cần loại '{cls.FORMAT}', nhận được '{fmt}'")
    return cls(path=path, asset_id=raw.get("asset_id"), meta=dict(raw.get("meta") or {}))


def build_inputs(model: type[BaseModel], raw: dict[str, Any], base_dir: Path | None = None) -> BaseModel:
    raw = dict(raw or {})
    unknown = set(raw) - set(model.model_fields)
    if unknown:
        raise InputError(sorted(unknown)[0], f"Input không tồn tại: {', '.join(sorted(unknown))}")
    values: dict[str, Any] = {}
    for name, f in model.model_fields.items():
        inner, multiple = _unwrap(f.annotation)
        if name not in raw or raw[name] is None:
            if f.is_required():
                raise InputError(name, f"Thiếu input bắt buộc '{name}'")
            continue
        if isinstance(inner, type) and issubclass(inner, Asset):
            if multiple:
                items = raw[name] if isinstance(raw[name], list) else [raw[name]]
                values[name] = [_asset_from_raw(inner, name, it, base_dir) for it in items]
            else:
                values[name] = _asset_from_raw(inner, name, raw[name], base_dir)
        else:
            values[name] = raw[name]
    try:
        return model.model_validate(values)
    except ValidationError as e:
        err = e.errors()[0]
        raise InputError(str(err["loc"][0]) if err["loc"] else "inputs", err["msg"]) from e


def build_params(model: type[BaseModel], raw: dict[str, Any]) -> BaseModel:
    raw = dict(raw or {})
    unknown = set(raw) - set(model.model_fields)
    if unknown:
        raise InputError(sorted(unknown)[0], f"Tham số không tồn tại: {', '.join(sorted(unknown))}")
    try:
        return model.model_validate(raw)
    except ValidationError as e:
        err = e.errors()[0]
        field = str(err["loc"][0]) if err["loc"] else "params"
        raise InputError(field, f"Tham số '{field}' không hợp lệ: {err['msg']}") from e


def serialize_outputs(outputs: BaseModel, workdir: Path) -> dict[str, Any]:
    workdir = workdir.resolve()

    def one(name: str, value: Any) -> Any:
        if isinstance(value, Asset):
            p = Path(value.path)
            p = (workdir / p).resolve() if not p.is_absolute() else p.resolve()
            if not p.exists():
                raise ToolError("OUTPUT_MISSING", f"Output '{name}' không tồn tại: {p}")
            if workdir not in p.parents and p != workdir:
                raise ToolError("OUTPUT_OUTSIDE_WORKDIR", f"Output '{name}' phải nằm trong ctx.workdir")
            return {"format": value.FORMAT, "path": str(p)}
        if isinstance(value, list):
            return [one(name, v) for v in value]
        return {"value": value}

    result: dict[str, Any] = {}
    for name in type(outputs).model_fields:
        value = getattr(outputs, name)
        if value is None or value == []:
            continue
        result[name] = one(name, value)
    return result


def run_tool_dir(
    tool_dir: Path,
    inputs: dict[str, Any],
    params: dict[str, Any],
    workdir: Path,
    emit: Emit,
    *,
    cancelled: threading.Event | None = None,
    model_resolver: Callable[[str], Path] | None = None,
    device: str = "cpu",
    ram_mb: int | None = None,
    base_dir: Path | None = None,
) -> dict[str, Any]:
    """Chạy tool, trả {"summary", "outputs", "warnings"}. Lỗi → raise ToolError / InputError / Cancelled."""
    tool_dir = Path(tool_dir).resolve()
    manifest = read_manifest(tool_dir)
    cls = load_tool_class(tool_dir, manifest)
    declared = {m.get("id") for m in manifest.get("models", []) if isinstance(m, dict)}
    ctx = Context(
        workdir, emit, cancelled=cancelled, model_resolver=model_resolver,
        declared_models={d for d in declared if d}, device=device, ram_mb=ram_mb,
    )
    tool = cls()
    tool.check(ctx)
    inp = build_inputs(cls.Inputs, inputs, base_dir)
    par = build_params(cls.Params, params)
    tool.validate(inp, par, ctx)
    ctx.check_cancelled()
    out = tool.run(inp, par, ctx)
    if not isinstance(out, Result):
        out = Result(outputs=out)
    if not isinstance(out.outputs, cls.Outputs):
        raise ToolError("BAD_OUTPUTS", f"run() phải trả {cls.Outputs.__name__}")
    ctx.progress(1.0)
    return {
        "summary": out.summary,
        "outputs": serialize_outputs(out.outputs, ctx.workdir),
        # cảnh báo khai báo trong Result + cảnh báo ghi qua ctx.log.warning lúc chạy (bỏ trùng, giữ thứ tự)
        "warnings": list(dict.fromkeys([*ctx.log.warnings, *out.warnings])),
    }

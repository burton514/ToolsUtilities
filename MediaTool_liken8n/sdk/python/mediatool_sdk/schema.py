"""Sinh mô tả I/O (describe) từ các model Pydantic của tool."""
from __future__ import annotations

import types
from typing import Any, Union, get_args, get_origin

from pydantic import BaseModel

from .assets import Asset
from .tool import BaseTool

PROTOCOL = 1

_JSON_TYPES = {str: "string", int: "integer", float: "number", bool: "boolean", dict: "object", list: "array"}


def _unwrap(annotation: Any) -> tuple[Any, bool]:
    """Bỏ Optional; trả (kiểu bên trong, multiple)."""
    origin = get_origin(annotation)
    if origin in (Union, types.UnionType):
        args = [a for a in get_args(annotation) if a is not type(None)]
        if len(args) == 1:
            return _unwrap(args[0])
    if origin in (list, tuple, set):
        inner = get_args(annotation)
        return (inner[0] if inner else Any), True
    return annotation, False


def field_specs(model: type[BaseModel]) -> list[dict[str, Any]]:
    specs = []
    for name, f in model.model_fields.items():
        inner, multiple = _unwrap(f.annotation)
        spec: dict[str, Any] = {
            "name": name,
            "required": f.is_required(),
            "multiple": multiple,
            "description": f.description or "",
        }
        if isinstance(inner, type) and issubclass(inner, Asset):
            spec["format"] = inner.FORMAT
        else:
            spec["format"] = None
            spec["type"] = _JSON_TYPES.get(inner, "string") if isinstance(inner, type) else "string"
        specs.append(spec)
    return specs


def params_schema(model: type[BaseModel]) -> dict[str, Any]:
    schema = model.model_json_schema()
    schema.setdefault("type", "object")
    schema.setdefault("properties", {})
    # Hợp đồng chặt: không nhận tham số lạ hay tên thay thế.
    schema["additionalProperties"] = False
    return schema


def describe(tool_cls: type[BaseTool], manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "protocol": PROTOCOL,
        "id": manifest["tool"]["id"],
        "inputs": field_specs(tool_cls.Inputs),
        "outputs": field_specs(tool_cls.Outputs),
        "params_schema": params_schema(tool_cls.Params),
    }

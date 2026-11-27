"""Đọc manifest và nạp class tool từ thư mục tool (không cần __init__.py)."""
from __future__ import annotations

import importlib
import re
import sys
import tomllib
import types
from pathlib import Path
from typing import Any

from .tool import BaseTool

ID_RE = re.compile(r"^[a-z][a-z0-9_]*$")


def read_manifest(tool_dir: Path) -> dict[str, Any]:
    path = Path(tool_dir) / "manifest.toml"
    if not path.is_file():
        raise FileNotFoundError(f"Không thấy {path}")
    with path.open("rb") as f:
        m = tomllib.load(f)
    # [[models]] dùng chung: `models_from = ["vieneu"]` → tools/_models/vieneu.toml (id trùng: khai báo của tool thắng)
    shared = Path(tool_dir).resolve().parent.parent / "_models"
    models = list(m.get("models", []))
    for name in m.get("models_from", []):
        if not name or any(c in name for c in "/\\."):
            raise ValueError(f"models_from: tên danh mục không hợp lệ '{name}'")
        with (shared / f"{name}.toml").open("rb") as f:
            for spec in tomllib.load(f).get("models", []):
                if not any(x.get("id") == spec.get("id") for x in models):
                    models.append(spec)
    if models:
        m["models"] = models
    return m


def expected_id(tool_dir: Path) -> str:
    tool_dir = Path(tool_dir).resolve()
    return f"{tool_dir.parent.name}_{tool_dir.name}"


def load_tool_class(tool_dir: Path, manifest: dict[str, Any] | None = None) -> type[BaseTool]:
    tool_dir = Path(tool_dir).resolve()
    manifest = manifest or read_manifest(tool_dir)
    entry = manifest["tool"]["entry"]
    module_name, _, class_name = entry.partition(":")
    if not module_name or not class_name:
        raise ValueError(f"entry phải có dạng '<module>:<Class>', nhận được '{entry}'")

    # Mỗi tool là một package ảo riêng → import tương đối (from .internal import x) hoạt động,
    # và hai tool không bao giờ đụng tên module của nhau.
    pkg_name = "_mediatool_tool_" + re.sub(r"\W", "_", manifest["tool"]["id"])
    if pkg_name not in sys.modules:
        pkg = types.ModuleType(pkg_name)
        pkg.__path__ = [str(tool_dir)]  # type: ignore[attr-defined]
        sys.modules[pkg_name] = pkg
    module = importlib.import_module(f"{pkg_name}.{module_name}")
    cls = getattr(module, class_name, None)
    if cls is None or not (isinstance(cls, type) and issubclass(cls, BaseTool)):
        raise TypeError(f"'{entry}' không phải là class kế thừa BaseTool")
    if not all(hasattr(cls, n) for n in ("Inputs", "Params", "Outputs")):
        raise TypeError(f"{class_name} phải khai báo BaseTool[Inputs, Params, Outputs]")
    return cls


# ---------------------------------------------------------------- chuỗi (entry = "chain:<file>")
def chain_file(manifest: dict[str, Any]) -> str | None:
    """Tên file chuỗi nếu tool là chuỗi đã lưu, ngược lại None."""
    entry = str(manifest.get("tool", {}).get("entry", ""))
    return entry[len("chain:"):].strip() if entry.startswith("chain:") else None


def read_chain(tool_dir: Path, manifest: dict[str, Any] | None = None) -> dict[str, Any]:
    import json

    m = manifest or read_manifest(tool_dir)
    name = chain_file(m)
    if not name:
        raise ValueError("Tool này không phải chuỗi")
    return json.loads((Path(tool_dir) / name).read_text(encoding="utf-8"))


def describe_dir(tool_dir: Path, manifest: dict[str, Any] | None = None) -> dict[str, Any]:
    """Schema I/O của một thư mục tool — tool Python hoặc chuỗi — cùng một dạng (khớp core `ChainDef::describe`)."""
    from .schema import describe

    m = manifest or read_manifest(tool_dir)
    if not chain_file(m):
        return describe(load_tool_class(tool_dir, m), m)
    c = read_chain(tool_dir, m)
    io = lambda name, f, d, req=True, mul=False: {"name": name, "format": f, "required": req, "multiple": mul, "description": d}
    return {
        "inputs": [io(i["name"], i.get("format"), i.get("description", ""), i.get("required", True), i.get("multiple", False)) for i in c.get("inputs", [])],
        "outputs": [io(k, o.get("format"), o.get("description", "")) for k, o in sorted(c.get("outputs", {}).items())],
        "params_schema": resolve_chain_params(c.get("params") or {"type": "object", "properties": {}}, Path(tool_dir)),
        "check_error": None,
    }


def resolve_chain_params(schema: dict[str, Any], tool_dir: Path) -> dict[str, Any]:
    """Tham số chuỗi khai báo `{"$from": "<tool_id>.<tham số>"}` lấy nguyên schema tham số đó của tool (enum, nhãn,
    giới hạn…), các khóa khác cạnh `$from` (default, description) ghi đè. Giống core `resolve_chain_params`."""
    props = schema.get("properties", {})
    if not any(isinstance(p, dict) and "$from" in p for p in props.values()):
        return schema
    tools_root = Path(tool_dir).resolve().parent.parent
    cache: dict[str, dict[str, Any]] = {}
    out = {**schema, "properties": {}}
    for name, p in props.items():
        if isinstance(p, dict) and "$from" in p:
            tid, _, param = str(p["$from"]).rpartition(".")
            if tid not in cache:
                d = next((mf.parent for mf in tools_root.glob("*/*/manifest.toml") if read_manifest(mf.parent)["tool"]["id"] == tid), None)
                if d is None:
                    raise ValueError(f"$from: không có tool '{tid}'")
                cache[tid] = describe_dir(d)["params_schema"].get("properties", {})
            if param not in cache[tid]:
                raise ValueError(f"$from: tool '{tid}' không có tham số '{param}'")
            p = {**cache[tid][param], **{k: v for k, v in p.items() if k != "$from"}}
        out["properties"][name] = p
    return out

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
        return tomllib.load(f)


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

"""Tiện ích viết unit test cho tool, không cần core."""
from __future__ import annotations

import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .assets import ASSET_TYPES
from .errors import ToolError
from .loader import read_manifest
from .runner import run_tool_dir


def peak_ram_mb() -> float | None:
    try:
        import resource  # chỉ có trên Linux/macOS

        self_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        child_kb = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
        return round(max(self_kb, child_kb) / 1024, 1)
    except Exception:
        return None


class _Obj:
    """Truy cập output bằng thuộc tính: r.outputs.audio.path"""

    def __init__(self, data: dict[str, Any]):
        self._data = data

    def __getattr__(self, name: str) -> Any:
        try:
            return self._data[name]
        except KeyError:
            raise AttributeError(name) from None


def _wrap(value: Any) -> Any:
    if isinstance(value, list):
        return [_wrap(v) for v in value]
    if isinstance(value, dict) and "format" in value and "path" in value:
        cls = ASSET_TYPES.get(value["format"])
        return cls(path=Path(value["path"])) if cls else value
    if isinstance(value, dict) and "value" in value:
        return value["value"]
    return value


@dataclass
class TestResult:
    ok: bool
    summary: str = ""
    warnings: list[str] = field(default_factory=list)
    raw_outputs: dict[str, Any] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)
    error: Exception | None = None
    peak_ram_mb: float | None = None

    @property
    def outputs(self) -> _Obj:
        return _Obj({k: _wrap(v) for k, v in self.raw_outputs.items()})


def run_tool(
    tool_dir: str | Path,
    inputs: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
    workdir: str | Path | None = None,
    raise_errors: bool = True,
) -> TestResult:
    tool_dir = Path(tool_dir).resolve()
    events: list[dict[str, Any]] = []
    wd = Path(workdir) if workdir else Path(tempfile.mkdtemp(prefix="mediatool_"))
    try:
        res = run_tool_dir(tool_dir, inputs or {}, params or {}, wd, events.append, base_dir=tool_dir)
        return TestResult(True, res["summary"], res["warnings"], res["outputs"], events, None, peak_ram_mb())
    except ToolError as e:
        if raise_errors:
            raise
        return TestResult(False, events=events, error=e, peak_ram_mb=peak_ram_mb())


def run_example(tool_dir: str | Path, which: int | str = "all") -> list[TestResult]:
    """Chạy [[examples]] trong manifest. which = "all" hoặc số thứ tự (bắt đầu từ 1)."""
    tool_dir = Path(tool_dir).resolve()
    examples = read_manifest(tool_dir).get("examples", [])
    picked = examples if which == "all" else [examples[int(which) - 1]]
    return [run_tool(tool_dir, ex.get("inputs", {}), ex.get("params", {})) for ex in picked]

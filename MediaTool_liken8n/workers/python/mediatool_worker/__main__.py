"""Giao thức worker.

  python -m mediatool_worker describe --tool-dir <dir>
      → in 1 JSON: schema I/O (+ "check_error" nếu tool.check() báo lỗi môi trường)

  python -m mediatool_worker run
      stdin  dòng 1: job spec {"protocol","job_id","tool_dir","workdir","inputs","params","limits","device"}
      stdin  sau đó: {"cmd":"cancel"} | {"model_path": "..."} | {"error": "..."}
      stdout mỗi dòng 1 sự kiện: progress | log | model_request | result | error
"""
from __future__ import annotations

import json
import os
import queue
import sys
import threading
import traceback
from pathlib import Path
from typing import Any

from . import PROTOCOL


def _describe(tool_dir: Path) -> int:
    from mediatool_sdk.context import Context
    from mediatool_sdk.loader import load_tool_class, read_manifest
    from mediatool_sdk.schema import describe

    try:
        manifest = read_manifest(tool_dir)
        cls = load_tool_class(tool_dir, manifest)
        out = describe(cls, manifest)
    except Exception as e:  # lỗi nạp tool → core đánh dấu unavailable
        print(f"{type(e).__name__}: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return 2
    try:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            cls().check(Context(Path(tmp), lambda ev: None))
        out["check_error"] = None
    except Exception as e:
        out["check_error"] = getattr(e, "message", None) or str(e)
    sys.stdout.buffer.write(json.dumps(out, ensure_ascii=False).encode("utf-8"))
    sys.stdout.flush()
    return 0


def _peak_ram_mb() -> float | None:
    try:
        import resource

        a = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        b = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
        return round(max(a, b) / 1024, 1)
    except Exception:
        return None


def _serve() -> int:
    # Kênh giao thức = bản sao của stdout gốc. Sau đó fd 1 trỏ sang stderr, để print() của tool
    # hay subprocess không cẩn thận cũng không làm hỏng giao thức.
    proto = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1, newline="\n")
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    for stream in (sys.stdin, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:
            pass
    lock = threading.Lock()

    def emit(ev: dict[str, Any]) -> None:
        with lock:
            proto.write(json.dumps(ev, ensure_ascii=False) + "\n")
            proto.flush()

    line = sys.stdin.readline()
    if not line:
        return 2
    spec = json.loads(line)
    if spec.get("protocol") != PROTOCOL:
        emit({"event": "error", "kind": "crash", "code": "PROTOCOL_MISMATCH",
              "message": f"Worker hỗ trợ protocol {PROTOCOL}, nhận {spec.get('protocol')}"})
        return 2

    cancelled = threading.Event()
    replies: queue.Queue[dict[str, Any]] = queue.Queue()

    def reader() -> None:
        for raw in sys.stdin:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("cmd") == "cancel":
                cancelled.set()
            else:
                replies.put(msg)
        # stdin đóng: không tự hủy job; core sẽ kill process nếu cần dừng hẳn.
        replies.put({"error": "stdin đã đóng"})

    threading.Thread(target=reader, daemon=True).start()

    from mediatool_sdk.errors import Cancelled, ToolError
    from mediatool_sdk.runner import run_tool_dir

    def resolve_model(model_id: str) -> Path:
        emit({"event": "model_request", "id": model_id})
        reply = replies.get(timeout=3600)
        if reply.get("model_path"):
            return Path(reply["model_path"])
        raise ToolError("MODEL_UNAVAILABLE", reply.get("error") or f"Không lấy được model '{model_id}'")

    try:
        result = run_tool_dir(
            Path(spec["tool_dir"]), spec.get("inputs", {}), spec.get("params", {}), Path(spec["workdir"]), emit,
            cancelled=cancelled, model_resolver=resolve_model, device=spec.get("device", "cpu"),
            ram_mb=(spec.get("limits") or {}).get("ram_mb"),
        )
        emit({"event": "result", **result, "peak_ram_mb": _peak_ram_mb()})
        return 0
    except Cancelled:
        emit({"event": "error", "kind": "cancelled", "code": "CANCELLED", "message": "Đã hủy"})
        return 3
    except ToolError as e:
        field = getattr(e, "field", None)
        emit({"event": "error", "kind": e.kind, "code": e.code, "message": e.message, "field": field})
        return 1
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        emit({"event": "error", "kind": "crash", "code": "CRASH", "message": f"{type(e).__name__}: {e}"})
        return 1


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    if argv[0] == "describe":
        if "--tool-dir" not in argv:
            print("Thiếu --tool-dir", file=sys.stderr)
            return 2
        return _describe(Path(argv[argv.index("--tool-dir") + 1]).resolve())
    if argv[0] == "run":
        return _serve()
    print(f"Lệnh không hợp lệ: {argv[0]}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

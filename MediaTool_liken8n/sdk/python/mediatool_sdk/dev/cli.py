"""mediatool-dev: CLI cho người viết tool. Chạy được mà không cần core.

  mediatool-dev new <category>/<name>
  mediatool-dev describe <tool_dir>
  mediatool-dev validate <tool_dir> [<tool_dir> ...]
  mediatool-dev run <tool_dir> [--example N] [--input k=path] [--param k=value] [--workdir DIR]
  mediatool-dev test <tool_dir>
  mediatool-dev docs <tool_dir> [--check]
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from .. import models
from ..errors import Cancelled, ToolError
from ..loader import ID_RE, expected_id, load_tool_class, read_manifest, chain_file, describe_dir, read_chain
from ..runner import run_tool_dir
from ..schema import describe
from . import docs as docs_mod

HEAVY_MODULES = {
    "torch", "torchaudio", "tensorflow", "demucs", "whisper", "faster_whisper", "librosa", "cv2", "skia",
    "transformers", "onnxruntime", "scipy", "numba", "essentia", "scenedetect",
}
MAX_SAMPLE_BYTES = 2 * 1024 * 1024

# Windows console mặc định không phải UTF-8
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass


def _find_repo_root(start: Path) -> Path:
    for p in [start, *start.parents]:
        if (p / "tools" / "_template").is_dir():
            return p
    raise SystemExit("Không tìm thấy thư mục gốc repo (cần có tools/_template). Hãy chạy lệnh trong repo MediaTool.")


# ---------------------------------------------------------------- new
def cmd_new(args: argparse.Namespace) -> int:
    cat, _, name = args.path.strip("/\\").partition("/")
    if not cat or not name or not ID_RE.match(cat) or not ID_RE.match(name):
        print("Dùng: mediatool-dev new <category>/<name> (chữ thường, số, '_')")
        return 2
    root = _find_repo_root(Path.cwd())
    dest = root / "tools" / cat / name
    if dest.exists():
        print(f"Đã tồn tại: {dest}")
        return 1
    shutil.copytree(root / "tools" / "_template", dest, ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache"))
    tool_id = f"{cat}_{name}"
    class_name = "".join(part.capitalize() for part in name.split("_")) + "Tool"
    for f in dest.rglob("*"):
        if f.is_file() and f.suffix in {".py", ".toml", ".md"}:
            text = f.read_text(encoding="utf-8")
            text = (text.replace("__TOOL_ID__", tool_id).replace("__CATEGORY__", cat)
                        .replace("__NAME__", name).replace("__CLASS__", class_name))
            f.write_text(text, encoding="utf-8")
    print(f"✓ Đã tạo {dest.relative_to(root)} (id: {tool_id})")
    print("  Tiếp theo: sửa manifest.toml, tool.py, README.md rồi chạy `mediatool-dev validate`.")
    return 0


# ---------------------------------------------------------------- describe
def cmd_describe(args: argparse.Namespace) -> int:
    d = Path(args.tool_dir)
    m = read_manifest(d)
    print(json.dumps(describe_dir(d, m), ensure_ascii=False, indent=2))
    return 0


# ---------------------------------------------------------------- validate
def _top_level_heavy_imports(py: Path) -> list[str]:
    tree = ast.parse(py.read_text(encoding="utf-8"))
    found = []
    for node in tree.body:
        names = []
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names = [node.module]
        found += [n for n in names if n.split(".")[0] in HEAVY_MODULES]
    return found


def validate_tool(tool_dir: Path) -> list[tuple[bool, str]]:
    checks: list[tuple[bool, str]] = []

    def ok(cond: bool, msg: str) -> bool:
        checks.append((bool(cond), msg))
        return bool(cond)

    tool_dir = tool_dir.resolve()
    try:
        m = read_manifest(tool_dir)
    except Exception as e:
        ok(False, f"manifest.toml đọc được ({e})")
        return checks
    ok(True, "manifest.toml đọc được")
    t = m.get("tool", {})
    for key in ("id", "name", "version", "sdk", "entry", "summary", "license"):
        ok(bool(t.get(key)), f"[tool].{key} có giá trị")
    ok(t.get("id") == expected_id(tool_dir), f"id '{t.get('id')}' khớp đường dẫn ('{expected_id(tool_dir)}')")
    ok(bool(t.get("owners")), "[tool].owners có người phụ trách")
    if not str(t.get("entry", "")).startswith("chain:"):  # chuỗi không khai: core gom nguồn từ các bước
        srcs = t.get("sources") or []
        ok(bool(srcs) and all(isinstance(x, dict) and x.get("name") for x in srcs),
           "[tool].sources có nguồn (repo model / thư viện / engine) — hiện cạnh tên tool")
    r = m.get("runtime", {})
    ok(isinstance(r.get("ram_mb"), int) and r["ram_mb"] > 0, "[runtime].ram_mb là số dương")
    for md in m.get("models", []):
        ok(bool(md.get("license")), f"model '{md.get('id')}' có license")
        fl = models.files(md)
        ok(all(u.startswith("https://") and len(h) == 64 for _, u, h in fl), f"model '{md.get('id')}': mọi file có url https + sha256")
    ok(len(m.get("examples", [])) >= 1, "có ít nhất 1 [[examples]]")

    is_chain = bool(chain_file(m))
    for py in tool_dir.glob("*.py"):
        heavy = _top_level_heavy_imports(py)
        ok(not heavy, f"{py.name}: không import nặng ở đầu file" + (f" (đang import {', '.join(heavy)})" if heavy else ""))

    try:
        d = describe_dir(tool_dir, m)
        ok(True, "đọc được chuỗi và sinh được schema" if is_chain else "nạp được class tool và sinh được schema")
    except Exception as e:
        ok(False, f"nạp được {'chuỗi' if is_chain else 'class tool'} ({type(e).__name__}: {e})")
        return checks
    if is_chain:
        _validate_chain(tool_dir, m, ok)

    for f in d["inputs"]:
        ok(f["format"] is not None, f"input '{f['name']}' là kiểu asset (có format)")
        ok(bool(f["description"]), f"input '{f['name']}' có description")
    for f in d["outputs"]:
        ok(bool(f["description"]), f"output '{f['name']}' có description")
    for name, p in d["params_schema"].get("properties", {}).items():
        ok(bool(p.get("description")), f"param '{name}' có description")

    if not is_chain:  # chuỗi do core chạy; test bằng example trên sandbox / bảng kiểm thử
        tests = list((tool_dir / "tests").glob("test_*.py"))
        ok(bool(tests), "có test trong tests/test_*.py")
    for s in (tool_dir / "samples").glob("*"):
        if s.is_file() and s.name != ".gitkeep":
            ok(s.stat().st_size <= MAX_SAMPLE_BYTES, f"sample {s.name} ≤ 2 MB")
    for ex in m.get("examples", []):
        for k, v in (ex.get("inputs") or {}).items():
            for item in (v if isinstance(v, list) else [v]):
                ok((tool_dir / str(item)).exists(), f"example '{ex.get('title')}': file input '{item}' tồn tại")

    readme = tool_dir / "README.md"
    if ok(readme.is_file(), "có README.md"):
        text = readme.read_text(encoding="utf-8")
        ok("## 1. Tóm tắt" in text, "README có mục '1. Tóm tắt'")
        ok("AUTO:io:start" in text, "README có khối AUTO:io")
        try:
            fresh, changed = docs_mod.update_readme(tool_dir, check_only=True)
            ok(fresh, "các khối AUTO trong README đã cập nhật" + (f" (cũ: {', '.join(changed)} → chạy `mediatool-dev docs`)" if changed else ""))
        except Exception as e:
            ok(False, f"sinh được khối AUTO ({e})")
        placeholders = re.findall(r"__[A-Z_]+__", text)
        ok(not placeholders, "README không còn placeholder của template")
    ok((tool_dir / "CHANGELOG.md").is_file(), "có CHANGELOG.md")
    return checks


def _validate_chain(tool_dir: Path, m: dict, ok) -> None:
    """Chuỗi: mọi bước trỏ tới tool có thật, mọi tham chiếu `$input.*` / `$<bước>.*` / `$param.*` hợp lệ."""
    c = read_chain(tool_dir, m)
    root = tool_dir.parent.parent
    known = {}
    for mf in root.glob("*/*/manifest.toml"):
        if mf.parent.name.startswith("_") or mf.parent.parent.name.startswith("_"):
            continue
        try:
            om = read_manifest(mf.parent)
            known[om["tool"]["id"]] = describe_dir(mf.parent, om)
        except Exception:
            continue
    inputs = {i["name"] for i in c.get("inputs", [])}
    params = set((c.get("params") or {}).get("properties", {}))
    produced: dict[str, set[str]] = {}
    for s in c.get("steps", []):
        sd = known.get(s["tool"])
        if not ok(sd is not None, f"bước '{s['id']}': tool '{s['tool']}' có trong registry"):
            continue
        accepted = {f["name"] for f in sd["inputs"]}
        for k, v in s.get("inputs", {}).items():
            ok(k in accepted, f"bước '{s['id']}': '{s['tool']}' có input '{k}'")
            for r in (v if isinstance(v, list) else [v]):
                if isinstance(r, str) and r.startswith("$input."):
                    ok(r[7:] in inputs, f"bước '{s['id']}': {r} là input của chuỗi")
                elif isinstance(r, str) and r.startswith("$"):
                    step, _, out = r[1:].partition(".")
                    ok(out in produced.get(step, set()), f"bước '{s['id']}': {r} là output của bước trước")
        for v in json.dumps(s.get("params", {}), ensure_ascii=False).split('"'):
            if v.startswith("$param."):
                ok(v[7:] in params, f"bước '{s['id']}': {v} được khai báo trong params của chuỗi")
        produced[s["id"]] = {f["name"] for f in sd["outputs"]}
    for name, o in c.get("outputs", {}).items():
        step, _, out = str(o.get("from", ""))[1:].partition(".")
        ok(out in produced.get(step, set()), f"output '{name}' lấy từ {o.get('from')} có thật")


def cmd_validate(args: argparse.Namespace) -> int:
    failed = 0
    for d in args.tool_dirs:
        print(f"\n== {d}")
        for good, msg in validate_tool(Path(d)):
            print(f"  {'✓' if good else '✗'} {msg}")
            failed += 0 if good else 1
    print(f"\n{'OK' if not failed else f'{failed} lỗi'}")
    return 0 if not failed else 1


# ---------------------------------------------------------------- run
def _parse_kv(items: list[str]) -> dict:
    out = {}
    for it in items or []:
        k, _, v = it.partition("=")
        try:
            out[k] = json.loads(v)
        except json.JSONDecodeError:
            out[k] = v
    return out


def cmd_run(args: argparse.Namespace) -> int:
    tool_dir = Path(args.tool_dir).resolve()
    m = read_manifest(tool_dir)
    inputs, params = {}, {}
    if args.example:
        ex = m.get("examples", [])[args.example - 1]
        print(f"▶ Ví dụ {args.example}: {ex.get('title', '')}")
        inputs, params = dict(ex.get("inputs", {})), dict(ex.get("params", {}))
    # --input tính theo thư mục hiện tại; input của example tính theo thư mục tool
    inputs.update({k: str(Path(str(v)).resolve()) for k, v in _parse_kv(args.input).items()})
    params.update(_parse_kv(args.param))
    workdir = Path(args.workdir) if args.workdir else Path(tempfile.mkdtemp(prefix=f"mediatool_{m['tool']['id']}_"))

    def emit(ev: dict) -> None:
        if ev["event"] == "progress":
            print(f"  [{ev['value'] * 100:5.1f}%] {ev.get('message', '')}")
        elif ev["event"] == "log":
            print(f"  ({ev['level']}) {ev['message']}")

    t0 = time.time()
    try:
        res = run_tool_dir(tool_dir, inputs, params, workdir, emit, base_dir=tool_dir, model_resolver=models.resolver(m))
    except Cancelled:
        print("✗ Đã hủy")
        return 1
    except ToolError as e:
        print(f"✗ {e.kind}:{e.code}: {e.message}")
        return 1
    print(f"✓ {res['summary']}  ({time.time() - t0:.1f}s)")
    for w in res["warnings"]:
        print(f"  ⚠ {w}")
    print(json.dumps(res["outputs"], ensure_ascii=False, indent=2))
    return 0


# ---------------------------------------------------------------- test / docs
def cmd_test(args: argparse.Namespace) -> int:
    return subprocess.call([sys.executable, "-m", "pytest", "-q", str(Path(args.tool_dir) / "tests")])


def cmd_docs(args: argparse.Namespace) -> int:
    fresh, changed = docs_mod.update_readme(Path(args.tool_dir), check_only=args.check)
    if args.check:
        print("✓ README đã cập nhật" if fresh else f"✗ Khối AUTO cũ: {', '.join(changed)}")
        return 0 if fresh else 1
    print(f"✓ Đã cập nhật: {', '.join(changed)}" if changed else "✓ Không có gì thay đổi")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="mediatool-dev", description="CLI cho người viết tool MediaTool")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("new", help="tạo tool mới từ template")
    s.add_argument("path", help="<category>/<name>")
    s.set_defaults(fn=cmd_new)

    s = sub.add_parser("describe", help="in schema I/O của tool")
    s.add_argument("tool_dir")
    s.set_defaults(fn=cmd_describe)

    s = sub.add_parser("validate", help="kiểm tra tool theo checklist")
    s.add_argument("tool_dirs", nargs="+")
    s.set_defaults(fn=cmd_validate)

    s = sub.add_parser("run", help="chạy tool không cần core")
    s.add_argument("tool_dir")
    s.add_argument("--example", type=int)
    s.add_argument("--input", action="append", default=[], metavar="TÊN=ĐƯỜNG_DẪN")
    s.add_argument("--param", action="append", default=[], metavar="TÊN=GIÁ_TRỊ")
    s.add_argument("--workdir")
    s.set_defaults(fn=cmd_run)

    s = sub.add_parser("test", help="chạy unit test của tool")
    s.add_argument("tool_dir")
    s.set_defaults(fn=cmd_test)

    s = sub.add_parser("docs", help="sinh lại các khối AUTO trong README")
    s.add_argument("tool_dir")
    s.add_argument("--check", action="store_true")
    s.set_defaults(fn=cmd_docs)

    args = p.parse_args(argv)
    return int(args.fn(args) or 0)


if __name__ == "__main__":
    raise SystemExit(main())

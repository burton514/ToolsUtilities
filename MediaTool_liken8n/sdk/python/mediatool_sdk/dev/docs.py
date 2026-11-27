"""Sinh các khối AUTO trong README của tool từ manifest + schema (mediatool-dev docs)."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from ..assets import accepts
from ..loader import chain_file, describe_dir, read_chain, read_manifest

BLOCK_RE = re.compile(r"(<!-- AUTO:(?P<name>[a-z_]+):start -->)(?P<body>.*?)(<!-- AUTO:(?P=name):end -->)", re.S)


def _cell(v: Any) -> str:
    return str(v).replace("|", "\\|").replace("\n", " ")


def _header(m: dict[str, Any]) -> str:
    t, r = m["tool"], m.get("runtime", {})
    rows = [
        ("**ID**", f"`{t['id']}`"),
        ("**Category**", f"`{t['id'].split('_')[0]}`"),
        ("**Phiên bản**", f"{t.get('version', '?')} · SDK `{t.get('sdk', '?')}`"),
        ("**Trạng thái**", t.get("status", "experimental")),
        ("**Người phụ trách**", ", ".join(t.get("owners", [])) or "chưa ghi"),
        ("**Runtime**", f"profile `{r.get('profile', 'base')}` · RAM khai báo {r.get('ram_mb', '?')} MB · "
                        f"GPU: {r.get('gpu', 'none')} · heavy: {'yes' if r.get('heavy') else 'no'}"),
        ("**License code**", t.get("license", "chưa ghi")),
    ]
    srcs = t.get("sources") or []
    if srcs:
        rows.insert(1, ("**Nguồn**", " · ".join(f"[{x['name']}]({x['url']})" if x.get("url") else x["name"] for x in srcs)))
    return "| | |\n|---|---|\n" + "\n".join(f"| {a} | {b} |" for a, b in rows)


def _io(d: dict[str, Any]) -> str:
    out = ["### Input", "| Tên | Format | Bắt buộc | Mô tả |", "|---|---|---|---|"]
    for f in d["inputs"]:
        fmt = (f["format"] or f.get("type", "")) + (" (nhiều)" if f["multiple"] else "")
        out.append(f"| `{f['name']}` | `{fmt}` | {'có' if f['required'] else 'không'} | {_cell(f['description'])} |")
    if not d["inputs"]:
        out.append("| _(không có)_ | | | |")
    out += ["", "### Params", "| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |", "|---|---|---|---|---|"]
    schema = d["params_schema"]
    defs = schema.get("$defs", {})
    props = schema.get("properties", {})
    for name, p in props.items():
        if "$ref" in p:
            p = {**defs.get(p["$ref"].split("/")[-1], {}), **{k: v for k, v in p.items() if k != "$ref"}}
        typ = p.get("type", "enum" if "enum" in p else "")
        valid = ""
        if "enum" in p:
            # nghĩa từng giá trị (x-labels của tool) đi kèm giá trị — tài liệu không chỉ liệt kê mã thô
            labels = p.get("x-labels") or {}
            valid = "<br>".join(f"`{v}` — {_cell(str(labels[v]))}" if v in labels else f"`{v}`" for v in p["enum"])
        elif "minimum" in p or "maximum" in p:
            valid = f"{p.get('minimum', '…')} – {p.get('maximum', '…')}"
        default = f"`{json.dumps(p['default'], ensure_ascii=False)}`" if "default" in p else "(bắt buộc)"
        out.append(f"| `{name}` | {typ} | {default} | {valid} | {_cell(p.get('description', ''))} |")
    if not props:
        out.append("| _(không có)_ | | | | |")
    out += ["", "### Output", "| Tên | Format | Luôn có | Mô tả |", "|---|---|---|---|"]
    for f in d["outputs"]:
        fmt = (f["format"] or f.get("type", "")) + (" (nhiều)" if f["multiple"] else "")
        out.append(f"| `{f['name']}` | `{fmt}` | {'có' if f['required'] else 'không'} | {_cell(f['description'])} |")
    return "\n".join(out)


def _examples(m: dict[str, Any]) -> str:
    tid = m["tool"]["id"]
    tool_path = f"tools/{tid.split('_', 1)[0]}/{tid.split('_', 1)[1]}"
    out = []
    for i, ex in enumerate(m.get("examples", []), 1):
        params = json.dumps(ex.get("params", {}), ensure_ascii=False)
        out += [
            f"**Ví dụ {i}: {ex.get('title', '')}**",
            "",
            "```powershell",
            f"mediatool-dev run {tool_path} --example {i}",
            "```",
            "",
            "```ts",
            f'await ws.tools.run("{tid}", {{ inputs: {{ /* asset */ }}, params: {params} }});',
            "```",
            "",
        ]
    return "\n".join(out).strip() or "_Chưa có [[examples]] trong manifest._"


def _model_src(md: dict[str, Any]) -> str:
    url = md.get("url") or (md.get("files") or [{}])[0].get("url", "")
    if md.get("files"):  # nhiều file: chỉ ghi thư mục gốc
        url = url.rsplit("/", 1)[0] + f"/ ({len(md['files'])} file)"
    return md.get("source") or url


def _models(m: dict[str, Any]) -> str:
    rows = ["| Model | Kích thước | License | Nguồn |", "|---|---|---|---|"]
    for md in m.get("models", []):
        rows.append(f"| `{md.get('id')}` | {md.get('size_mb', '?')} MB | {md.get('license', '**chưa ghi**')} | {_model_src(md)} |")
    if len(rows) == 2:
        rows.append("| _(không dùng model)_ | | | |")
    return "\n".join(rows)


def _chain(d: dict[str, Any], tool_dir: Path) -> str:
    tools_root = tool_dir.parent.parent
    up, down = [], []
    in_formats = {f["format"] for f in d["inputs"] if f["format"]}
    out_formats = {f["format"] for f in d["outputs"] if f["format"]}
    for other in sorted(tools_root.glob("*/*/manifest.toml")):
        odir = other.parent
        if odir.resolve() == tool_dir.resolve() or odir.name.startswith("_") or odir.parent.name.startswith("_"):
            continue
        try:
            om = read_manifest(odir)
            od = describe_dir(odir, om)
        except Exception:
            continue
        o_out = {f["format"] for f in od["outputs"] if f["format"]}
        o_in = {f["format"] for f in od["inputs"] if f["format"]}
        if any(accepts(i, o) for i in in_formats for o in o_out):
            up.append(f"`{om['tool']['id']}`")
        if any(accepts(i, o) for i in o_in for o in out_formats):
            down.append(f"`{om['tool']['id']}`")
    return (
        f"- **Tool nối được vào trước (cấp input):** {', '.join(up) or '_chưa có_'}\n"
        f"- **Tool nối được ra sau (nhận output):** {', '.join(down) or '_chưa có_'}"
    )


def render_blocks(tool_dir: Path) -> dict[str, str]:
    tool_dir = Path(tool_dir).resolve()
    m = read_manifest(tool_dir)
    d = describe_dir(tool_dir, m)
    blocks = {
        "header": _header(m),
        "io": _io(d),
        "examples": _examples(m),
        "chain": _chain(d, tool_dir),
        "models": _models(m),
    }
    if chain_file(m):
        blocks["steps"] = _steps(read_chain(tool_dir, m))
    return blocks


def _steps(c: dict[str, Any]) -> str:
    rows = ["| # | Bước | Tool | Nhận | Tham số cố định |", "|---|---|---|---|---|"]
    for i, s in enumerate(c.get("steps", []), 1):
        ins = ", ".join(f"`{k}` ← `{v if isinstance(v, str) else ', '.join(v)}`" for k, v in s.get("inputs", {}).items()) or "—"
        ps = ", ".join(f"`{k}={json.dumps(v, ensure_ascii=False)}`" for k, v in s.get("params", {}).items()) or "—"
        rows.append(f"| {i} | {s.get('title') or s['id']} | `{s['tool']}` | {ins} | {ps} |")
    return "\n".join(rows)


def update_readme(tool_dir: Path, check_only: bool = False) -> tuple[bool, list[str]]:
    """Trả (đã_khớp, danh_sách_khối_thay_đổi)."""
    readme = Path(tool_dir) / "README.md"
    text = readme.read_text(encoding="utf-8")
    blocks = render_blocks(tool_dir)
    changed: list[str] = []

    def repl(mt: re.Match) -> str:
        name = mt.group("name")
        if name not in blocks:
            return mt.group(0)
        body = "\n" + blocks[name] + "\n"
        if mt.group("body") != body:
            changed.append(name)
        return mt.group(1) + body + mt.group(4)

    new = BLOCK_RE.sub(repl, text)
    if changed and not check_only:
        readme.write_text(new, encoding="utf-8")
    return (not changed), changed

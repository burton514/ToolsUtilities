"""TimedData — một định dạng dữ liệu có thời gian cho mọi thứ: phụ đề, lời bài hát, câu thoại, beat, cảnh.

    {"items": [{"start": 1.2, "end": 3.4, "text": "...", "children": [{"start", "end", "text"}]}]}

`children` là đơn vị nhỏ hơn (dòng → từ → âm tiết). Tool nào sinh dữ liệu thời gian (phiên âm, căn lời, beat…) đều
xuất dạng này; tool nào dùng (chèn chữ theo thời gian, cắt theo beat…) đều đọc dạng này — viết một lần.
Đọc được từ SRT, VTT, LRC (kể cả Enhanced LRC có thời gian từng từ) và JSON transcript.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_SRT_TIME = re.compile(r"(\d+):(\d{2}):(\d{2})[,.](\d{1,3})")
_LRC_TAG = re.compile(r"\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]")
_LRC_WORD = re.compile(r"<(\d+):(\d{2})(?:[.:](\d{1,3}))?>")


def _sec(h: str, m: str, s: str, frac: str | None) -> float:
    f = (frac or "0").ljust(3, "0")[:3]
    return int(h) * 3600 + int(m) * 60 + int(s) + int(f) / 1000


def parse_srt(text: str) -> list[dict[str, Any]]:
    """SRT hoặc WebVTT → items (mỗi khối một mục)."""
    items = []
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n").strip()):
        lines = [l for l in block.split("\n") if l.strip() and l.strip() != "WEBVTT"]
        times = next((l for l in lines if "-->" in l), None)
        if not times:
            continue
        ts = _SRT_TIME.findall(times)
        if len(ts) < 2:
            # VTT cho phép bỏ giờ: 00:01.000
            ts2 = re.findall(r"(\d{2}):(\d{2})[.](\d{3})", times)
            if len(ts2) < 2:
                continue
            ts = [("0", *t) for t in ts2]
        start, end = _sec(*ts[0]), _sec(*ts[1])
        body = lines[lines.index(times) + 1:]
        txt = re.sub(r"<[^>]+>", "", "\n".join(body)).strip()
        if txt:
            items.append({"start": start, "end": end, "text": txt})
    return items


def parse_lrc(text: str) -> list[dict[str, Any]]:
    """LRC → items; dòng kết thúc khi dòng sau bắt đầu. Enhanced LRC (<mm:ss.xx>) cho thời gian từng từ (children)."""
    rows = []
    for line in text.replace("\r\n", "\n").split("\n"):
        tags = _LRC_TAG.findall(line)
        if not tags:
            continue
        body = _LRC_TAG.sub("", line).strip()
        for m, s, f in tags:
            rows.append((_sec("0", m, s, f), body))
    rows.sort(key=lambda r: r[0])
    items = []
    for i, (t, body) in enumerate(rows):
        if not _LRC_WORD.sub("", body).strip():
            continue
        end = rows[i + 1][0] if i + 1 < len(rows) else t + 4.0
        item: dict[str, Any] = {"start": t, "end": end, "text": _LRC_WORD.sub("", body).strip()}
        marks = list(_LRC_WORD.finditer(body))
        if marks:
            words = []
            for j, mk in enumerate(marks):
                ws = _sec("0", mk.group(1), mk.group(2), mk.group(3))
                seg_end = marks[j + 1].start() if j + 1 < len(marks) else len(body)
                w = body[mk.end():seg_end].strip()
                we = _sec("0", *marks[j + 1].groups()[:2], marks[j + 1].group(3)) if j + 1 < len(marks) else end
                if w:
                    words.append({"start": ws, "end": we, "text": w})
            item["children"] = words
        items.append(item)
    return items


def from_transcript(data: Any) -> list[dict[str, Any]]:
    """JSON transcript/timed lyrics ({segments:[{start,end,text,words:[...]}]} hoặc {items:[...]}) → items."""
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        return data["items"]
    segs = (data.get("segments") or data.get("lines") or []) if isinstance(data, dict) else data
    items = []
    for s in segs or []:
        words = s.get("words") or s.get("syllables") or []
        item = {"start": float(s["start"]), "end": float(s["end"]), "text": (s.get("text") or s.get("text_display") or "").strip()}
        if words:
            item["children"] = [{"start": float(w["start"]), "end": float(w["end"]), "text": (w.get("text") or w.get("word") or "").strip()} for w in words]
        items.append(item)
    return items


def load(path: str | Path) -> list[dict[str, Any]]:
    """Đọc file thời gian bất kỳ (.srt, .vtt, .lrc, .json) thành danh sách items."""
    p = Path(path)
    text = p.read_text(encoding="utf-8-sig", errors="replace")
    ext = p.suffix.lower()
    if ext == ".lrc":
        return parse_lrc(text)
    if ext == ".json":
        return from_transcript(json.loads(text))
    return parse_srt(text)


def to_srt(items: list[dict[str, Any]]) -> str:
    def ts(t: float) -> str:
        ms = int(round(max(0.0, t) * 1000))
        h, ms = divmod(ms, 3600_000)
        m, ms = divmod(ms, 60_000)
        s, ms = divmod(ms, 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    return "\n".join(f"{i}\n{ts(it['start'])} --> {ts(it['end'])}\n{it['text']}\n" for i, it in enumerate(items, 1))


def estimate_words(item: dict[str, Any]) -> list[dict[str, Any]]:
    """Thời gian từng từ khi dữ liệu chỉ có thời gian cả câu: chia theo độ dài từ (số ký tự + 1),
    sát với tốc độ nói thật hơn chia đều theo số từ."""
    if item.get("children"):
        return item["children"]
    words = item["text"].split()
    if not words:
        return []
    weights = [len(w) + 1 for w in words]
    total, span = sum(weights), item["end"] - item["start"]
    out, t = [], item["start"]
    for w, k in zip(words, weights):
        d = span * k / total
        out.append({"start": round(t, 3), "end": round(t + d, 3), "text": w})
        t += d
    return out


def split_lines(item: dict[str, Any], max_chars: int) -> list[dict[str, Any]]:
    """Cắt một câu thành các dòng ≤ max_chars theo ranh giới từ, ngắt sớm ở dấu câu khi dòng đã đủ dài.
    Thời gian từng từ giữ nguyên (không có thì ước lượng bằng `estimate_words`). max_chars = 0: giữ nguyên."""
    if not max_chars or len(item["text"]) <= max_chars:
        return [item]
    words = estimate_words(item)
    if not words:
        return [item]

    def join(ws: list[dict[str, Any]]) -> str:
        return " ".join(w["text"] for w in ws)

    groups: list[list[dict[str, Any]]] = []
    cur: list[dict[str, Any]] = []
    for w in words:
        if cur and len(join(cur + [w])) > max_chars:
            groups.append(cur)
            cur = []
        cur.append(w)
        if w["text"][-1:] in ".?!,;:…" and len(join(cur)) >= max_chars * 0.5:
            groups.append(cur)
            cur = []
    if cur:
        groups.append(cur)
    # dòng cuối quá ngắn (mồ côi, ví dụ một chữ "động"): chia lại hai dòng cuối cho cân, vẫn giữ ≤ max_chars
    if len(groups) > 1 and len(join(groups[-1])) < max_chars * 0.4:
        pool = groups[-2] + groups[-1]
        cuts = [k for k in range(1, len(pool)) if len(join(pool[:k])) <= max_chars and len(join(pool[k:])) <= max_chars]
        if cuts:
            k = min(cuts, key=lambda k: abs(len(join(pool[:k])) - len(join(pool[k:]))))
            groups[-2:] = [pool[:k], pool[k:]]
    return [{"start": g[0]["start"], "end": g[-1]["end"], "text": join(g), "children": g} for g in groups]



_STRONG_END = (".", "?", "!", "…")
_WEAK_END = (",", ";", ":")


def split_pauses(item: dict[str, Any], max_s: float = 7.0, max_chars: int = 100, min_words: int = 2) -> list[dict[str, Any]]:
    """Tách một đoạn quá dài (> max_s giây hoặc > max_chars ký tự) thành câu tại chỗ hợp lý nhất, lặp đến khi đủ ngắn.
    Điểm của mỗi ranh giới từ = độ dài khoảng lặng trước từ (giây) + 1 nếu từ trước kết thúc câu (. ? ! …) / + 0,3 nếu
    dấu phẩy (, ; :) − 0,3 × độ lệch hai nửa — ưu tiên chỗ ngắt hơi / dấu câu, tránh mẩu quá ngắn.
    Dùng cho kết quả nhận dạng giọng nói (model hay chép cả 20–30 giây một lèo, ít dấu câu)."""
    words = estimate_words(item)
    too_long = (item["end"] - item["start"]) > max_s or len(item["text"]) > max_chars
    if not too_long or len(words) < 2 * min_words:
        return [item]
    total = len(words)
    best, best_score = None, float("-inf")
    for i in range(min_words, total - min_words + 1):
        prev, nxt = words[i - 1], words[i]
        score = max(0.0, nxt["start"] - prev["end"])
        if prev["text"].endswith(_STRONG_END):
            score += 1.0
        elif prev["text"].endswith(_WEAK_END):
            score += 0.3
        score -= 0.3 * abs(i - (total - i)) / total
        if score > best_score:
            best, best_score = i, score
    if best is None:
        return [item]
    out = []
    for part in (words[:best], words[best:]):
        sub = {"start": part[0]["start"], "end": part[-1]["end"], "text": " ".join(w["text"] for w in part), "children": part}
        out.extend(split_pauses(sub, max_s, max_chars, min_words))
    return out


def _lrc_ts(t: float) -> str:
    cs = int(round(max(0.0, t) * 100))
    m, cs = divmod(cs, 6000)
    return f"{m:02d}:{cs // 100:02d}.{cs % 100:02d}"


def to_lrc(items: list[dict[str, Any]], title: str = "") -> str:
    """items → Enhanced LRC: `[mm:ss.xx]<mm:ss.xx>chữ <mm:ss.xx>chữ … <hết>`; có thời gian từng từ thì ghi thẻ từ, thẻ cuối là lúc
    hết từ cuối. Nghỉ ≥ 0,5 s trước dòng sau → thêm dòng trống có mốc để giữ lúc hết dòng. `parse_lrc` đọc lại y nguyên."""
    out = [f"[ti:{title}]"] if title else []
    for i, it in enumerate(items):
        words = it.get("children") or []
        if words:
            body = " ".join(f"<{_lrc_ts(w['start'])}>{w['text']}" for w in words) + f" <{_lrc_ts(words[-1]['end'])}>"
        else:
            body = it["text"]
        out.append(f"[{_lrc_ts(it['start'])}]{body}")
        nxt = items[i + 1]["start"] if i + 1 < len(items) else None
        if nxt is None or nxt - it["end"] >= 0.5:
            out.append(f"[{_lrc_ts(it['end'])}]")
    return "\n".join(out) + "\n"

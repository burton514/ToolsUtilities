"""Xử lý tiếng Việt dùng chung. Mọi tool xử lý chữ tiếng Việt phải dùng module này để kết quả nhất quán."""
from __future__ import annotations

import re
import unicodedata

_SPACES = re.compile(r"\s+")


def normalize(text: str) -> str:
    """Chuẩn hóa Unicode NFC (dựng sẵn) và gom khoảng trắng thừa."""
    return _SPACES.sub(" ", unicodedata.normalize("NFC", text)).strip()


def syllables(text: str) -> list[str]:
    """Tiếng Việt đơn âm tiết: mỗi cụm cách nhau bởi khoảng trắng là một âm tiết."""
    return [s for s in normalize(text).split(" ") if s]


def graphemes(text: str) -> list[str]:
    """Tách ký tự hiển thị, giữ dấu đi cùng chữ (ví dụ 'ế' là một ký tự)."""
    out: list[str] = []
    for ch in unicodedata.normalize("NFD", text):
        if out and unicodedata.combining(ch):
            out[-1] += ch
        else:
            out.append(ch)
    return [unicodedata.normalize("NFC", g) for g in out]


# ------------------------------------------------------------------ chữ viết → cách đọc
_PUNCT = "-.?!,;:)(\"'…“”‘’*_[]{}«»/|~`" + "\\"
_NEEDS_NORM = re.compile(r"[0-9%&@#$€£₫+=/]")
_DIGIT = re.compile(r"[0-9]")
_JOINERS = re.compile(r"[-‐‑–—/]+")
_norm_cache: dict[tuple[str, str], str] = {}


def _normalizer():
    from importlib.util import find_spec

    if find_spec("sea_g2p") is None:
        return None
    from sea_g2p import Normalizer  # Apache-2.0; đi kèm VieNeu-TTS trong image core

    return Normalizer()


def spoken_words(words: list[str]) -> list[str]:
    """Mỗi chữ VIẾT → cách ĐỌC (chữ thường, cách nhau bởi khoảng trắng), giữ đúng thứ tự và số lượng để đối chiếu ngược:
    "3000" → "ba nghìn", "13h30" → "mười ba giờ ba mươi phút", "2,5%" → "hai phẩy năm phần trăm", "IronMan" → "iron man".
    Dấu câu bị bỏ (chữ chỉ có dấu câu → chuỗi rỗng). Số / ký hiệu đọc bằng sea-g2p nếu có; không có thì giữ chữ thường."""
    out: list[str] = []
    todo: list[tuple[int, str, str]] = []   # (vị trí, chữ, chữ đứng trước làm ngữ cảnh)
    prev = ""
    for w in words:
        w = normalize(w).strip(_PUNCT)
        if not _DIGIT.search(w):
            # chữ ghép bằng gạch nối / gạch chéo ("tình-yêu", "anh/em") là các âm tiết riêng; dấu nháy bỏ ("don't" → "dont").
            # Có chữ số thì để bộ chuẩn hóa đọc ("26/11", "COVID-19").
            w = _JOINERS.sub(" ", w.replace("'", "").replace("’", "")).strip()
        if not w:
            out.append("")
        elif _NEEDS_NORM.search(w) or (any(c.isupper() for c in w[1:]) and w.isascii()):
            out.append("")
            todo.append((len(out) - 1, w, prev))
        else:
            out.append(w.lower())
        prev = w if w and not _NEEDS_NORM.search(w) else ""
    if todo:
        norm = _normalizer()
        if norm is None:
            for i, w, _ in todo:
                out[i] = _clean(w)
            return out
        # chuẩn hóa KÈM chữ đứng trước ("ngày 26/11" → ngày tháng, không phải phân số; "lúc 13h") rồi cắt phần ngữ cảnh ra;
        # cắt không khớp thì dùng kết quả chuẩn hóa riêng chữ đó
        keys = [(w, p) for _, w, p in todo]
        need = [k for k in dict.fromkeys(keys) if k not in _norm_cache]
        if need:
            alone = [_clean(r) for r in norm.normalize_batch([w for w, _ in need])]
            ctx = [_clean(r) for r in norm.normalize_batch([f"{p} {w}" if p else w for w, p in need])]
            pre = [_clean(r) for r in norm.normalize_batch([p for _, p in need])]
            for (w, p), a, c, h in zip(need, alone, ctx, pre):
                _norm_cache[(w, p)] = c[len(h):].strip() if p and h and c.startswith(h + " ") else a
        for i, w, p in todo:
            out[i] = _norm_cache[(w, p)]
    return out


def _clean(r: str) -> str:
    return _SPACES.sub(" ", "".join(c if c.isalnum() or c.isspace() else " " for c in r.lower())).strip()

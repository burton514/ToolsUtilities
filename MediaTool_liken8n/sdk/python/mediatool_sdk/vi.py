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

"""Lỗi chuẩn mà tool được phép raise."""
from __future__ import annotations


class ToolError(Exception):
    """Lỗi xử lý có mã, ví dụ ToolError("NO_VOCALS_FOUND", "Không tìm thấy giọng hát")."""

    kind = "tool"

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class InputError(ToolError):
    """Người dùng đưa input hoặc tham số không hợp lệ."""

    kind = "input"

    def __init__(self, field: str, message: str):
        super().__init__("INVALID_INPUT", message)
        self.field = field


class Cancelled(Exception):
    """Người dùng đã hủy job. Do ctx.check_cancelled() raise; tool không cần tự bắt."""

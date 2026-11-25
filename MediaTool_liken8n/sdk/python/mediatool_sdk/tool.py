"""BaseTool, Result, Estimate: hợp đồng mà mọi tool tuân theo."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, ClassVar, Generic, TypeVar, get_args, get_origin

from pydantic import BaseModel

from .context import Context

I = TypeVar("I", bound=BaseModel)
P = TypeVar("P", bound=BaseModel)
O = TypeVar("O", bound=BaseModel)


class NoParams(BaseModel):
    """Dùng cho tool không có tham số."""


@dataclass
class Estimate:
    ram_mb: int | None = None
    seconds: float | None = None


@dataclass
class Result(Generic[O]):
    outputs: O
    summary: str = ""
    warnings: list[str] = field(default_factory=list)


class BaseTool(Generic[I, P, O]):
    """Kế thừa: class MyTool(BaseTool[Inputs, Params, Outputs]).

    Bắt buộc: run(). Tùy chọn: check(), validate(), estimate().
    """

    Inputs: ClassVar[type[BaseModel]]
    Params: ClassVar[type[BaseModel]]
    Outputs: ClassVar[type[BaseModel]]

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        for base in getattr(cls, "__orig_bases__", ()):
            if get_origin(base) is BaseTool:
                args = get_args(base)
                if len(args) == 3 and all(isinstance(a, type) for a in args):
                    cls.Inputs, cls.Params, cls.Outputs = args

    def check(self, ctx: Context) -> None:
        """Kiểm tra môi trường lúc nạp tool (ví dụ có ffmpeg không)."""

    def validate(self, inputs: I, params: P, ctx: Context) -> None:
        """Kiểm tra những điều JSON Schema không diễn tả được."""

    def estimate(self, inputs: I, params: P) -> Estimate | None:
        return None

    def run(self, inputs: I, params: P, ctx: Context) -> Result[O] | O:
        raise NotImplementedError

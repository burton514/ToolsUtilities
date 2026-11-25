"""(2) CODE — khai báo Inputs, Params, Outputs và run(). Xem docs/TOOL_AUTHORING.md mục 2."""
from __future__ import annotations

from pydantic import BaseModel, Field

from mediatool_sdk import BaseTool, Context, JsonData, Result
from mediatool_sdk.assets import Asset


class Inputs(BaseModel):
    file: Asset = Field(description="File bất kỳ cần xử lý")


class Params(BaseModel):
    note: str = Field("", description="Ghi chú đi kèm kết quả")


class Outputs(BaseModel):
    info: JsonData = Field(description="Thông tin về file đầu vào")


class __CLASS__(BaseTool[Inputs, Params, Outputs]):
    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        ctx.progress(0.5, "Đang đọc file")
        info = JsonData.write(ctx.workdir / "info.json", {
            "filename": inputs.file.filename,
            "size_bytes": inputs.file.size_bytes,
            "note": params.note,
        })
        return Result(outputs=Outputs(info=info), summary=f"Đã đọc {inputs.file.filename}")

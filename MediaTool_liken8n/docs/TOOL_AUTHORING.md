# Hướng dẫn viết Tool

> Đọc trước: [ARCHITECTURE.md](ARCHITECTURE.md), mục 0 (Nguyên tắc), mục 4 (Tool) và mục 7 (Asset và `format`).

Tool là **khả năng xử lý không có giao diện**: nhận input, xử lý, trả output. Bạn viết tool **một lần**, và nó tự dùng được ở sandbox, mini app, MCP (AI), API và workflow, không phải viết riêng cho từng nơi.

Bạn chỉ làm việc trong **một thư mục**: `tools/<category>/<name>/`. Không có file dùng chung nào phải sửa: không có catalog, không có code sandbox.

## 0. Tạo tool mới

```powershell
mediatool-dev new audio/separate_stems
```

```
tools/audio/separate_stems/
├── manifest.toml      # (1) Đăng ký
├── tool.py            # (2) Code
├── internal/          # (tùy chọn) cho tool phức tạp, xem mục 3 bên dưới
├── tests/test_tool.py
├── samples/           # file mẫu nhỏ, < 2 MB
├── requirements.txt   # (nếu cần)
├── README.md          # (3) TÀI LIỆU của tool, bắt buộc, theo mẫu (xem mục 5)
└── CHANGELOG.md
```

**Quy ước:**
- `category` là một trong các khu vực đang có: `media`, `video`, `audio`, `music`, `speech`, `lyrics`, `karaoke`, `compose`. Nếu tool thuộc khu vực hoàn toàn mới thì tạo category mới cùng cấp. Không tạo sẵn category rỗng.
- `name` viết thường, dùng `_`, dạng động từ + đối tượng khi được (`separate_stems`, `burn_subtitle`).
- **id = `<category>_<name>`**, ví dụ `audio_separate_stems`. Id phải khớp đường dẫn; `validate` kiểm tra điều này.

---

## 1. Đăng ký: `manifest.toml`

Core tự phát hiện tool qua file này mà không import code của tool.

```toml
[tool]
id          = "audio_separate_stems"
name        = "Tách giọng / nhạc cụ"
version     = "0.1.0"
sdk         = ">=0.1,<0.2"
entry       = "tool:SeparateStems"          # <module>:<class>
summary     = "Tách audio thành vocals + nhạc nền, hoặc 4/6 stems nhạc cụ."
tags        = ["stems", "vocal", "karaoke"]
owners      = ["ten-github-cua-ban"]
license     = "MIT"

[runtime]
profile     = "torch-cpu"      # base | torch-cpu
isolated    = false            # true = venv riêng nếu xung đột dependency
ram_mb      = 3000             # RAM đỉnh ước tính; sandbox đo để đối chiếu
gpu         = "optional"       # none | optional | required
heavy       = true             # mỗi lần chỉ chạy 1 job
warm        = false            # true = giữ process chạy sẵn cho tool tương tác (xem trước nhanh)
timeout_s   = 1800

[dependencies]
binaries    = ["ffmpeg"]

[[models]]
id          = "htdemucs"
url         = "https://…"
sha256      = "…"
size_mb     = 80
license     = "MIT"            # bắt buộc; một số model chỉ cho dùng phi thương mại

[mcp]
expose      = true
hint        = "Dùng khi cần tách giọng hát khỏi nhạc. Output 'vocals' (format audio) dùng tiếp được cho lyrics_align."

# Ít nhất 1 example. Sandbox dùng example làm ca thử, docs dùng làm ví dụ, AI dùng làm mẫu gọi tool.
[[examples]]
title       = "Tách vocal nhanh"
inputs      = { audio = "samples/song_10s.mp3" }
params      = { stems = "2", quality = "fast" }

[[examples]]
title       = "Tách 4 nhạc cụ"
inputs      = { audio = "samples/song_10s.mp3" }
params      = { stems = "4" }
```

---

## 2. Code: `tool.py`

Tool gồm **Inputs**, **Params**, **Outputs** (Pydantic model) và **class Tool**. Core đã validate params theo schema trước khi gọi tool, nên trong `run()` bạn nhận object đã có kiểu, không phải parse JSON và không phải kiểm tra lại kiểu dữ liệu.

```python
from typing import Literal
from pydantic import BaseModel, Field
from mediatool_sdk import BaseTool, Context, Estimate, Result
from mediatool_sdk.assets import AudioFile          # tự mang format="audio" trong JSON Schema
from mediatool_sdk.errors import InputError


class Inputs(BaseModel):
    audio: AudioFile = Field(description="File audio cần tách")


class Params(BaseModel):
    stems: Literal["2", "4", "6"] = Field("2", description="2 = vocals + nhạc nền; 4/6 = tách nhạc cụ")
    quality: Literal["fast", "balanced"] = Field("fast", description="fast dùng ít RAM hơn, chất lượng thấp hơn một chút")


class Outputs(BaseModel):
    vocals: AudioFile = Field(description="Giọng hát")
    accompaniment: AudioFile | None = Field(None, description="Nhạc nền (khi stems = 2)")
    drums: AudioFile | None = Field(None, description="Trống (khi stems = 4/6)")
    bass: AudioFile | None = Field(None, description="Bass (khi stems = 4/6)")
    other: AudioFile | None = Field(None, description="Phần còn lại (khi stems = 4/6)")


class SeparateStems(BaseTool[Inputs, Params, Outputs]):

    def check(self, ctx: Context) -> None:
        """(tùy chọn) Kiểm tra môi trường lúc nạp tool. Raise lỗi → tool `unavailable`, tool khác không bị ảnh hưởng."""
        ctx.require_binary("ffmpeg")

    def validate(self, inputs: Inputs, params: Params, ctx: Context) -> None:
        """(tùy chọn) Kiểm tra những điều JSON Schema không diễn tả được."""
        if (inputs.audio.duration_s or 0) > 3 * 3600:
            raise InputError("audio", "Audio dài hơn 3 giờ chưa được hỗ trợ")
        ctx.guards.free_disk(at_least=inputs.audio.size_bytes * 6)   # 6 stems wav

    def estimate(self, inputs: Inputs, params: Params) -> Estimate:
        """(tùy chọn) Ước tính RAM và thời gian chạy; scheduler và UI dùng."""
        return Estimate(ram_mb=1500 if params.quality == "fast" else 3000,
                        seconds=(inputs.audio.duration_s or 60) * 1.5)

    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        """(bắt buộc) Logic chính."""
        from .internal.engine import separate          # import nặng ĐẶT TRONG HÀM

        model = ctx.models.get("htdemucs")              # tải + cache theo [[models]]
        files = separate(inputs.audio.path, model, params, out_dir=ctx.workdir, ctx=ctx)

        return Result(
            outputs=Outputs(vocals=AudioFile(path=files["vocals"]),
                            accompaniment=AudioFile(path=files.get("no_vocals"))),
            summary=f"Đã tách {params.stems} stems từ {inputs.audio.duration_text}",
        )
```

### Kết quả trả về: `Result`

| Trường | Ý nghĩa |
|---|---|
| `outputs` | Đúng theo `Outputs` đã khai báo; core kiểm tra lại |
| `summary` | Một câu dễ đọc, hiển thị trên UI và trả cho AI. Ví dụ: "Đã tách 2 stems từ bài dài 4:12" |
| `warnings` | Danh sách cảnh báo không làm job thất bại. Ví dụ: "Đoạn 2:10–2:30 không tìm thấy giọng hát" |

### `Context`

| API | Dùng để |
|---|---|
| `ctx.workdir` | Thư mục riêng của job, **nơi duy nhất** được ghi file |
| `ctx.progress(fraction, message)` | Báo tiến độ từ 0 đến 1 |
| `ctx.log.info/warning/error` | Ghi log của job |
| `ctx.check_cancelled()` | Gọi trong vòng lặp dài để người dùng hủy được job |
| `ctx.models.get(id)` | Lấy đường dẫn model đã khai báo trong manifest |
| `ctx.require_binary(name)` | Kiểm tra binary hệ thống có sẵn không |
| `ctx.ffmpeg(args, progress_range=(a, b))` | Chạy ffmpeg và tự quy đổi tiến độ |
| `ctx.guards.*` | `free_disk(...)`, `file_signature(...)`, `max_duration(...)` |
| `ctx.device`, `ctx.limits.ram_mb` | Thiết bị (`cpu`/`cuda`) và ngân sách RAM của job |

### Kiểu asset và `format`

Mọi trường input/output là file hay dữ liệu có cấu trúc **phải** dùng kiểu asset của SDK, để JSON Schema có `format` và tool này nối được với tool khác:

| Kiểu SDK | `format` |
|---|---|
| `VideoFile` | `video` |
| `AudioFile` | `audio` |
| `ImageFile`, `ImageSequence` | `image`, `image_sequence` |
| `SubtitleFile` | `subtitle` |
| `Transcript`, `TimedLyrics` | `transcript`, `timed_lyrics` |
| `BeatGrid`, `SceneList`, `TimeRanges` | `beat_grid`, `scene_list`, `time_ranges` |
| `FontFile`, `LutFile`, `JsonData` | `font`, `lut`, `json` |
| `Composition`, `TextStyle` | `composition`, `text_style`. Đọc/ghi/kiểm tra bằng `mediatool_sdk.compose`, không tự parse JSON |

Trường số hoặc chuỗi thường (âm lượng, tên preset…) không cần `format`. Cần kiểu mới thì mở PR riêng vào `sdk/`, **không tự định nghĩa trong tool**.

### Lỗi

- `InputError(field, message)`: người dùng đưa input hoặc param không hợp lệ.
- `ToolError(code, message)`: lỗi xử lý có mã, ví dụ `"NO_VOCALS_FOUND"`, `"MODEL_DOWNLOAD_FAILED"`.
- Mọi lỗi khác bị xem là crash. Job sẽ `failed` kèm traceback trong log.

---

## 3. Tool phức tạp: tách `internal/`

Tool đơn giản chỉ cần `tool.py`. Khi tool lớn dần, hãy tách theo vai trò, **vẫn bên trong thư mục của tool**:

```
tools/lyrics/align/
├── tool.py              # chỉ khai báo I/O và điều phối các bước
└── internal/
    ├── request.py       # chuẩn hóa params thành cấu trúc nội bộ (ví dụ chia đoạn theo vocal_activity)
    ├── guards.py        # kiểm tra trước khi chạy: RAM, đĩa, thời lượng, ngôn ngữ
    ├── engine.py        # thuật toán chính (forced alignment)
    └── codes.py         # mã lỗi của tool
```

**Không import `internal/` của tool khác.** Khi hai tool cần chung một đoạn code, hãy đề xuất đưa nó vào SDK (ví dụ `mediatool_sdk.vi` cho xử lý tiếng Việt, `mediatool_sdk.ffmpeg` cho ffmpeg).

---

## 4. Kiểm thử: không phải viết UI

### Sandbox (dùng chung, có giao diện)

```powershell
mediatool sandbox
```

Tool của bạn **tự xuất hiện** trong tab Tools. Ở đó bạn xem manifest và schema, bấm chạy từng `[[examples]]` hoặc nhập form tự sinh, rồi xem tiến độ, log, preview output, **RAM đỉnh** và thời gian chạy. Muốn có thêm ca thử thì thêm `[[examples]]` vào manifest, không phải sửa sandbox.

### CLI (không cần core, dùng cho CI)

```powershell
mediatool-dev run tools/audio/separate_stems --example 1
```

```powershell
mediatool-dev run tools/audio/separate_stems --input audio=samples/song_10s.mp3 --param stems=4
```

```powershell
mediatool-dev validate tools/audio/separate_stems
```

```powershell
mediatool-dev test tools/audio/separate_stems
```

### Unit test: `tests/test_tool.py`

```python
from mediatool_sdk.testing import run_tool, run_example

def test_examples_pass(tool_dir):
    for result in run_example(tool_dir, "all"):
        assert result.ok

def test_two_stems(tool_dir):
    r = run_tool(tool_dir, inputs={"audio": "samples/song_10s.mp3"}, params={"stems": "2"})
    assert r.outputs.vocals.duration_s > 9
    assert r.peak_ram_mb < 3000           # phải khớp với ram_mb trong manifest
```

Muốn có **giao diện tính năng** cho người dùng cuối (ví dụ "Làm video karaoke")? Đó là việc của mini app, nằm trong thư mục riêng. Xem [MINIAPP_AUTHORING.md](MINIAPP_AUTHORING.md).

---

## 5. Tài liệu của tool: `README.md`

Mỗi tool **bắt buộc** có `README.md` theo mẫu [templates/TOOL_README.md](templates/TOOL_README.md). `mediatool-dev new` tự copy mẫu này vào thư mục tool.

### Phần tự sinh và phần tự viết

Để tài liệu không bị lệch so với code, những thông tin có trong manifest, schema hoặc số đo được **sinh tự động** bằng lệnh sau:

```powershell
mediatool-dev docs tools/audio/separate_stems
```

| Phần | Ai làm | Nguồn |
|---|---|---|
| Thông tin chung (id, phiên bản, runtime, người phụ trách) | **tự sinh** | `manifest.toml` |
| Bảng Input / Params / Output | **tự sinh** | schema của `tool.py` |
| Ví dụ CLI, HTTP và mini app | **tự sinh** | `[[examples]]` |
| Tool nối được ở trước và sau | **tự sinh** | so khớp `format` với các tool khác trong registry |
| Bảng hiệu năng (thời gian, RAM đỉnh) | **tự sinh** | số đo của `mediatool-dev bench` / sandbox |
| Bảng model và license | **tự sinh** | `[[models]]` |
| Tóm tắt, khi nào dùng / không dùng | tự viết | |
| Giải thích tham số, chuỗi tool hay dùng, lưu ý tích hợp | tự viết | |
| Cách hoạt động, tiếng Việt, lỗi và cảnh báo, giới hạn, hỏi đáp | tự viết | |

Các khối tự sinh nằm giữa hai dấu mốc `AUTO:xxx:start` và `AUTO:xxx:end`. **Không sửa tay** các khối này. CI chạy `mediatool-dev docs --check` và báo lỗi nếu chúng đã cũ so với code.

### Tài liệu được hiển thị ở đâu

- **Sandbox:** tab *Docs* trong trang chi tiết tool.
- **Workspace:** nút **?** trên panel tự sinh và trên panel của mini app có dùng tool.
- **API:** `GET /v1/tools/{id}/docs` trả về markdown.
- **MCP:** resource `mediatool://tools/{id}/docs`, để AI đọc thêm khi cần. Mô tả ngắn của MCP tool vẫn lấy từ `summary` và `mcp.hint` của manifest.

### Viết sao cho tốt

- Viết bằng tiếng Việt, câu ngắn, rõ ràng.
- Mục **"Không dùng khi"** phải chỉ ra tool thay thế. Mục này giúp AI và người dùng chọn đúng tool.
- Mỗi mã lỗi trong `internal/codes.py` (hoặc mỗi `ToolError` bạn raise) phải có một dòng trong bảng *Lỗi và cảnh báo*, kèm cách xử lý **cho người dùng cuối**.
- Đổi hành vi hay tham số thì cập nhật README và CHANGELOG trong cùng PR.

## 6. Checklist trước khi mở PR

`mediatool-dev validate` kiểm tra tự động phần lớn danh sách này:

- [ ] PR chỉ sửa file trong `tools/<category>/<name>/`
- [ ] id = `<category>_<name>` và khớp đường dẫn; `sdk` đúng phạm vi
- [ ] Mọi `Field` đều có `description` viết dễ hiểu cho người không làm kỹ thuật (UI và AI đọc nó), khớp với [TOOL_SPECS.md](TOOL_SPECS.md)
- [ ] Mọi trường file hoặc dữ liệu có cấu trúc dùng kiểu asset của SDK (có `format`)
- [ ] Có ít nhất 1 `[[examples]]` chạy pass, 1 sample < 2 MB và 1 test
- [ ] Không import thư viện nặng ở đầu file
- [ ] Chỉ ghi vào `ctx.workdir`, không sửa file gốc; chỉ tải model qua `ctx.models`
- [ ] Gọi `ctx.progress` và `ctx.check_cancelled` trong các vòng lặp dài
- [ ] `ram_mb` khớp với RAM đỉnh đo được trong sandbox
- [ ] `summary` của kết quả dễ hiểu bằng tiếng Việt
- [ ] Đã ghi license của model
- [ ] `README.md` theo mẫu: đã chạy `mediatool-dev docs`, các phần tự viết đã điền đủ, mọi mã lỗi đều có trong bảng lỗi
- [ ] CHANGELOG đã cập nhật

## 7. Không được làm

- Import tool khác, `mediatool_worker` hay bất kỳ code nào ngoài SDK và thư viện của bạn
- Nhận tên tham số thay thế (`videoPath` hoặc `sourcePath`). Mỗi tham số chỉ có một tên, theo schema
- Đọc/ghi database hoặc file ngoài `ctx.workdir`; giữ trạng thái toàn cục giữa các lần chạy
- Xử lý các trường dành riêng cho AI (lý do gọi tool, có hiển thị cho người dùng không…). Lớp MCP lo việc đó
- Sửa `sdk/`, `sandbox/` hay `core/` trong cùng PR với tool

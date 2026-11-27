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
- **`sources`** (bắt buộc với tool có code): repo model / thư viện / engine mà tool dựa vào, dạng `[{ name = "chủ/repo", url = "…" }]` — hiện cạnh tên tool ở danh sách, bảng chọn tool, trang chạy tool, tài liệu. Chuỗi không khai: core tự gom từ các bước.

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
# file        = "htdemucs.th"  # tên file lưu (mặc định lấy từ url) — ctx.models.get() trả đường dẫn FILE
# source      = "https://…"    # trang gốc của model (ghi vào README)

# Model nhiều file (ví dụ CTranslate2): mỗi file một url + sha256; ctx.models.get() trả đường dẫn THƯ MỤC
# [[models]]
# id    = "whisper_base"
# files = [ { path = "model.bin", url = "https://…/<commit>/model.bin", sha256 = "…" }, … ]
#
# Core tải lần đầu vào <data>/models/<id>/, kiểm sha256 TỪNG file (sai → xóa, báo lỗi), báo tiến độ tải lên job;
# hai job cùng cần một model thì job sau chờ. Test / `mediatool-dev run` dùng cùng thư mục (mediatool_sdk.models).
# Ghim url theo commit, không theo nhánh. File có thể nằm trong thư mục con (path = "onnx/x.onnx"), không được có "..".
#
# Nhiều tool dùng CHUNG một bộ model: khai báo một lần ở tools/_models/<nhóm>.toml (cùng dạng [[models]]) rồi đặt
# models_from = ["<nhóm>"] ở ĐẦU manifest (khóa cấp gốc, trước bảng [tool]). Ví dụ: tools/_models/vieneu.toml.

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
| `ctx.log.info/warning/error` | Ghi log của job; `warning` còn được gộp vào `warnings` của kết quả (người dùng thấy cả lúc chạy lẫn ở kết quả) |
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
| `VoiceProfile` | `voice`: hồ sơ giọng đọc (clip mẫu + đặc trưng giọng). Tạo bằng `speech_voice_add`, dùng qua `mediatool_sdk.speech` |
| `TextFile` | `text`: văn bản thuần .txt / .md (lời đọc, kịch bản, bản chép lời); đọc bằng `.read()` |

Quy tắc nối: input `json` nhận mọi loại dữ liệu JSON; input loại JSON cụ thể (`voice`, `composition`, `transcript`…) nhận thêm file `.json` chưa gắn loại (người dùng tự tải lên) — tool phải tự kiểm nội dung và báo `InputError` rõ ràng nếu sai.

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

## 3b. Chuỗi đã lưu: tool không có code

Một chuỗi các tool có sẵn cũng là **một tool**: tự xuất hiện ở trang Công cụ (nhãn *Chuỗi*), Tool Runner, màn Quy trình tự động, API và MCP, và **lồng được vào chuỗi khác**. Thư mục giống tool thường, nhưng thay `tool.py` bằng `chain.json`:

```
tools/compose/film_subtitles/
├── manifest.toml      # entry = "chain:chain.json"
├── chain.json         # input · tham số · các bước · output
├── samples/ README.md CHANGELOG.md
```

```json
{
  "inputs":  [{ "name": "video", "format": "video", "description": "Video cần làm" }],
  "params":  { "type": "object", "properties": { "look": { "type": "string", "default": "teal_orange", "enum": ["teal_orange", "noir"],
               "x-labels": { "teal_orange": "Cam – xanh", "noir": "Đen trắng" }, "description": "Tông màu" } } },
  "steps": [
    { "id": "look", "title": "Áp tông màu", "tool": "media_apply", "inputs": { "video": "$input.video" }, "params": { "effect": "$param.look" } },
    { "id": "subs", "title": "Chèn phụ đề", "tool": "compose_bind", "inputs": { "video": "$look.video", "subtitle": "$input.subtitle" } }
  ],
  "outputs": { "video": { "from": "$subs.video", "format": "video", "description": "Video kết quả" } }
}
```

- Input của bước: `"$input.<tên>"` (input của chuỗi) hoặc `"$<id bước>.<output>"` (output bước trước); mảng nếu input nhận nhiều file.
- Tham số của bước: hằng số, hoặc `"$param.<tên>"` lấy từ tham số của chuỗi (JSON Schema, có thể kèm `x-labels`). Tham số chuỗi không truyền thì lấy `default` trong schema.
- Tham số chuỗi trùng với tham số của một tool: khai báo `{"$from": "<tool_id>.<tham số>"}` — lấy nguyên schema (danh sách, nhãn, giới hạn) của tool, chỉ ghi đè khóa đặt cạnh (`default`, `description`). Không chép lại danh sách giọng / hiệu ứng.
- Input của chuỗi có thể tùy chọn: `"required": false` — bước nhận `$input.<tên>` sẽ không có input đó khi người dùng bỏ trống.
- Core chạy từng bước thành **job con** qua đúng bộ lập lịch (RAM, heavy, hủy, tiến độ). Chuỗi dùng được khi mọi tool trong các bước dùng được.
- `mediatool-dev validate` kiểm tra mọi tool/tham chiếu trong chuỗi; `mediatool-dev docs` sinh thêm bảng các bước (khối `AUTO:steps`). Chuỗi không cần `tests/` (core chạy); kiểm thử bằng `[[examples]]` trên sandbox.
- Người dùng lưu chuỗi từ màn Quy trình tự động (đặt tên → **Lưu**) sẽ nằm ở `<data>/chains/user/<tên>/` — cùng định dạng (`manifest.toml` + `chain.json`, thêm `graph.json` là bố cục trên trình nối). Chuỗi của người dùng sửa / đổi tên / xóa được; chuỗi dựng sẵn chỉ mở ra để sao chép. API: `GET/PUT/DELETE /v1/chains/{id}`, `POST /v1/chains` (core kiểm mọi tool trong các bước có mặt và dùng được, không tự gọi chính nó, có ít nhất một output). Yêu thích (đánh sao tool / chuỗi): `GET /v1/favorites`, `PUT/DELETE /v1/favorites/{id}` — lưu trong `<data>/prefs.json`; `GET /v1/tools` trả thêm `favorite` (thứ tự đánh sao) và `editable`.

**Thông số chung khi tool dựng hình:** dùng `mediatool_sdk.compose` (đọc thư viện, đo media, dựng composition, gọi engine) và `mediatool_sdk.timed` (đọc SRT/VTT/LRC/JSON thành dữ liệu thời gian chung), không tự gọi FFmpeg/engine. Tham số chọn từ danh sách nên có nhãn tiếng Việt: `json_schema_extra={"enum": [...], "x-labels": {...}}`.

**Module dùng chung khác của SDK** (không tự viết lại trong tool): `mediatool_sdk.speech` (giọng đọc VieNeu: nạp model, giọng, ghép câu, đổi tốc độ, chuẩn hóa độ to, đọc âm thanh), `mediatool_sdk.align` (căn ép chữ vào âm thanh bằng model CTC), `mediatool_sdk.asr` (chép lời: cắt đoạn theo tiếng nói, chạy ZipFormer bằng sherpa-onnx, tách câu, ghi output chung của mọi tool chép lời), `mediatool_sdk.vi` (tiếng Việt: chuẩn hóa Unicode, `spoken_words` đổi chữ viết → cách đọc), `mediatool_sdk.timed` (dữ liệu thời gian: đọc / ghi SRT, LRC, tách câu, cắt dòng), `mediatool_sdk.stems` (tách nguồn âm: giải mã ra PCM memmap, chạy model theo đoạn chồng nhau với bộ đệm một đoạn, ghi dần WAV từng phần, đổi định dạng xuất), `mediatool_sdk.bs_roformer` (model BS-RoFormer chạy bằng numpy + onnxruntime, không cần PyTorch), `mediatool_sdk.ckpt` (đọc an toàn checkpoint PyTorch `.ckpt` / `.pt` thành mảng numpy — chỉ cho phép tensor, không chạy mã trong file), `mediatool_sdk.device` (chạy model ONNX bằng GPU NVIDIA nếu được: `ort_session(model, opts, ctx, gpu=ctx.device.startswith("cuda"))` — không có GPU thì tự về CPU và cảnh báo).

**GPU — một đường duy nhất: CUDA qua onnxruntime-gpu.** Một lựa chọn cho cả máy chủ, không phải tham số của từng tool: biến `MEDIATOOL_DEVICE` của core (`cpu` mặc định, `auto` = có GPU NVIDIA thì dùng, `cuda`). Bản GPU (`docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build`, driver NVIDIA hỗ trợ CUDA 12) đặt sẵn `auto`. Core truyền `ctx.device = "cuda"` cho tool khai `runtime.gpu = "optional"` (tool `none` luôn nhận `cpu`); tool tạo session bằng `mediatool_sdk.device.ort_session(..., gpu=ctx.device.startswith("cuda"))`. Tool KHÔNG được lỗi khi thiếu GPU.

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

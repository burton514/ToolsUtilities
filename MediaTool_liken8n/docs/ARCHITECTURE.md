# MediaTool — Kiến trúc tổng thể

> Trạng thái: **bản thiết kế v0.2**. Chưa có code. Tài liệu này là hợp đồng để nhiều người cùng làm mà không giẫm chân nhau.

## 0. Nguyên tắc nền tảng

1. **Tool không có giao diện.** Tool chỉ nhận input, xử lý và trả output. Một tool viết **một lần** dùng được cho mọi nơi gọi: mini app, AI (MCP), API cho web/mobile, workflow.
2. **Giao diện chung do core cung cấp, mini app chỉ cắm thêm vào.** Core UI (**workspace**) có sẵn trình phát video/audio, timeline, kho asset và thanh tiến độ. Mỗi mini app là một tính năng (ví dụ "Làm video karaoke") và chỉ gắn panel, nút, track hay overlay của mình vào các **slot** mà workspace đục sẵn. Mini app gọi tool **theo id** qua workspace API, không bao giờ import code của tool.
3. **Sandbox là công cụ kiểm thử dùng chung, tự liệt kê mọi tool.** Người viết tool không phải viết thêm code để thử tool của mình; chỉ cần khai báo ví dụ trong manifest.
4. **Không có file dùng chung nào mà contributor phải sửa.** Không có catalog trung tâm, không có `switch/case` trong sandbox. Thêm tool là thêm một thư mục, thêm mini app cũng là thêm một thư mục.
5. **Đầu vào và đầu ra đều có kiểu ngữ nghĩa** (`format`: `audio`, `video`, `timed_lyrics`…). Output của tool A nối được vào input của tool B khi trùng `format`. AI và workflow dựa vào điều này để tự nối tool.
6. **Tool không bao giờ sửa file gốc.** Tool chỉ tạo file mới.
7. **Không tự dựng phần xử lý nặng.** Render, encode, tách nhạc, nhận dạng giọng… dùng engine native đã được kiểm chứng (FFmpeg, Skia, libass, Demucs, faster-whisper…). Tool chỉ là lớp vỏ mỏng. Xem [ENGINES.md](ENGINES.md).
8. **Hợp đồng chặt ở ranh giới.** Params được validate theo schema trước khi tới tool. Tool không phải tự parse JSON và không nhận tên tham số thay thế (alias).

## 1. Mục tiêu

- **Tách → Sửa → Ghép** media bằng các tool độc lập. Đợt 1 tập trung vào video nhạc mới và video karaoke tiếng Việt (xem [TOOL_CATALOG.md](TOOL_CATALOG.md)).
- **API-first.** Desktop (Tauri + React), web, mobile và AI đều chỉ là client.
- **Chạy được trên máy yếu:** PC thường hoặc VPS 8 GB RAM, không bắt buộc GPU. Scale ngang khi có kinh phí.
- **Nhiều người làm song song** mà không cần phối hợp với nhau.

## 2. Các lớp và quy tắc phụ thuộc

```
 ┌──────────────────────────── CLIENT ─────────────────────────────┐
 │  desktop/ (Tauri)    web (sau)    sandbox/    ← cùng dùng 1 core UI│
 │  ┌──────────── packages/workspace (CORE UI) ─────────────────┐  │
 │  │ player · timeline · asset bin · job bar · panel tự sinh   │  │
 │  │      ▲ slot: panel / toolbar / overlay / track / result   │  │
 │  └──────┼────────────────────────────────────────────────────┘  │
 │   miniapps/<name>/  (chỉ cắm component vào slot, dùng ws API)   │
 └────────┼────────────────────────────────────────────────────────┘
          │ ws.tools.run("audio_separate_stems", …)
          │ HTTP /v1 + SSE                ▲ HTTP /v1
          ▼                               │
 ┌──────────────────────────┐      ┌──────┴──────┐
 │ core/ (Rust)             │◄─────┤ mediatool-mcp│ ◄── AI client
 │ registry · jobs · assets │      └─────────────┘
 │ scheduler · models · API │
 └────────────┬─────────────┘
              │ subprocess + giao thức worker (JSON-lines)
 ┌────────────▼─────────────┐
 │ workers/python           │ ── nạp đúng 1 tool / job
 └────────────┬─────────────┘
              │ import duy nhất
       ┌──────▼───────┐
       │ sdk/python   │ mediatool_sdk
       └──────▲───────┘
              │
   tools/<category>/<name>/   (headless, mỗi tool một thư mục)
```

| Lớp | Chỉ được phụ thuộc vào | Cấm |
|---|---|---|
| `tools/*` | `mediatool_sdk` + thư viện riêng | import tool khác, worker, biết có UI hay không |
| `miniapps/*` | `@mediatool/miniapp-sdk` (ws API) + `@mediatool/ui` + React | gọi HTTP trực tiếp, tự dựng player/timeline, CSS toàn cục, import mini app khác, gọi tool chưa khai báo |
| `packages/workspace`, `sandbox/`, `desktop/` | HTTP API, `@mediatool/ui` | chứa code riêng cho một tool hay mini app cụ thể |
| `core/` | giao thức worker, JSON Schema | biết tên hay logic của một tool cụ thể |
| `mcp` | HTTP API | logic xử lý media |

### Việc gì thì sửa ở đâu

| Việc | Thư mục được sửa | Ai review |
|---|---|---|
| Thêm hoặc sửa một tool | **chỉ** `tools/<category>/<name>/` | người phụ trách tool |
| Thêm hoặc sửa một mini app | **chỉ** `miniapps/<name>/` | người phụ trách mini app |
| Thêm kiểu asset hoặc `format`, helper dùng chung | `sdk/` | nhóm core |
| Thêm slot, dịch vụ workspace, component UI dùng chung | `packages/workspace/`, `packages/ui/`, `packages/miniapp-sdk/` | nhóm core |
| Core, giao thức, API, MCP, desktop shell, sandbox | thư mục tương ứng | nhóm core |

## 3. Cấu trúc thư mục

```
MediaTool/
├── core/                        # Rust workspace = "backend"
│   ├── crates/api               # axum: REST /v1 + SSE
│   ├── crates/registry          # quét tools/**/manifest.toml + miniapps/*/manifest.json
│   ├── crates/jobs              # scheduler theo ngân sách RAM, quản lý subprocess
│   ├── crates/storage           # assets + lineage (SQLite), StorageBackend
│   ├── crates/models            # tải/cache model AI, kiểm tra sha256
│   ├── crates/engine            # engine render native: Composition → khung (Skia) → video (FFmpeg)
│   ├── bin/mediatool-render     # CLI của engine (tool compose_render gọi khi xuất)
│   ├── bin/mediatool-server
│   └── bin/mediatool-mcp        # MCP server (rmcp), chỉ gọi HTTP API
├── sdk/python/mediatool_sdk/    # hợp đồng tool: BaseTool, Context, kiểu asset, vi (tiếng Việt), ffmpeg, testing
├── workers/python/              # mediatool_worker: chạy 1 tool theo giao thức worker
├── tools/                       # ★ TOOL (headless)
│   ├── _template/
│   ├── media/  probe/  transcode/  mux/ …
│   ├── audio/  separate_stems/  normalize/ …
│   ├── lyrics/ import/  align/  export/ …
│   └── karaoke/ render_subtitle/  compose/
├── miniapps/                    # ★ MINI APP (giao diện tính năng)
│   ├── _template/
│   ├── karaoke_maker/
│   ├── vocal_remover/
│   └── beat_sync_video/
├── packages/
│   ├── workspace/               # ★ CORE UI: layout, player, timeline, asset bin, job bar, các slot
│   ├── ui/                      # @mediatool/ui: Button, Slider, Select, Section, ColorPicker, FontPicker…
│   ├── editor/                  # @mediatool/editor: timeline editor (xem trước bằng engine native)
│   ├── miniapp-sdk/             # @mediatool/miniapp-sdk: defineMiniApp + kiểu của ws API (hợp đồng với mini app)
│   └── api-client/              # @mediatool/api-client (TS), sinh từ OpenAPI
├── sandbox/                     # app kiểm thử: Tools + Mini apps (tự liệt kê)
├── desktop/                     # Tauri 2 shell: nhúng core, nạp mini app
├── profiles/                    # môi trường Python dùng chung: base, torch-cpu
├── config/                      # cấu hình triển khai (ngân sách RAM, bật/tắt tool)
└── docs/
    ├── ARCHITECTURE.md          # tài liệu này
    ├── TOOL_AUTHORING.md        # cách viết tool
    ├── MINIAPP_AUTHORING.md     # cách viết mini app
    ├── TOOL_CATALOG.md          # danh mục tool đợt 1
    ├── TOOL_SPECS.md            # input · tham số · output của từng tool (viết dễ hiểu)
    ├── COMPOSITION_FORMAT.md    # bản dựng nhiều lớp: hẹn giờ, keyframe, animation, chữ nghệ thuật
    ├── ENGINES.md               # engine native dùng cho từng mảng (không tự dựng)
    └── templates/TOOL_README.md # mẫu tài liệu cho mỗi tool
```

**Quy ước category:** mỗi khu vực năng lực (`media`, `video`, `audio`, `music`, `speech`, `lyrics`, `karaoke`, `compose`) là một thư mục con của `tools/`, và tool nằm ngay bên dưới, không lồng thêm cấp. **Không tạo sẵn category rỗng.** Người viết tool đầu tiên của một khu vực mới sẽ tạo thư mục cho khu vực đó.

## 4. Tool (headless)

```
tools/audio/separate_stems/
├── manifest.toml     # (1) Đăng ký: id, mô tả, tài nguyên, dependency, model, ví dụ
├── tool.py           # (2) Code: Inputs, Params, Outputs + run()
├── internal/         # (tùy chọn) tool phức tạp tách thành request.py, guards.py, engine.py
├── README.md         # (3) Tài liệu: phần tự viết + phần tự sinh từ manifest/schema
├── tests/  samples/  requirements.txt  CHANGELOG.md
```

- **id** = `<category>_<name>`, ví dụ `audio_separate_stems`. Id chỉ dùng chữ thường, số và `_`, để hợp lệ làm tên tool MCP và tên hàm cho mọi LLM.
- **Đăng ký bằng cách tự phát hiện.** Core quét `tools/**/manifest.toml`. Tool lỗi (manifest sai, thiếu ffmpeg…) được đánh dấu `unavailable` kèm lý do; các tool khác vẫn chạy bình thường. Admin bật/tắt tool trong `config/tools.toml`.
- **Không chia sẻ code giữa các tool.** Khi hai tool trở lên cần chung một helper, helper đó được đưa vào SDK (có review và versioning), không để tool này import từ tool kia. Nhờ vậy sửa tool này không bao giờ làm hỏng tool khác.
- **Kết quả** gồm `outputs` (theo schema) + `summary` (một câu dễ đọc, cho UI và AI) + `warnings`.
- **Tài liệu riêng bắt buộc** (`README.md` theo [mẫu](templates/TOOL_README.md)) gồm: tóm tắt, khi nào dùng và không dùng, I/O, ví dụ, cách tích hợp và nối tool, cách hoạt động, hiệu năng, model và license, tiếng Việt, mã lỗi, giới hạn, hỏi đáp. Phần lấy được từ manifest, schema hay số đo được `mediatool-dev docs` sinh tự động để không lệch so với code. Tài liệu hiển thị trong sandbox, workspace (nút **?**), API và MCP.

Chi tiết: [TOOL_AUTHORING.md](TOOL_AUTHORING.md).

## 5. Workspace (core UI) và Mini app

### 5.1 Workspace: khung giao diện chung do core làm

Mọi màn làm việc đều dùng **chung một workspace**. Workspace đã có sẵn phần khó và dùng chung: phát media, timeline, quản lý file, theo dõi job. Các ô ★ là **slot** để mini app cắm component vào.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Topbar: tên mini app · file đang mở · ★toolbar (nút của mini app) · Xuất│
├─────────────┬──────────────────────────────────────┬─────────────────┤
│ Asset bin   │ VIEWER                               │ ★ PANEL         │
│ input,      │ player video/audio · A/B so sánh     │ (tham số, nút,  │
│ output,     │ preview phụ đề / karaoke (ASS)       │  component của  │
│ lineage     │ ★ overlay (vẽ đè lên video)          │  mini app)      │
│             ├──────────────────────────────────────┤                 │
│             │ TIMELINE                             │                 │
│             │ video (thumbnail) · audio/stems      │                 │
│             │ (waveform, mute/solo/gain) · lyrics  │                 │
│             │ (sửa được) · beats · scenes · ranges │                 │
│             │ ★ track tùy biến                     │                 │
├─────────────┴──────────────────────────────────────┴─────────────────┤
│ JOB BAR: các bước đang chạy · tiến độ · log · hủy                    │
└──────────────────────────────────────────────────────────────────────┘
```

**Workspace có sẵn (mini app dùng, không tự làm):**
- **Player** video/audio: phát, tua, lặp đoạn, tốc độ, chỉnh âm lượng từng track, so sánh A/B, preview phụ đề SRT/ASS và karaoke ngay trên video.
- **Timeline** có renderer chuẩn cho từng `format`: `video` (thumbnail), `audio` (waveform), `timed_lyrics` (sửa thời gian từng chữ bằng kéo thả), `beat_grid` (vạch beat), `scene_list`, `time_ranges`, `composition` (mỗi lớp là một clip trên timeline: kéo thả để đổi giờ hiện, kéo mép để đổi thời lượng, hiện điểm keyframe, gắn lớp vào mốc phách/câu hát). Mini app chỉ cần đưa asset vào track; workspace tự vẽ.
- **Xem trước composition:** viewer lấy khung hình từ `compose_render_frame` (warm) khi kéo thanh thời gian, và phát bản `draft` của `compose_render` khi bấm Play. Lớp đang chọn có khung chỉnh trực tiếp trên viewer (kéo để đổi vị trí, xoay, phóng to), và mọi thay đổi được ghi ngược vào composition.
- **Asset bin**: input, output và lineage; chọn hoặc kéo thả file theo `format`.
- **Job bar**: mọi lời gọi tool tự hiện tiến độ, log và nút hủy.
- **Panel tự sinh**: tool nào chưa có mini app vẫn dùng được ngay. Workspace tự dựng panel từ JSON Schema của tool.
- **Xuất file** theo preset (YouTube, TikTok…), thông báo, hộp xác nhận, đa ngôn ngữ, theme.

### 5.2 Slot

| Slot | Vị trí | Dùng cho |
|---|---|---|
| `panel` | Cột phải | Tham số, nút chạy, component riêng của tính năng. **Bắt buộc** |
| `toolbar` | Topbar / viewer | Nút hành động nhanh (ví dụ "Căn lời", "Hạ tông") |
| `overlay` | Đè lên viewer | Vẽ trên video: khung crop, vùng đặt chữ, lưới bố cục |
| `track` | Timeline | Track tùy biến, khi renderer chuẩn chưa đủ |
| `result` | Thay viewer khi xong | Màn kết quả riêng. Mặc định là màn so sánh + tải về của workspace |

### 5.3 Mini app

```
miniapps/karaoke_maker/
├── manifest.json     # tên, tools dùng, accepts (format), layout, slot dùng
├── index.tsx         # defineMiniApp({ setup, panel, toolbar, overlay… })
├── panels/           # component React của mini app, dựng bằng @mediatool/ui
├── strings/vi.json   # chuỗi giao diện (vi mặc định, en)
├── icon.svg
└── README.md
```

- Mini app nhận một đối tượng **`ws` (workspace API)**: `ws.player`, `ws.timeline`, `ws.assets`, `ws.tools.run(...)`, `ws.state`, `ws.ui`. **Đây là cách duy nhất** để mini app điều khiển giao diện chung và gọi tool.
- Component của mini app dùng `@mediatool/ui`, để giao diện mọi mini app đồng nhất (theme, sáng/tối, kích thước). CSS riêng chỉ được dùng có phạm vi (CSS module), không viết CSS toàn cục.
- `manifest.json` liệt kê `tools`. Workspace **chặn** lời gọi tới tool không khai báo, và báo trước nếu một tool cần thiết đang `unavailable`.
- **Cô lập:** mỗi slot được bọc *ErrorBoundary*. Mini app lỗi chỉ hiện "Panel gặp lỗi" kèm nút tải lại; player, timeline và mini app khác vẫn chạy. Mỗi mini app là một bundle ES module riêng, được nạp động; lúc build, chỉ cho phép import `@mediatool/miniapp-sdk`, `@mediatool/ui`, React và thư viện nhỏ đã khai báo.
- **Sẵn cho mở rộng sau:** mọi hàm của `ws` đều bất đồng bộ và chỉ truyền dữ liệu serialize được. Sau này nếu có mini app của bên thứ ba (marketplace), có thể chạy chúng trong iframe đặt vào slot, với **cùng API** qua `postMessage`, không phải viết lại mini app.

Chi tiết: [MINIAPP_AUTHORING.md](MINIAPP_AUTHORING.md).

## 6. Sandbox (kiểm thử dùng chung)

`sandbox/` là một app web nhỏ, chạy bằng `mediatool sandbox`, gồm hai tab:

| Tab | Chức năng |
|---|---|
| **Tools** | Tự liệt kê mọi tool trong registry. Xem manifest, schema, trạng thái. Chạy tool với từng `[[examples]]` trong manifest hoặc với form tự sinh. Xem tiến độ, log, preview output, RAM đỉnh, thời gian chạy, lịch sử chạy. |
| **Mini apps** | Tự liệt kê `miniapps/*` và mở trong **chính workspace thật**. Xem các lời gọi `ws` và tool, lỗi theo từng slot. Có chế độ mock để làm UI mà không cần chạy tool thật. |

**Không có code riêng cho tool nào trong sandbox.** Muốn sandbox có ca thử cho tool của mình, chỉ cần thêm `[[examples]]` vào manifest. Sandbox cũng không cần desktop: nó chỉ cần core (`mediatool-server`) đang chạy.

Ngoài sandbox còn có CLI `mediatool-dev` (`new`, `validate`, `run`, `test`) để chạy một tool **không cần core**, phục vụ unit test và CI.

## 7. Asset và `format`

- Mọi input/output dạng file hoặc dữ liệu có cấu trúc đều là **asset**, truyền **theo tham chiếu** (asset id hoặc đường dẫn), không truyền bytes. Đây là điều kiện để chạy được trên máy 8 GB.
- JSON Schema của mỗi trường asset có `format` ngữ nghĩa. Danh sách `format` do SDK quản lý:
  `video`, `audio`, `image`, `image_sequence`, `subtitle`, `transcript`, `timed_lyrics`, `beat_grid`, `scene_list`, `time_ranges`, `json`, `font`, `lut`, `composition` (bản dựng nhiều lớp, xem [COMPOSITION_FORMAT.md](COMPOSITION_FORMAT.md)), `text_style`, `voice` (hồ sơ giọng đọc, xem `speech_voice_add`), `text` (văn bản thuần).
- **Quy tắc nối:** output có `format` X nối thẳng được vào input có `format` X. Workflow validator, AI và UI đều dùng quy tắc này.
- Mỗi asset lưu **lineage**: được tạo từ asset nào, bởi tool nào, version nào, params nào. Lineage dùng để ghép lại đúng timeline, cache kết quả và chạy lại một phần workflow.
- Storage: local disk (`data/assets/…`) → S3/MinIO sau này, qua interface `StorageBackend`.

## 8. Luồng chạy một job

1. Client gọi `POST /v1/tools/{id}/jobs` với `{inputs, params}`.
2. Core **validate nghiêm** theo JSON Schema (sai kiểu hoặc thiếu trường thì trả 422 ngay, tool không bao giờ thấy input sai), rồi tạo job `queued`.
3. Scheduler chỉ chạy job khi còn đủ ngân sách tài nguyên (mục 12).
4. Core spawn worker: `python -m mediatool_worker run`, trong môi trường của profile mà tool khai báo, với `workdir` riêng cho job.
5. Worker gửi tiến độ và log qua stdout, core đẩy tiếp cho client qua SSE.
6. Tool trả kết quả. Core đăng ký output thành asset mới có lineage, job chuyển sang `succeeded`.
7. Nếu tool crash, hết RAM hoặc timeout, chỉ subprocess đó chết. Job chuyển sang `failed` kèm log; core vẫn chạy. Khi process kết thúc, toàn bộ RAM được trả lại.

Trạng thái job: `queued → running → succeeded | failed | cancelled`.

## 9. Giao thức worker (độc lập ngôn ngữ)

- **`describe`**: worker in ra manifest đã chuẩn hóa + JSON Schema của inputs/params/outputs. Core cache kết quả theo hash thư mục tool.
- **`run`**: core gửi job spec qua stdin, một dòng JSON:
  ```json
  {"protocol":1,"job_id":"j_1","tool_dir":"tools/audio/separate_stems","workdir":"data/jobs/j_1",
   "inputs":{"audio":{"format":"audio","path":"data/assets/a_9.mp3"}},
   "params":{"stems":"2"},"limits":{"ram_mb":3000},"device":"cpu"}
  ```
- Worker gửi sự kiện qua stdout, mỗi dòng một JSON:
  ```json
  {"event":"progress","value":0.42,"message":"Đang tách"}
  {"event":"log","level":"info","message":"..."}
  {"event":"model_request","id":"htdemucs"}
  {"event":"result","summary":"Đã tách 2 stems (4:12)","outputs":{"vocals":{"format":"audio","path":"..."}},"warnings":[]}
  {"event":"error","kind":"input|tool|crash","code":"...","message":"..."}
  ```
- Với `model_request`, core trả `{"model_path": "..."}` qua stdin. Nhờ vậy cache model được quản lý tập trung ở core.
- Hủy job: core gửi `{"cmd":"cancel"}`; hết thời gian ân hạn mà worker chưa dừng thì core kill process. stderr được lưu làm log thô.
- **Tool tương tác (`runtime.warm = true`)**, ví dụ `compose_render_frame`: core giữ sẵn một worker cho tool đó và gửi **nhiều job liên tiếp** vào cùng process (mỗi job một dòng JSON trên stdin), không phải khởi động lại. Nhờ vậy kéo thanh thời gian là có ảnh xem trước ngay. Worker warm vẫn nằm trong ngân sách RAM, và core tắt nó sau một thời gian không dùng (mặc định 5 phút).
- Trường `protocol` tăng khi có thay đổi phá vỡ tương thích. Sau này có thể có worker Rust, Go, Node… dùng cùng giao thức.

## 10. HTTP API (v1)

| Method | Path | Mô tả |
|---|---|---|
| GET | `/v1/tools` · `/v1/tools/{id}` | Danh sách tool / manifest + schema |
| GET | `/v1/tools/{id}/docs` | Tài liệu của tool (markdown) |
| GET | `/v1/miniapps` · `/v1/miniapps/{name}` | Danh sách mini app / manifest + bundle |
| POST | `/v1/assets` | Upload file (hoặc đăng ký đường dẫn local ở chế độ desktop) |
| GET | `/v1/assets/{id}` · `/content` | Metadata + lineage / tải file |
| POST | `/v1/tools/{id}/jobs` | Chạy tool |
| GET | `/v1/jobs/{id}` · `/events` (SSE) | Trạng thái, kết quả / tiến độ |
| POST | `/v1/jobs/{id}/cancel` | Hủy job |
| POST | `/v1/preview/frame` | Engine native render 1 khung của composition → JPEG + khung bao từng lớp |
| GET | `/v1/assets/{id}/filmstrip` · `/peaks` | Dải ảnh thu nhỏ (JPEG) / đỉnh sóng âm (JSON) cho timeline, có cache |
| GET | `/v1/system` | Tài nguyên, profile, model đã tải |

Spec OpenAPI được sinh từ core. `@mediatool/api-client` được sinh tự động từ spec, không viết tay.

## 11. MCP (giai đoạn 1: chạy từng tool)

- Binary `mediatool-mcp` dùng `rmcp`, **chỉ gọi HTTP API**, nên trỏ được vào core local hoặc VPS.
- Mỗi tool có `mcp.expose = true` được tự sinh thành một MCP tool cùng id. Mô tả lấy từ `summary` + `mcp.hint` + `examples` trong manifest, kèm `format` của từng trường để AI biết tool nào nối được với tool nào.
- Các trường dành riêng cho AI (ví dụ lý do gọi tool, có hiển thị kết quả cho người dùng không) do **lớp MCP thêm vào và tự xử lý**. Tool không bao giờ thấy các trường này.
- MCP resource `mediatool://tools/{id}/docs` trả tài liệu đầy đủ của tool, để AI đọc khi cần hiểu sâu cách dùng.
- MCP tool hệ thống: `upload_file`, `list_tools`, `get_job`, `wait_job`, `get_asset`. Với job dài, MCP chờ tối đa N giây rồi trả `job_id` để AI gọi `wait_job` tiếp.

## 12. Chạy trên máy cấu hình thấp

- Mỗi tool khai báo `ram_mb`, `gpu = none|optional|required` và `heavy`. Sandbox đo RAM đỉnh thật để đối chiếu.
- `config/runtime.toml` đặt `ram_budget_mb` (ví dụ 5500 cho VPS 8 GB). Scheduler chỉ chạy job khi tổng RAM khai báo của các job đang chạy vẫn nằm trong ngân sách. Tool `heavy` chạy tối đa 1 job một lúc.
- Mỗi job một process: nạp model, chạy xong rồi thoát. Core không giữ model trong bộ nhớ.
- Mặc định dùng model nhỏ (whisper `small` int8, Demucs với segment nhỏ). Xử lý audio/video dài theo từng đoạn.
- SDK có sẵn **guards** để tool kiểm tra trước khi chạy: dung lượng đĩa trống so với kích thước input, chữ ký file hợp lệ, giới hạn thời lượng.
- Scale: thay scheduler local bằng Redis queue và thêm worker ở máy khác hoặc máy GPU. Không phải sửa tool nào.

## 13. Runtime profile

- `profiles/base`: SDK + tiện ích ffmpeg (nhẹ).
- `profiles/torch-cpu`: torch CPU + numpy + thư viện AI chung.
- Tool khai báo `profile` và có thể có `requirements.txt` riêng. Nếu yêu cầu của tool xung đột với profile thì đặt `isolated = true` để tool có venv riêng. Môi trường quản lý bằng **uv**.

## 14. Desktop shell (Tauri 2 + React)

- Core Rust được **nhúng vào app Tauri** dưới dạng thư viện và mở API trên `127.0.0.1:<port>` kèm token local. App có thể chuyển sang core từ xa (VPS) bằng URL và API key.
- Shell = `packages/workspace` + các màn chung: thư viện mini app, quản lý asset, danh sách job, cài đặt (core, model, profile). **Tính năng cụ thể nằm trong mini app**, cắm vào workspace qua slot.
- Python chỉ cần để chạy tool: app mang theo Python embeddable + profile `base`. Profile nặng được tải khi cần lần đầu.

## 15. Cơ chế đảm bảo độc lập

1. **Path guard trong CI:** PR sửa `tools/<c>/<n>/` hoặc `miniapps/<n>/` không được sửa file nào ngoài thư mục đó (trừ khi có nhãn `core`).
2. **`CODEOWNERS`** theo từng thư mục tool, mini app và lớp core.
3. **`mediatool-dev validate`** chạy trong CI: manifest hợp lệ, id khớp đường dẫn, schema sinh được, mọi trường có mô tả, trường asset có `format`, không import nặng ở top-level, có ít nhất 1 example và 1 test pass, README đúng mẫu và các khối tự sinh chưa cũ (`mediatool-dev docs --check`).
4. **`miniapp validate`**: manifest hợp lệ, chỉ gọi tool đã khai báo, bundle build được.
5. **Versioning:** SDK, kit và giao thức worker theo semver. Tool khai báo `sdk = "…"`, mini app khai báo `kit = "…"`. Registry báo rõ thành phần nào không còn tương thích.
6. **Cô lập lúc chạy:** tool chạy trong subprocess với workdir riêng; mỗi slot của mini app được bọc ErrorBoundary, nên mini app lỗi không kéo sập workspace.

## 16. Công nghệ

| Phần | Công nghệ |
|---|---|
| Core | Rust: axum, tokio, sqlx (SQLite), serde, jsonschema, utoipa (OpenAPI) |
| Tool + SDK | Python 3.11+, Pydantic v2 (sinh JSON Schema), uv |
| Mini app, kit, sandbox, shell | TypeScript, React, Vite |
| Desktop | Tauri 2 |
| MCP | rmcp |
| Media (engine native, xem [ENGINES.md](ENGINES.md)) | **Engine render Rust**: FFmpeg (`ffmpeg-the-third`) + Skia (`skia-safe`); libass, Demucs, Rubber Band, faster-whisper / whisper.cpp |

## 17. Lộ trình

**MVP**
1. SDK Python + `mediatool-dev` · giao thức worker + worker Python
2. Core Rust: registry, assets, jobs, scheduler, SSE, OpenAPI
3. Sandbox (tab Tools) · các tool P0 trong catalog
4. Workspace (player, timeline, asset bin, job bar, panel tự sinh) + `@mediatool/ui` + `miniapp-sdk` · sandbox tab Mini apps · mini app `karaoke_maker`, `beat_sync_video`
5. Desktop shell · MCP

**Tiếp theo:** tool P1 → Workflow engine (DAG, canvas kéo thả) → workflow qua MCP → chế độ server/web/mobile.

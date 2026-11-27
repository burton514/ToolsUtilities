# Sửa bản dựng

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `compose_edit` |
| **Nguồn** | MediaTool engine (Skia + FFmpeg) · [rust-skia/rust-skia](https://github.com/rust-skia/rust-skia) |
| **Category** | `compose` |
| **Phiên bản** | 0.1.1 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 150 MB · GPU: none · heavy: no |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Nhận một **bản dựng** (composition) và **danh sách thao tác**, trả bản dựng đã sửa: thêm/xóa/sắp lớp, đổi chữ, màu, vị trí, thêm hiệu ứng, chuyển động, mốc thời gian. Thao tác chạy bằng engine — cùng bảng lệnh với API `POST /v1/composition/edit` — và bản dựng sau khi sửa luôn được kiểm tra hợp lệ.

**Dùng khi:**
- AI hoặc chuỗi tự động cần chỉnh bản dựng do tool khác tạo (`compose_bind`, `compose_template`) trước khi xuất lại.
- Chỉnh hàng loạt: thêm một hiệu ứng cho mọi lớp, đổi cỡ mọi lớp chữ…

**Không dùng khi:**
- Người dùng muốn chỉnh bằng tay, nhìn trực tiếp → mở bản dựng trong trình **Dựng video**.
- Muốn xuất video → nối sau bằng `compose_render`.

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `composition` | `composition` | có | Bản dựng cần sửa (JSON) |
| `markers` | `json` | không | Dữ liệu thời gian thêm thành mốc của bản dựng: nhịp (music_beat_track), câu thoại, cảnh… |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `ops` | array | (bắt buộc) |  | Danh sách thao tác, chạy lần lượt. Mỗi thao tác có 'op': add_layer {layer, index?} · update_layer {target, patch} · remove_layer {target} · move_layer {target, index} · set {path, value} · add_effect {target, effect} · add_animation {target, animation} · add_marker {marker} · merge {patch}. target = id lớp, '*' (mọi lớp) hoặc 'type:text' (mọi lớp chữ). Ví dụ: [{"op":"add_effect","target":"*","effect":{"type":"film_grain"}}] |
| `marker_kind` | string | `""` |  | Loại mốc khi dữ liệu chưa có loại (ví dụ 'line', 'scene'); bỏ trống = 'cue'. Nhịp giữ beat / downbeat |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `composition` | `composition` | có | Bản dựng đã sửa |
<!-- AUTO:io:end -->

**Các thao tác (`ops`):**

| op | Trường | Làm gì |
|---|---|---|
| `add_layer` | `layer`, `index`? | Thêm lớp (mặc định trên cùng; `index` 0 = dưới cùng) |
| `update_layer` | `target`, `patch` | Gộp `patch` vào lớp (object gộp đệ quy, `null` xóa trường) |
| `remove_layer` | `target` | Xóa lớp |
| `move_layer` | `target`, `index` | Đổi thứ tự (`-1` = trên cùng) |
| `set` | `path`, `value` | Đặt giá trị theo đường dẫn: `canvas.background`, `layers.<id>.style.size`, `layers.<id>.effects.0.amount` |
| `add_effect` | `target`, `effect` | Thêm hiệu ứng (có sẵn hoặc gói thư viện, ví dụ `{"type":"vhs"}`) |
| `add_animation` | `target`, `animation` | Thêm chuyển động (ví dụ `{"preset":"pop","kind":"in"}`) |
| `add_marker` | `marker` | Thêm mốc thời gian |
| `merge` | `patch` | Gộp vào cả bản dựng |

`target`: id lớp · `*` mọi lớp · `type:text` mọi lớp chữ (tương tự `type:video`, `type:image`…).

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Đổi chữ, phóng to và thêm hạt phim cho mọi lớp**

```powershell
mediatool-dev run tools/compose/edit --example 1
```

```ts
await ws.tools.run("compose_edit", { inputs: { /* asset */ }, params: {"ops": [{"op": "set", "path": "layers.title.text", "value": "Chào mừng!"}, {"op": "set", "path": "layers.title.style.size", "value": 140}, {"op": "add_effect", "target": "*", "effect": {"type": "film_grain"}}]} });
```

**Ví dụ 2: Gắn nhịp nhạc vào bản dựng (output của music_beat_track)**

```powershell
mediatool-dev run tools/compose/edit --example 2
```

```ts
await ws.tools.run("compose_edit", { inputs: { /* asset */ }, params: {} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Trong bản dựng này, đổi tiêu đề thành 'Chào mừng!', chữ to hơn và thêm hạt phim cho cả video."

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_template`, `compose_voiceover_captions`, `lyrics_align`, `media_probe`, `music_beat_track`, `speech_dub`, `speech_synthesize`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`, `video_info`
- **Tool nối được ra sau (nhận output):** `compose_bind`, `compose_render`, `lyrics_align`, `speech_dub`
<!-- AUTO:chain:end -->

**Chuỗi hay dùng:**
```
compose_bind / compose_template → compose_edit → compose_render
```

## 5. Cách hoạt động

Tool ghi bản dựng + thao tác ra file rồi gọi `mediatool-render edit` (engine Rust, `mediatool_engine::edit`): thao tác áp lần lượt trên JSON, sau đó bản dựng được đọc lại bằng model của engine để chắc chắn hợp lệ. Cùng code với API `POST /v1/composition/edit`.

## 6. Lỗi và cảnh báo

| Mã / lỗi | Khi nào | Người dùng nên làm gì |
|---|---|---|
| `InputError ops` "'op' phải là một trong…" | Tên thao tác sai | Dùng tên trong bảng trên |
| `InputError ops` "Không áp được thao tác…" | Thiếu trường, lớp không tồn tại, hoặc bản dựng sau khi sửa không hợp lệ | Đọc thông báo: nó chỉ đúng thao tác và trường bị sai |

## 7. Giới hạn

- Chưa có thao tác "hoàn tác"; muốn quay lại thì dùng bản dựng đầu vào.

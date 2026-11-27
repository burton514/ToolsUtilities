# Tạo từ mẫu dựng sẵn

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `compose_template` |
| **Nguồn** | MediaTool engine (Skia + FFmpeg) · [rust-skia/rust-skia](https://github.com/rust-skia/rust-skia) |
| **Category** | `compose` |
| **Phiên bản** | 0.1.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 2400 MB · GPU: none · heavy: yes |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Chọn **một mẫu** (màn tiêu đề, dải tên, đếm ngược 3-2-1, trích dẫn, ảnh thumbnail), điền chữ, chọn màu nhấn và khung hình, thêm ảnh / video / nhạc nền nếu muốn. Nhận lại **video hoặc ảnh** hoàn chỉnh, kèm **bản dựng** để chỉnh tiếp.

**Dùng khi:**
- Cần nhanh một đoạn mở đầu, dải tên nhân vật, đếm ngược, câu trích dẫn, ảnh bìa — không muốn tự dựng.
- Một bước trong chuỗi (ví dụ: chọn khung đẹp → tách nền → tạo thumbnail).

**Không dùng khi:**
- Cần chèn nhiều dòng chữ theo thời gian (phụ đề, lời) → dùng `compose_bind`.
- Cần dựng tự do nhiều lớp → dùng trình **Dựng video**.

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `image` | `image` | không | Ảnh nền (tùy chọn) |
| `video` | `video` | không | Video nền (tùy chọn) — mẫu dải tên nên dùng video |
| `audio` | `audio` | không | Nhạc nền (tùy chọn) |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `template` | string | `"title_card"` | `countdown` — Đếm ngược 3-2-1 (video)<br>`lower_third` — Dải tên (lower third) (video)<br>`quote` — Trích dẫn (video)<br>`thumbnail` — Ảnh thumbnail (ảnh)<br>`title_card` — Màn tiêu đề (video) | Mẫu dựng sẵn |
| `title` | string | `""` |  | Chữ chính (tiêu đề, tên, câu trích dẫn…); bỏ trống = chữ mẫu |
| `subtitle` | string | `""` |  | Chữ phụ (dòng mô tả, chức danh, tác giả…); bỏ trống = chữ mẫu |
| `accent` | string | `""` |  | Màu nhấn dạng #RRGGBB; bỏ trống = màu của mẫu |
| `ratio` | string | `"16:9"` | `16:9` — 16:9 — ngang (YouTube)<br>`9:16` — 9:16 — dọc (TikTok, Reels)<br>`1:1` — 1:1 — vuông | Khung hình |
| `duration` | number | `0` | 0 – 600 | Thời lượng (giây); 0 = theo mẫu (có video nền thì theo video) |
| `quality` | string | `"standard"` | `draft` — Nháp — nhanh để xem thử<br>`standard` — Chuẩn<br>`high` — Cao — đẹp nhất, chậm hơn | Chất lượng video |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `video` | `video` | không | Video tạo từ mẫu (mẫu dạng video) |
| `image` | `image` | không | Ảnh tạo từ mẫu (mẫu dạng ảnh, ví dụ thumbnail) |
| `composition` | `composition` | có | Bản dựng đã điền — sửa tiếp bằng compose_edit hoặc trong trình Dựng video |
<!-- AUTO:io:end -->

**Giải thích thêm về tham số:**
- `template`: danh sách đọc từ thư viện `library/templates` — thêm mẫu = thêm một thư mục `template.json`, tool có ngay.
- `title` / `subtitle` / `accent`: bỏ trống dùng giá trị mẫu. Mỗi mẫu dùng các chỗ trống khác nhau (ví dụ đếm ngược chỉ dùng `title`).
- Ảnh / video nền là tùy chọn: mẫu tự bỏ lớp nền khi không có.
- `duration = 0`: theo mẫu, hoặc theo video nền nếu có. Đặt số khác thì nhịp chuyển động của mẫu được giãn đều.

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Màn tiêu đề mở đầu**

```powershell
mediatool-dev run tools/compose/template --example 1
```

```ts
await ws.tools.run("compose_template", { inputs: { /* asset */ }, params: {"template": "title_card", "title": "Chuyện như chưa bắt đầu", "subtitle": "Tập 1", "quality": "draft"} });
```

**Ví dụ 2: Ảnh thumbnail từ ảnh nền**

```powershell
mediatool-dev run tools/compose/template --example 2
```

```ts
await ws.tools.run("compose_template", { inputs: { /* asset */ }, params: {"template": "thumbnail", "title": "Xem ngay kẻo lỡ", "subtitle": "MỚI", "accent": "#FFD400"} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Làm cho mình ảnh thumbnail từ ảnh này, tiêu đề 'Bí kíp nấu phở', màu vàng."

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_voiceover_captions`, `media_apply`, `speech_dub`, `speech_synthesize`, `speech_voice_add`, `video_demux`
- **Tool nối được ra sau (nhận output):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_edit`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_voiceover_captions`, `lyrics_align`, `media_apply`, `media_probe`, `music_beat_track`, `speech_dub`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`, `video_info`
<!-- AUTO:chain:end -->

**Chuỗi hay dùng:**
```
video_thumbnail (sắp có) → segment (sắp có) → compose_template (thumbnail)    = làm thumbnail tự động
compose_template → compose_edit → compose_render                              (chỉnh thêm rồi xuất lại)
```

## 5. Cách hoạt động

Mẫu là bản dựng khung 1920×1080 có chỗ trống `{{title}}`, `{{subtitle}}`, `{{accent}}`, `{{image}}`, `{{video}}`. Tool điền chỗ trống (đệ quy trong mọi chuỗi), bỏ các lớp có `_requires` mà người dùng không đưa file, đổi khung theo `ratio` (vị trí là tỉ lệ nên tự co giãn), giãn nhịp theo `duration`, thêm nhạc nền, rồi render qua `mediatool_sdk.compose` (mẫu ảnh render một khung).

## 6. Lỗi và cảnh báo

| Mã / lỗi | Khi nào | Người dùng nên làm gì |
|---|---|---|
| `InputError template` | Tên mẫu không có trong thư viện | Chọn mẫu trong danh sách |
| Tool "không dùng được" | Thư viện chưa có mẫu nào | Báo người quản trị (thiếu `library/templates`) |
| `RENDER_FAILED` | Engine không xuất được | Thử `draft`, kiểm tra ảnh/video nền |

## 7. Giới hạn

- Mẫu được thiết kế cho khung ngang; ở khung dọc chữ tự xuống dòng nhưng bố cục có thể cần chỉnh thêm.
- Ảnh đầu ra là JPEG.

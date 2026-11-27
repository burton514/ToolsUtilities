# Phụ đề phong cách phim

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `compose_film_subtitles` |
| **Category** | `compose` |
| **Phiên bản** | 0.1.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 50 MB · GPU: none · heavy: no |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

**Chuỗi đã lưu** (không có code riêng): đưa vào **video + file phụ đề/lời có thời gian**, chọn tông màu và kiểu chữ, nhận **video đã có màu phim và phụ đề**. Dùng được như một tool độc lập, và lồng được vào chuỗi khác.

**Dùng khi:**
- Muốn trong một lần: video màu đẹp kiểu phim + phụ đề đẹp.

**Không dùng khi:**
- Chỉ cần đổi màu → dùng `media_apply`. Chỉ cần chèn phụ đề → dùng `compose_bind`.

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `video` | `video` | có | Video cần làm |
| `subtitle` | `subtitle` | có | Phụ đề .srt/.vtt hoặc lời .lrc có thời gian |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `look` | string | `"teal_orange"` | `teal_orange` — Cam – xanh điện ảnh<br>`golden_hour` — Hoàng hôn<br>`vintage` — Cổ điển<br>`faded_film` — Phim phai<br>`noir` — Đen trắng tương phản<br>`old_film` — Phim cũ<br>`cyberpunk` — Cyberpunk | Tông màu phim |
| `style` | string | `"cinema"` | `cinema` — Điện ảnh<br>`subtitle` — Phụ đề thường<br>`tiktok` — TikTok<br>`karaoke` — Karaoke<br>`lyric` — Lời bài hát nghệ thuật | Kiểu chữ phụ đề |
| `quality` | string | `"standard"` | `draft`<br>`standard`<br>`high` | Chất lượng video: draft = nhanh để xem thử |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `composition` | `composition` | có | Bản dựng phần phụ đề — chỉnh tiếp bằng compose_edit |
| `video` | `video` | có | Video đã có tông màu phim và phụ đề |
<!-- AUTO:io:end -->

## 3. Các bước

<!-- AUTO:steps:start -->
| # | Bước | Tool | Nhận | Tham số cố định |
|---|---|---|---|---|
| 1 | Áp tông màu phim | `media_apply` | `video` ← `$input.video` | `effect="$param.look"`, `quality="$param.quality"` |
| 2 | Chèn phụ đề | `compose_bind` | `video` ← `$look.video`, `subtitle` ← `$input.subtitle` | `style="$param.style"`, `quality="$param.quality"` |
<!-- AUTO:steps:end -->

## 4. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Video mẫu + phụ đề, tông cam – xanh**

```powershell
mediatool-dev run tools/compose/film_subtitles --example 1
```

```ts
await ws.tools.run("compose_film_subtitles", { inputs: { /* asset */ }, params: {"look": "teal_orange", "style": "cinema", "quality": "draft"} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Làm video này màu phim cũ và gắn phụ đề từ file srt."

## 5. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `lyrics_align`, `media_apply`, `speech_dub`, `speech_synthesize`, `speech_transcribe`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`
- **Tool nối được ra sau (nhận output):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_edit`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `lyrics_align`, `media_apply`, `media_probe`, `music_beat_track`, `speech_dub`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`, `video_info`
<!-- AUTO:chain:end -->

## 6. Cách hoạt động

Core đọc `chain.json` (registry coi `entry = "chain:chain.json"` là chuỗi) và chạy từng bước thành **job con** qua đúng bộ lập lịch: bước 1 `media_apply` áp tông màu, output video nối vào bước 2 `compose_bind`. Tham số của chuỗi (`look`, `style`, `quality`) được thay vào tham số từng bước (`$param.*`). Tiến độ và lệnh hủy truyền xuống bước đang chạy.

## 7. Lỗi và cảnh báo

| Mã / lỗi | Khi nào | Người dùng nên làm gì |
|---|---|---|
| `CHAIN_STEP_REJECTED` | Một bước không nhận input/tham số | Đọc thông báo (ghi rõ bước nào, trường nào) |
| `CHAIN_STEP_FAILED` | Một bước chạy lỗi | Đọc thông báo; thử từng tool riêng (`media_apply`, `compose_bind`) để khoanh vùng |
| Tool "không dùng được" | Thiếu `media_apply` hoặc `compose_bind` | Báo người quản trị |

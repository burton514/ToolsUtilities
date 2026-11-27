# Phụ đề tự động

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `compose_auto_captions` |
| **Category** | `compose` |
| **Phiên bản** | 0.3.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 50 MB · GPU: none · heavy: no |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

**Chuỗi đã lưu** (không có code riêng): đưa vào **một video có người nói**, nhận lại **video đã có phụ đề** (mặc định kiểu TikTok — từ đang nói đổi màu), kèm file **.srt** để sửa nếu cần. Dùng được như một tool độc lập, và lồng được vào chuỗi khác.

**Dùng khi:**
- Làm phụ đề cho video nói chuyện / vlog / bán hàng để đăng TikTok, Reels, Shorts mà chưa có file phụ đề.

**Không dùng khi:**
- Đã có file phụ đề → dùng thẳng `compose_bind`.
- Chỉ cần file .srt, không cần video → dùng `speech_transcribe`.

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `video` | `video` | có | Video có người nói |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `language` | string | `"vi"` | `vi` — Tiếng Việt<br>`en` — Tiếng Anh<br>`zh` — Tiếng Trung<br>`ja` — Tiếng Nhật<br>`ko` — Tiếng Hàn<br>`th` — Tiếng Thái<br>`fr` — Tiếng Pháp<br>`de` — Tiếng Đức<br>`es` — Tiếng Tây Ban Nha | Ngôn ngữ đang nói — chọn đúng để dùng model hợp với ngôn ngữ đó |
| `model` | string | `"base"` | `base` — Nhanh (tiếng Việt 240 MB · ngôn ngữ khác 145 MB)<br>`small` — Chính xác hơn, chậm hơn (tiếng Việt 1,5 GB · ngôn ngữ khác 465 MB) | Mức nhận dạng |
| `style` | string | `"tiktok"` | `tiktok` — TikTok (từ đang nói đổi màu)<br>`karaoke` — Karaoke<br>`subtitle` — Phụ đề thường<br>`cinema` — Điện ảnh<br>`lyric` — Lời bài hát nghệ thuật | Kiểu chữ phụ đề |
| `max_chars` | integer | `18` | 0 – 120 | Số ký tự tối đa mỗi dòng (0 = nguyên câu) |
| `position` | string | `"middle"` | `bottom` — Dưới<br>`middle` — Giữa<br>`top` — Trên | Vị trí chữ |
| `quality` | string | `"standard"` | `draft`<br>`standard`<br>`high` | Chất lượng video: draft = nhanh để xem thử |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `composition` | `composition` | có | Bản dựng phần phụ đề — chỉnh tiếp bằng compose_edit |
| `subtitle` | `subtitle` | có | Phụ đề .srt — sửa lại nếu cần rồi dùng compose_bind |
| `video` | `video` | có | Video đã có phụ đề tự động |
<!-- AUTO:io:end -->

## 3. Các bước

<!-- AUTO:steps:start -->
| # | Bước | Tool | Nhận | Tham số cố định |
|---|---|---|---|---|
| 1 | Nghe và chép lời | `speech_transcribe` | `media` ← `$input.video` | `model="$param.model"`, `language="$param.language"`, `max_chars="$param.max_chars"` |
| 2 | Chèn phụ đề | `compose_bind` | `video` ← `$input.video`, `data` ← `$listen.transcript` | `style="$param.style"`, `position="$param.position"`, `quality="$param.quality"` |
<!-- AUTO:steps:end -->

## 4. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Video nói tiếng Anh → phụ đề TikTok**

```powershell
mediatool-dev run tools/compose/auto_captions --example 1
```

```ts
await ws.tools.run("compose_auto_captions", { inputs: { /* asset */ }, params: {"language": "en", "style": "tiktok", "quality": "draft"} });
```

**Ví dụ 2: Video nói tiếng Việt → phụ đề TikTok**

```powershell
mediatool-dev run tools/compose/auto_captions --example 2
```

```ts
await ws.tools.run("compose_auto_captions", { inputs: { /* asset */ }, params: {"language": "vi", "style": "tiktok", "quality": "draft"} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Làm phụ đề TikTok tiếng Việt cho video này."

## 5. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `compose_auto_dub`, `compose_bind`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `media_apply`, `speech_dub`, `video_demux`
- **Tool nối được ra sau (nhận output):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_dub`, `compose_bind`, `compose_edit`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `lyrics_align`, `media_apply`, `media_probe`, `music_beat_track`, `speech_dub`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`, `video_info`
<!-- AUTO:chain:end -->

## 6. Cách hoạt động

Core đọc `chain.json` và chạy từng bước thành **job con**: bước 1 `speech_transcribe` nghe video và chép lời kèm thời gian từng từ (dòng ngắn theo `max_chars`), bước 2 `compose_bind` nhận `transcript` đó qua input `data` và chèn chữ theo kiểu đã chọn lên chính video gốc. Lần chạy đầu sẽ tải model nhận dạng (145 MB với `base`).

Phụ đề nhận dạng sai chỗ nào: sửa file `subtitle` (.srt) rồi chạy `compose_bind` với file đã sửa.

## 7. Lỗi và cảnh báo

| Mã / lỗi | Khi nào | Người dùng nên làm gì |
|---|---|---|
| `CHAIN_STEP_REJECTED` | Một bước không nhận input/tham số | Đọc thông báo (ghi rõ bước nào, trường nào) |
| `CHAIN_STEP_FAILED` | Một bước chạy lỗi (ví dụ video không có tiếng, không tải được model) | Đọc thông báo; thử riêng `speech_transcribe` để khoanh vùng |
| Tool "không dùng được" | Thiếu `speech_transcribe` hoặc `compose_bind` | Báo người quản trị |

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

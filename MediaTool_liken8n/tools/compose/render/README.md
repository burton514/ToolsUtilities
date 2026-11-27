# Xuất bản dựng thành video

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `compose_render` |
| **Nguồn** | MediaTool engine (Skia + FFmpeg) · [rust-skia/rust-skia](https://github.com/rust-skia/rust-skia) |
| **Category** | `compose` |
| **Phiên bản** | 0.1.2 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 2400 MB · GPU: none · heavy: yes |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Biến một **composition** (bản dựng nhiều lớp: video, ảnh, chữ nghệ thuật, hình, keyframe, animation) thành video MP4 (H.264 + AAC). Engine render là code native: **Skia** ghép lớp và vẽ chữ, **FFmpeg** giải mã, mã hóa và trộn tiếng.

**Dùng khi:**
- Bước cuối của timeline editor hoặc của chuỗi tool `compose_*`.

**Không dùng khi:**
- Chỉ cần ghép hình và tiếng có sẵn, không có lớp đồ họa → dùng `media_mux` (nhanh hơn, không mã hóa lại).

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `composition` | `composition` | có | Bản dựng (JSON) cần xuất thành video |
| `media` | `file (nhiều)` | không | Các file nguồn mà bản dựng tham chiếu (video, ảnh, âm thanh) |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `quality` | string | `"standard"` | `draft` — Nháp — 540p, nhanh để xem thử<br>`standard` — Chuẩn — đúng khung bản dựng<br>`high` — Cao — đẹp nhất, chậm hơn | Chất lượng video |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `video` | `video` | có | Video MP4 (H.264 + AAC) đã xuất |
<!-- AUTO:io:end -->

**Giải thích thêm:**
- `media`: truyền **mọi** file mà composition tham chiếu. Nguồn trong composition viết dạng `asset:<id>` (editor/API) hoặc `file:<tên file>` (ví dụ, test).
- `quality = draft` xuất 540p với preset nhanh, hợp để xem thử trước khi xuất bản cuối.

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Xuất bản dựng mẫu (xem thử)**

```powershell
mediatool-dev run tools/compose/render --example 1
```

```ts
await ws.tools.run("compose_render", { inputs: { /* asset */ }, params: {"quality": "draft"} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Xuất bản dựng này ra video chất lượng cao."

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_edit`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_template`, `compose_voiceover_captions`, `lyrics_align`, `media_apply`, `media_probe`, `music_beat_track`, `speech_dub`, `speech_synthesize`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`, `video_info`
- **Tool nối được ra sau (nhận output):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_template`, `compose_voiceover_captions`, `lyrics_align`, `media_apply`, `media_probe`, `music_beat_track`, `speech_dub`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`, `video_info`
<!-- AUTO:chain:end -->

**Lưu ý khi tích hợp:**
- Timeline editor tải composition lên thành asset (format `composition`) rồi gọi tool này kèm danh sách `media`.
- Xem trước từng khung dùng endpoint `POST /v1/preview/frame` của core (cùng engine), nên thấy sao xuất vậy.

## 5. Cách hoạt động

1. Đọc composition, đổi nguồn `asset:`/`file:` thành đường dẫn file thật.
2. Gọi `mediatool-render export`: engine Rust render từng khung bằng Skia (CPU), đẩy RGBA qua pipe vào FFmpeg (`libx264`); tiếng của các lớp video/audio được FFmpeg cắt (`atrim`), dời (`adelay`), chỉnh âm lượng và trộn (`amix`).
3. Đọc tiến độ JSON-lines của engine và báo về qua `ctx.progress`.

## 6. Hiệu năng và tài nguyên

<!-- AUTO:bench:start -->
_Chưa có số đo. Chạy trong sandbox để đo RAM đỉnh và thời gian._
<!-- AUTO:bench:end -->

## 7. Model và license

<!-- AUTO:models:start -->
| Model | Kích thước | License | Nguồn |
|---|---|---|---|
| _(không dùng model)_ | | | |
<!-- AUTO:models:end -->

Engine dùng Skia (BSD) và FFmpeg (LGPL; bản Debian có libx264 → GPL khi phân phối).

## 8. Tiếng Việt

Chữ được dàn trang bằng Skia Paragraph (HarfBuzz + ICU) với font Noto, dấu tiếng Việt hiển thị đúng.

## 9. Lỗi và cảnh báo

| Mã | Loại | Khi nào xảy ra | Cách xử lý cho người dùng |
|---|---|---|---|
| `INVALID_INPUT` (`media`) | InputError | Composition tham chiếu file chưa được truyền vào `media` | Truyền đủ file nguồn |
| `RENDER_FAILED` | ToolError | Engine hoặc FFmpeg lỗi (file nguồn hỏng, codec lạ) | Xem log; thử `media_transcode` file nguồn trước |
| `MISSING_BINARY` | ToolError | Máy chạy thiếu `mediatool-render` hoặc FFmpeg | Dùng image Docker của core |

## 10. Giới hạn đã biết

- Render trên CPU; video 1080p dài sẽ mất thời gian (đang chờ backend GPU).
- Chưa hỗ trợ: Lottie, hiệu ứng hạt, mask, mốc thời gian theo beat/lời (xem COMPOSITION_FORMAT.md).

## 11. Hỏi đáp và xử lý sự cố

**Xuất bị chậm?** Dùng `quality = draft` để xem thử; bản cuối mới dùng `standard`/`high`.

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

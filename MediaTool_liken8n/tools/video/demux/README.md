# Tách video thành từng phần

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `video_demux` |
| **Category** | `video` |
| **Phiên bản** | 0.1.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 200 MB · GPU: none · heavy: no |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Tách một video thành **hình (không tiếng)**, **tiếng** và **các phụ đề có sẵn** trong file. Phần hình được giữ nguyên chất lượng (không mã hóa lại).

**Dùng khi:**
- Bắt đầu mọi luồng xử lý video: lấy tiếng để tách giọng, phiên âm, căn lời; lấy hình để dựng lại.
- Cần lấy phụ đề nhúng sẵn trong file MKV/MP4.

**Không dùng khi:**
- Chỉ cần xem thông tin file → dùng `media_probe`.
- Muốn đổi định dạng cả video → dùng `media_transcode`.

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `video` | `video` | có | Video cần tách |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `audio_format` | string | `"wav"` | `wav`, `original`, `mp3` | Định dạng file tiếng tách ra: wav (dễ xử lý tiếp nhất), original (giữ nguyên, nhanh nhất), mp3 (nhẹ) |
| `audio_track` | integer | `1` | 1 – 32 | Chọn track tiếng nếu video có nhiều track (1, 2, …) |
| `extract_subtitles` | boolean | `true` |  | Lấy luôn phụ đề có sẵn trong file |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `video` | `video` | có | Hình, không có tiếng (giữ nguyên chất lượng) |
| `audio` | `audio` | không | Tiếng của track đã chọn (không có nếu video không có tiếng) |
| `subtitles` | `subtitle (nhiều)` | không | Các phụ đề dạng chữ có sẵn trong file |
| `info` | `json` | có | Thông tin các luồng của video gốc |
<!-- AUTO:io:end -->

**Giải thích thêm về tham số:**
- `audio_format = wav`: file nặng nhưng mọi tool phía sau đọc được ngay, không mất chất lượng. Nên dùng khi còn xử lý tiếp.
- `audio_format = original`: nhanh nhất, giữ nguyên chất lượng gốc. Đuôi file theo codec gốc (`.m4a`, `.mp3`, `.opus`…).
- `audio_track`: xem số track bằng `media_probe` (`audio_tracks`).

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Tách hình và tiếng (WAV)**

```powershell
mediatool-dev run tools/video/demux --example 1
```

```ts
await ws.tools.run("video_demux", { inputs: { /* asset */ }, params: {"audio_format": "wav"} });
```

**Ví dụ 2: Tách tiếng giữ nguyên định dạng + phụ đề**

```powershell
mediatool-dev run tools/video/demux --example 2
```

```ts
await ws.tools.run("video_demux", { inputs: { /* asset */ }, params: {"audio_format": "original", "extract_subtitles": true} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Tách tiếng của video này ra file riêng."

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `compose_render`
- **Tool nối được ra sau (nhận output):** `compose_render`, `media_probe`
<!-- AUTO:chain:end -->

**Chuỗi hay dùng:**
```
video_demux → audio_separate_stems → lyrics_align → karaoke_render_subtitle → karaoke_compose
```

**Lưu ý khi tích hợp:**
- Trong mini app: đưa `audio` lên timeline bằng `ws.timeline.addTrack({ id: "audio", source: outputs.audio })`.
- Video không có tiếng vẫn thành công, kèm `warning` "Video không có tiếng"; khi đó output `audio` không có.

## 5. Cách hoạt động

1. `ffprobe` đọc các luồng.
2. Hình: `ffmpeg -map 0:v:0 -c copy` (không mã hóa lại, rất nhanh). Container giữ theo file gốc nếu là mp4/mkv/mov/webm, ngược lại dùng mkv.
3. Tiếng: chọn track theo `audio_track`, xuất theo `audio_format`.
4. Phụ đề dạng chữ: xuất SRT (hoặc giữ ASS). Phụ đề dạng ảnh (PGS, DVD) được bỏ qua kèm cảnh báo.

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

## 8. Tiếng Việt

Phụ đề tiếng Việt được giữ nguyên mã UTF-8.

## 9. Lỗi và cảnh báo

| Mã | Loại | Khi nào xảy ra | Cách xử lý cho người dùng |
|---|---|---|---|
| `INVALID_INPUT` (`video`) | InputError | File không có hình | Dùng file như audio, không cần tách |
| `INVALID_INPUT` (`audio_track`) | InputError | Chọn track không tồn tại | Chọn số track nhỏ hơn (xem `media_probe`) |
| `FFMPEG_FAILED` | ToolError | File hỏng hoặc codec lạ | Thử `media_transcode` trước rồi tách lại |
| "Video không có tiếng" | warning | Video không có track tiếng | Không cần làm gì |
| "Bỏ qua phụ đề …" | warning | Phụ đề dạng ảnh | Chưa hỗ trợ; dùng phụ đề dạng chữ |

## 10. Giới hạn đã biết

- Chỉ lấy luồng hình đầu tiên.
- Phụ đề dạng ảnh (PGS, VobSub) chưa hỗ trợ.

## 11. Hỏi đáp và xử lý sự cố

**File tiếng WAV quá nặng?** Chọn `audio_format = mp3` nếu không xử lý tiếp.

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

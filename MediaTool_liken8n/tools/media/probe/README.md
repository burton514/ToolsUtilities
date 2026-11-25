# Xem thông tin file

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `media_probe` |
| **Category** | `media` |
| **Phiên bản** | 0.1.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 100 MB · GPU: none · heavy: no |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Đọc thông tin của một file video hoặc audio: thời lượng, kích thước khung hình, số hình mỗi giây, các track tiếng và phụ đề. Tool **không thay đổi** file.

**Dùng khi:**
- Cần biết file dài bao lâu, là video hay audio, có tiếng hoặc phụ đề không, trước khi chọn tool xử lý tiếp.
- Cần kiểm tra kết quả của một tool khác (ví dụ file xuất ra có đúng 1080p không).

**Không dùng khi:**
- Muốn đổi định dạng hay chất lượng → dùng `media_transcode`.
- Muốn tách hình/tiếng → dùng `video_demux`.

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `file` | `media` | có | File video hoặc audio cần xem thông tin |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| _(không có)_ | | | | |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `info` | `json` | có | Thông tin file: thời lượng, khung hình, fps, âm thanh, phụ đề, các luồng |
<!-- AUTO:io:end -->

**Nội dung của `info`:** `duration_s`, `size_bytes`, `container`, `bit_rate`, `has_video`, `has_audio`, `has_subtitles`, `video` (`codec`, `width`, `height`, `fps`), `audio_tracks[]` (`index`, `codec`, `sample_rate`, `channels`, `language`), `subtitle_tracks[]`.

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Xem thông tin video mẫu**

```powershell
mediatool-dev run tools/media/probe --example 1
```

```ts
await ws.tools.run("media_probe", { inputs: { /* asset */ }, params: {} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "File này dài bao lâu, có phụ đề không?"

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `video_demux`
- **Tool nối được ra sau (nhận output):** _chưa có_
<!-- AUTO:chain:end -->

**Lưu ý khi tích hợp:**
- Tool chạy rất nhanh (dưới 1 giây), nên gọi trước để chọn tham số cho tool sau (ví dụ chọn `audio_track` cho `video_demux`).
- Ảnh bìa nhúng trong file audio không bị tính là video.

## 5. Cách hoạt động

Gọi `ffprobe` (qua `ctx.probe`), lấy luồng video chính (bỏ qua ảnh bìa), các luồng audio và phụ đề, rồi rút gọn thành JSON dễ dùng.

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

Không liên quan. Riêng câu tóm tắt (`summary`) được viết bằng tiếng Việt.

## 9. Lỗi và cảnh báo

| Mã | Loại | Khi nào xảy ra | Cách xử lý cho người dùng |
|---|---|---|---|
| `MISSING_BINARY` | ToolError | Máy chạy không có ffprobe | Cài FFmpeg (bản Docker có sẵn) |
| `PROBE_FAILED` | ToolError | File hỏng hoặc không phải media | Kiểm tra lại file, thử mở bằng trình phát |
| `INVALID_INPUT` | InputError | Không có file hoặc sai loại file | Chọn file video hoặc audio |

## 10. Giới hạn đã biết

- Thời lượng lấy từ container; một số file ghi sai thời lượng (file ghi hình bị ngắt giữa chừng).

## 11. Hỏi đáp và xử lý sự cố

**`fps` ra số lẻ như 29.97?** Đó là chuẩn NTSC, hoàn toàn bình thường.

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

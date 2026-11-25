# Thông tin video

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `video_info` |
| **Category** | `video` |
| **Phiên bản** | 0.1.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 100 MB · GPU: none · heavy: no |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Xem nhanh thông tin cơ bản của một video, viết bằng lời dễ hiểu: **thời lượng, kích thước khung hình, chất lượng (SD/HD/Full HD/4K), tỉ lệ khung, số hình mỗi giây, dung lượng, có tiếng hay không, định dạng**. Tool không thay đổi file.

**Dùng khi:**
- Người dùng muốn biết video dài bao lâu, nét cỡ nào, nặng bao nhiêu, có tiếng không.

**Không dùng khi:**
- Cần số liệu kỹ thuật chi tiết (codec, từng luồng, phụ đề) → dùng `media_probe`.

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `video` | `video` | có | Video cần xem thông tin |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| _(không có)_ | | | | |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `info` | `json` | có | Thông tin video: danh sách mục dễ đọc (nhãn + giá trị) và số liệu gốc |
<!-- AUTO:io:end -->

**Nội dung của `info`:**
- `items`: danh sách `{label, value}` để hiển thị thẳng cho người dùng, ví dụ `{"label": "Thời lượng", "value": "5:03"}`.
- `raw`: số liệu gốc cho máy dùng tiếp (`duration_s`, `size_bytes`, `width`, `height`, `fps`, `has_audio`…).

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Xem thông tin video mẫu**

```powershell
mediatool-dev run tools/video/info --example 1
```

```ts
await ws.tools.run("video_info", { inputs: { /* asset */ }, params: {} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Video này dài bao lâu, nét không, nặng bao nhiêu?"

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `compose_render`, `video_demux`
- **Tool nối được ra sau (nhận output):** `compose_render`
<!-- AUTO:chain:end -->

**Lưu ý khi tích hợp:**
- Giao diện chỉ cần hiển thị `items` theo thứ tự, không phải tự định dạng số.

## 5. Cách hoạt động

Đọc thông tin bằng `ffprobe` (qua `ctx.probe`), rồi đổi sang cách viết dễ hiểu: thời lượng dạng phút:giây, dung lượng MB/GB, chất lượng theo chiều cao khung hình, tỉ lệ khung gần nhất (16:9, 9:16, 1:1, 4:3…).

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

Nhãn và câu tóm tắt viết bằng tiếng Việt.

## 9. Lỗi và cảnh báo

| Mã | Loại | Khi nào xảy ra | Cách xử lý cho người dùng |
|---|---|---|---|
| `PROBE_FAILED` | ToolError | File hỏng hoặc không phải video | Kiểm tra lại file |
| `INVALID_INPUT` | InputError | Chưa chọn file hoặc file không phải video | Chọn một file video |

## 10. Giới hạn đã biết

- Thời lượng lấy từ phần đầu file; video ghi dở có thể báo sai.

## 11. Hỏi đáp và xử lý sự cố

**“Chất lượng” tính thế nào?** Theo chiều cao khung hình: 720 → HD, 1080 → Full HD, 2160 → 4K.

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

<!--
  MẪU TÀI LIỆU TOOL — copy thành tools/<category>/<name>/README.md (lệnh `mediatool-dev new` tự copy).

  Quy ước:
  - Các khối nằm giữa hai dấu mốc AUTO:xxx:start và AUTO:xxx:end do `mediatool-dev docs` SINH TỰ ĐỘNG
    từ manifest.toml + schema + số đo trong sandbox. KHÔNG sửa tay. CI báo lỗi nếu các khối này cũ.
  - Các phần còn lại do người viết tool tự viết, bằng tiếng Việt. Phần nào không áp dụng thì ghi "Không có", không xóa tiêu đề.
  - Viết cho 3 kiểu người đọc: người dùng (cách dùng), người tích hợp (mini app, API, MCP), người bảo trì (cách hoạt động, lỗi).
-->

# <Tên tool hiển thị>

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `category_name` |
| **Category** | `category` |
| **Phiên bản** | 0.1.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | experimental / beta / stable |
| **Người phụ trách** | ten-github |
| **Runtime** | profile `base` · RAM khai báo 300 MB · GPU: none · heavy: no |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Một đến hai câu: tool làm gì, đầu vào là gì, đầu ra là gì.

**Dùng khi:**
- …

**Không dùng khi** (và nên dùng tool nào thay thế):
- … → dùng `other_tool`

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
<!-- AUTO:io:end -->

**Giải thích thêm về tham số** (khi nào nên chỉnh, ảnh hưởng tới chất lượng, tốc độ và RAM):
- `param_a`: …

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
<!-- Sinh từ [[examples]]: bảng ví dụ, mỗi ví dụ kèm lệnh CLI, request HTTP và lời gọi trong mini app -->
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "…câu lệnh tự nhiên mà người dùng có thể nói, ví dụ: Tách giọng hát khỏi file này…"

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
<!-- Sinh tự động theo `format`: các tool có output nối được vào input của tool này (upstream),
     và các tool nhận được output của tool này (downstream) -->
<!-- AUTO:chain:end -->

**Chuỗi hay dùng** (người viết bổ sung):
```
video_demux → (tool này) → lyrics_align
```

**Lưu ý khi tích hợp:**
- Trong mini app: …(ví dụ: nên đưa output lên timeline bằng `ws.timeline.addTrack`)
- Qua API: …(ví dụ: job dài, nên theo dõi SSE thay vì gọi lặp lại để hỏi trạng thái)
- Với workflow: …(ví dụ: cache được, kết quả chỉ phụ thuộc input + params)

## 5. Cách hoạt động

Mô tả ngắn thuật toán hoặc pipeline bên trong, thư viện và model chính, các bước xử lý. Đủ để người khác bảo trì được tool.

## 6. Hiệu năng và tài nguyên

<!-- AUTO:bench:start -->
<!-- Sinh từ số đo của sandbox / `mediatool-dev bench`: RAM đỉnh, thời gian, trên máy chuẩn
     (CPU 4 nhân, 8 GB RAM, không GPU) với file mẫu 10 giây và bài hát dài 4 phút -->
| Kịch bản | Thời gian | RAM đỉnh | Thiết bị |
|---|---|---|---|
<!-- AUTO:bench:end -->

Mẹo dùng trên máy yếu: …

## 7. Model và license

<!-- AUTO:models:start -->
| Model | Kích thước | License | Nguồn |
|---|---|---|---|
<!-- AUTO:models:end -->

Ghi chú về license (đặc biệt là các model chỉ cho dùng phi thương mại, và model thay thế nếu cần dùng thương mại): …

## 8. Tiếng Việt

Chất lượng với tiếng Việt, xử lý dấu và chuẩn hóa chữ, phương ngữ, các trường hợp đặc biệt. Ghi "Không liên quan" nếu tool không xử lý ngôn ngữ.

## 9. Lỗi và cảnh báo

| Mã | Loại | Khi nào xảy ra | Cách xử lý cho người dùng |
|---|---|---|---|
| `INPUT_TOO_LONG` | InputError | … | … |
| `…` | warning | … | … |

## 10. Giới hạn đã biết

- …

## 11. Hỏi đáp và xử lý sự cố

**Kết quả bị … thì làm sao?**
…

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

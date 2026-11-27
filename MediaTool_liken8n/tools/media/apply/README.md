# Áp hiệu ứng cho video / ảnh

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `media_apply` |
| **Nguồn** | MediaTool engine (Skia + FFmpeg) · [rust-skia/rust-skia](https://github.com/rust-skia/rust-skia) |
| **Category** | `media` |
| **Phiên bản** | 0.1.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 2400 MB · GPU: none · heavy: yes |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Đưa vào **một video hoặc một ảnh**, chọn một hiệu ứng trong thư viện (bộ màu điện ảnh, hạt phim, VHS, glitch, chấm in báo, xóa phông xanh…) và chỉnh nhanh sáng / tương phản / độ đậm màu. Nhận lại **video (giữ nguyên tiếng) hoặc ảnh** đã áp.

**Dùng khi:**
- Muốn đổi "tông màu" hoặc thêm hiệu ứng cho cả video / ảnh mà không cần mở trình dựng.
- Làm một bước trong chuỗi tự động (ví dụ: áp bộ màu rồi chèn phụ đề).

**Không dùng khi:**
- Chỉ muốn hiệu ứng ở một đoạn hoặc chỉ một phần khung hình → dùng trình **Dựng video** (lớp điều chỉnh) hoặc `compose_edit`.
- Cần xóa nền người/vật thể (không phải phông xanh) → dùng `segment` (sắp có).

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `video` | `video` | không | Video cần áp hiệu ứng (đưa video hoặc ảnh) |
| `image` | `image` | không | Ảnh cần áp hiệu ứng (đưa video hoặc ảnh) |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `effect` | string | `"teal_orange"` | `none` — Không dùng hiệu ứng (chỉ chỉnh màu)<br>`beat_flash` — Ánh sáng · Lóe theo nhịp<br>`chroma_key` — Tách nền màu · Xóa phông xanh<br>`cool` — Bộ màu · Lạnh trong<br>`cyberpunk` — Bộ màu · Cyberpunk<br>`duotone` — Bộ màu · Hai tông màu<br>`faded_film` — Bộ màu · Phim phai<br>`film_grain` — Phim · Hạt phim<br>`fisheye` — Biến dạng · Mắt cá<br>`flash` — Ánh sáng · Chớp sáng<br>`glitch` — Nghệ thuật · Glitch<br>`glow` — Nghệ thuật · Phát sáng (bloom)<br>`golden_hour` — Bộ màu · Hoàng hôn<br>`halftone` — Nghệ thuật · Chấm in báo<br>`kaleidoscope` — Nghệ thuật · Kính vạn hoa<br>`light_leak` — Phim · Lọt sáng<br>`luma_key` — Tách nền màu · Xóa nền đen / trắng<br>`mirror` — Nghệ thuật · Soi gương<br>`mono_soft` — Bộ màu · Đen trắng dịu<br>`noir` — Bộ màu · Đen trắng tương phản<br>`old_film` — Phim · Phim cũ<br>`pixelate` — Nghệ thuật · Ô vuông pixel<br>`posterize` — Nghệ thuật · Ít màu (poster)<br>`rgb_split` — Nghệ thuật · Tách màu RGB<br>`scanlines` — Phim · Sọc màn hình<br>`sepia` — Bộ màu · Nâu sepia<br>`shake` — Biến dạng · Rung máy<br>`sharpen` — Nghệ thuật · Làm nét<br>`strobe` — Ánh sáng · Nhấp nháy<br>`swirl` — Biến dạng · Xoáy<br>`teal_orange` — Bộ màu · Cam – xanh điện ảnh<br>`vhs` — Phim · Băng VHS<br>`vibrance` — Bộ màu · Rực rỡ<br>`vignette` — Phim · Tối viền<br>`vintage` — Bộ màu · Cổ điển<br>`warm` — Bộ màu · Ấm áp<br>`wave` — Biến dạng · Gợn sóng<br>`zoom_pulse` — Biến dạng · Đập theo nhịp | Hiệu ứng: bộ màu, phim, nghệ thuật, biến dạng… lấy từ thư viện |
| `strength` | integer | `100` | 0 – 100 | Độ mạnh của hiệu ứng: 0 = không thấy, 100 = đầy đủ |
| `brightness` | integer | `0` | -100 – 100 | Độ sáng: âm = tối hơn, dương = sáng hơn |
| `contrast` | integer | `0` | -100 – 100 | Tương phản: âm = dịu hơn, dương = gắt hơn |
| `saturation` | integer | `0` | -100 – 100 | Độ đậm màu: -100 = đen trắng, dương = rực hơn |
| `quality` | string | `"standard"` | `draft` — Nháp — nhanh để xem thử<br>`standard` — Chuẩn — giữ kích thước gốc<br>`high` — Cao — đẹp nhất, chậm hơn | Chất lượng video |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `video` | `video` | không | Video đã áp hiệu ứng (khi đầu vào là video) |
| `image` | `image` | không | Ảnh đã áp hiệu ứng (khi đầu vào là ảnh) |
<!-- AUTO:io:end -->

**Giải thích thêm về tham số:**
- `effect`: danh sách lấy trực tiếp từ thư viện `library/effects` — thêm gói hiệu ứng mới là tool có ngay, không sửa code. Chọn "Không dùng hiệu ứng" để chỉ chỉnh màu.
- `strength`: giảm xuống 40–70 nếu hiệu ứng quá gắt.
- `quality`: `draft` để xem thử nhanh (540p); `standard` giữ đúng kích thước gốc.

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Áp bộ màu cam – xanh điện ảnh cho video**

```powershell
mediatool-dev run tools/media/apply --example 1
```

```ts
await ws.tools.run("media_apply", { inputs: { /* asset */ }, params: {"effect": "teal_orange", "quality": "draft"} });
```

**Ví dụ 2: Biến ảnh thành tranh chấm in báo**

```powershell
mediatool-dev run tools/media/apply --example 2
```

```ts
await ws.tools.run("media_apply", { inputs: { /* asset */ }, params: {"effect": "halftone", "strength": 100} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Cho video này tông màu phim cũ, giảm độ đậm màu một chút."

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `speech_dub`, `video_demux`
- **Tool nối được ra sau (nhận output):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `lyrics_align`, `media_probe`, `music_beat_track`, `speech_dub`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`, `video_info`
<!-- AUTO:chain:end -->

**Chuỗi hay dùng:**
```
media_apply (bộ màu) → compose_bind (chèn phụ đề)      = chuỗi compose_film_subtitles
video_demux → … → media_apply                          (áp màu cho phần hình đã tách)
```

## 5. Cách hoạt động

Tool dựng một bản dựng (composition) **một lớp**: nguồn phủ kín khung đúng kích thước gốc, kèm danh sách hiệu ứng, rồi gọi engine native `mediatool-render` (Skia + FFmpeg) qua `mediatool_sdk.compose`. Video được xuất song song theo đoạn và có cache; ảnh được render một khung. Tool không có code vẽ riêng — cùng engine với xem trước và xuất video của trình dựng.

## 6. Lỗi và cảnh báo

| Mã / lỗi | Khi nào | Người dùng nên làm gì |
|---|---|---|
| `InputError video` | Không đưa file, hoặc đưa cả video lẫn ảnh | Đưa đúng một video hoặc một ảnh |
| `InputError effect` | Tên hiệu ứng không có trong thư viện | Chọn hiệu ứng trong danh sách |
| `InputError video/image` "File không có hình" | File chỉ có tiếng | Dùng file có hình |
| `RENDER_FAILED` | Engine không xuất được (file hỏng, hết dung lượng…) | Thử lại với `draft`, kiểm tra file nguồn |
| `MISSING_BINARY` | Máy chủ thiếu engine `mediatool-render` | Báo người quản trị |

## 7. Giới hạn

- Ảnh đầu ra là JPEG (chưa giữ nền trong suốt).
- Hiệu ứng chạy trên CPU: video dài + hiệu ứng nặng (phát sáng, xoáy…) sẽ chậm; dùng `draft` để xem thử trước.

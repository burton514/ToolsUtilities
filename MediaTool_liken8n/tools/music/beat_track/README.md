# Bắt nhịp nhạc

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `music_beat_track` |
| **Nguồn** | [CPJKU/beat_this](https://github.com/CPJKU/beat_this) |
| **Category** | `music` |
| **Phiên bản** | 0.1.1 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 600 MB · GPU: none · heavy: no |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Đưa vào **một bản nhạc (hoặc video có nhạc)**, nhận lại **BPM, từng nhịp và phách mạnh** dưới dạng mốc thời gian. Dùng để cắt ghép, nháy hiệu ứng, cho chữ / ảnh bật đúng nhịp.

**Dùng khi:**
- Làm video "cắt theo nhịp" (beat sync), slideshow ảnh đổi đúng nhịp.
- Cần hiệu ứng / chuyển động chạy theo nhạc trong bản dựng (engine đọc markers kind `beat` / `downbeat`).
- Chỉ muốn biết bài nhạc bao nhiêu BPM.

**Không dùng khi:**
- Cần tách giọng hát / nhạc nền → dùng tool tách nguồn âm (sắp có).
- Âm thanh chủ yếu là lời nói, không có nhịp → kết quả sẽ rỗng hoặc không ổn định.

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `media` | `media` | có | Bản nhạc (audio) hoặc video có nhạc |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `start` | number | `0` | 0 – … | Chỉ phân tích từ giây này (0 = từ đầu) |
| `duration` | number | `0` | 0 – 3600 | Phân tích bao nhiêu giây (0 = đến hết) |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `beats` | `beat_grid` | có | Nhịp, phách mạnh, BPM và mốc thời gian (markers) — dùng cho cắt ghép / hiệu ứng theo nhịp |
<!-- AUTO:io:end -->

**Giải thích thêm về tham số:**
- `start`, `duration`: chỉ phân tích một đoạn (ví dụ đoạn điệp khúc). Thời gian trong kết quả vẫn tính theo **cả bài** (đã cộng `start`).

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Tìm nhịp bản nhạc mẫu 120 BPM**

```powershell
mediatool-dev run tools/music/beat_track --example 1
```

```ts
await ws.tools.run("music_beat_track", { inputs: { /* asset */ }, params: {} });
```

**Ví dụ 2: Chỉ phân tích 4 giây, từ giây thứ 2**

```powershell
mediatool-dev run tools/music/beat_track --example 2
```

```ts
await ws.tools.run("music_beat_track", { inputs: { /* asset */ }, params: {"start": 2, "duration": 4} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Bài nhạc này bao nhiêu BPM? Đánh dấu các nhịp vào bản dựng để chữ bật theo nhạc."

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `media_apply`, `speech_dub`, `speech_synthesize`, `speech_voice_add`, `video_demux`
- **Tool nối được ra sau (nhận output):** `compose_bind`, `compose_edit`, `compose_render`, `lyrics_align`, `speech_dub`
<!-- AUTO:chain:end -->

**Lưu ý khi tích hợp:**
- File `beats` (BeatGrid JSON) gồm: `bpm`, `meter` (số phách mỗi ô nhịp), `beats`, `downbeats` (giây), `markers`, `items`.
- `markers` đúng định dạng mốc của bản dựng — gộp vào bằng `compose_edit` (`{"op": "merge", "patch": {"markers": …}}`), sau đó hiệu ứng / chuyển động đặt `timing` theo `beat` / `downbeat` sẽ chạy đúng nhịp.
- `items` là TimedData (mỗi nhịp một mục, chữ là số phách "1 2 3 4") — `compose_bind` (input `data`) hiện được để kiểm tra nhịp.

## 5. Cách hoạt động

1. ffmpeg giải mã âm thanh về mono 22 050 Hz.
2. Tính phổ log-mel (STFT Hann 1024, bước 441 = 50 khung/giây, 128 dải mel 30 Hz–11 kHz) bằng numpy, đúng công thức lúc huấn luyện model.
3. Model Beat This! (ONNX, chạy CPU) xử lý từng đoạn 30 giây, chồng mép 6 khung, cho xác suất nhịp / phách mạnh mỗi khung.
4. Lấy đỉnh cục bộ (±3 khung, vượt ngưỡng), gộp đỉnh liền kề (đúng postprocessor `minimal` của Beat This); chỗ hai đoạn chồng nhau giữ kết quả đoạn trước (`keep_first`); phách mạnh gắn vào nhịp gần nhất; BPM = trung vị khoảng cách nhịp.

## 6. Hiệu năng và tài nguyên

<!-- AUTO:bench:start -->
_Chưa có số đo. Chạy trong sandbox để đo RAM đỉnh và thời gian._
<!-- AUTO:bench:end -->

## 7. Model và license

<!-- AUTO:models:start -->
| Model | Kích thước | License | Nguồn |
|---|---|---|---|
| `beat_this_small` | 10 MB | MIT | https://github.com/CPJKU/beat_this |
<!-- AUTO:models:end -->

Beat This! © Institute of Computational Perception, JKU Linz (MIT) — Foscarin, Schlüter, Widmer, *"Beat this! Accurate beat tracking without DBN postprocessing"*, ISMIR 2024. File ONNX lấy từ bản xuất có kèm LICENSE MIT gốc; chỉ dùng trọng số model, không dùng mã nguồn của dự án chứa file.

## 8. Tiếng Việt

Không liên quan.

## 9. Lỗi và cảnh báo

| Mã | Loại | Khi nào xảy ra | Cách xử lý cho người dùng |
|---|---|---|---|
| `INVALID_INPUT` | InputError | Input hoặc tham số sai | Kiểm tra lại file và tham số |
| `NO_AUDIO` | ToolError | File không có tiếng hoặc ngắn hơn 1 giây | Chọn file có nhạc |
| `MODEL_UNAVAILABLE` | ToolError | Không tải được model (mất mạng, sai mã băm) | Kiểm tra mạng rồi chạy lại; model chỉ tải một lần |
| `MISSING_PACKAGE` | ToolError | Máy chạy chưa cài onnxruntime | Dùng image core mới hoặc `pip install onnxruntime` |
| _(cảnh báo)_ | warning | Không thấy nhịp rõ ràng | Nhạc tự do / chỉ có lời nói |

## 10. Giới hạn đã biết

- Nhịp lệch khoảng ±20 ms (file mp3 có độ trễ mã hóa nhỏ ở đầu).
- `meter` là số phách phổ biến nhất giữa hai phách mạnh; bài đổi nhịp giữa chừng chỉ ghi một giá trị.
- BPM là trung bình cả đoạn; bài nhanh dần / chậm dần hãy dùng danh sách `beats`.

## 11. Hỏi đáp và xử lý sự cố

**BPM ra gấp đôi / một nửa?** Model chọn mức nhịp mà người nghe hay vỗ tay theo; nếu muốn mức khác, nhân / chia 2 khi dùng.

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

# Thuyết minh kèm phụ đề

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `compose_voiceover_captions` |
| **Category** | `compose` |
| **Phiên bản** | 0.1.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 50 MB · GPU: none · heavy: no |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

**Chuỗi đã lưu** (không có code riêng): đưa vào **video + lời thuyết minh dạng văn bản**, nhận **video có giọng đọc tự nhiên và phụ đề chạy đúng theo giọng**; tiếng gốc của video nhỏ lại làm nền. Dùng được như một tool độc lập, và lồng được vào chuỗi khác.

**Dùng khi:**
- Làm video giới thiệu, review, hướng dẫn, tin tức có giọng đọc mà không cần thu âm.

**Không dùng khi:**
- Muốn thay giọng nói đã có trong video → `compose_auto_dub`. Chỉ cần file giọng đọc → `speech_synthesize`.

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `video` | `video` | có | Video nền cần thuyết minh |
| `voice_file` | `voice` | không | Giọng riêng đã lưu (tùy chọn) |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `text` | string | `""` |  | Lời thuyết minh. Xuống dòng = sang đoạn mới |
| `voice` | string | `"Hải Đăng"` | `Adam bựa` — ⭐ Adam bựa — Nam · Bắc · Phong cách tự nhiên<br>`Trúc Ly` — ⭐ Trúc Ly — Nữ · Bắc · Phong cách tự nhiên<br>`Thiện Minh` — ⭐ Thiện Minh — Nam · Bắc · Phong cách kể chuyện<br>`Mai Anh` — ⭐ Mai Anh — Nữ · Bắc · Phong cách tin tức<br>`Hải Đăng` — ⭐ Hải Đăng — Nam · Bắc · Phong cách tự nhiên<br>`Thùy Dung` — ⭐ Thùy Dung — Nữ · Nam · Phong cách tin tức<br>`Thiền Tâm Đức` — ⭐ Thiền Tâm Đức — Nam · Bắc · Phong cách kể chuyện<br>`Ngọc Huyền` — ⭐ Ngọc Huyền — Nữ · Bắc · Giọng đọc tự nhiên<br>`Quang Sơn` — ⭐ Quang Sơn — Nam · Trung · Phong cách tự nhiên<br>`Ngọc Trân` — ⭐ Ngọc Trân — Nữ · Trung · Phong cách tự nhiên<br>`Minh Đức` — Minh Đức — Nam · Bắc · Phong cách tin tức<br>`Phạm Tuyên` — Phạm Tuyên — Nam · Bắc · Phong cách tự nhiên<br>`Thái Sơn` — Thái Sơn — Nam · Nam · Phong cách kể chuyện<br>`Xuân Vĩnh` — Xuân Vĩnh — Nam · Bắc · Phong cách tự nhiên<br>`Thanh Bình` — Thanh Bình — Nam · Bắc · Phong cách kể chuyện<br>`Ngọc Linh` — Ngọc Linh — Nữ · Bắc · Phong cách kể chuyện<br>`Đoan Trang` — Đoan Trang — Nữ · Bắc · Phong cách tự nhiên<br>`Thục Đoan` — Thục Đoan — Nữ · Nam · Phong cách kể chuyện<br>`Minh Triết` — Minh Triết — Nam · Nam · Phong cách tin tức<br>`Mỹ Duyên` — Mỹ Duyên — Nữ · Nam · Phong cách đọc truyện<br>`Quỳnh Anh` — Quỳnh Anh — Nữ · Bắc · Phong cách đọc truyện<br>`Đức Trí` — Đức Trí — Nam · Nam · Phong cách đọc truyện<br>`Kim Thanh` — Kim Thanh — Nữ · Nam · Phong cách đọc truyện<br>`Adam` — Adam — Nam · Nam · Giọng đọc tự nhiên<br>`Quốc Tuấn` — Quốc Tuấn — Nam · Bắc · Phong cách tự nhiên<br>`Ái Hân` — Ái Hân — Nữ · Nam · Phong cách tin tức (chỉ model Nhẹ)<br>`Hữu Quân` — Hữu Quân — Nam · Bắc · Phong cách tin tức (chỉ model Nhẹ)<br>`Xuân Tiên` — Xuân Tiên — Nữ · Bắc · Phong cách tin tức (chỉ model Nhẹ)<br>`Anh Khôi` — Anh Khôi — Nam · Bắc · Phong cách kể chuyện (chỉ model Nhẹ)<br>`Minh Quân` — Minh Quân — Nam · Bắc · Phong cách tự nhiên (chỉ model Nhẹ)<br>`Mạnh Dũng` — Mạnh Dũng — Nam · Bắc · Phong cách tự nhiên (chỉ model Nhẹ) | Giọng đọc có sẵn (⭐ = giọng tuyển chọn) |
| `model` | string | `"turbo"` | `turbo` — Chất lượng cao — 48 kHz, tự nhiên nhất (khuyên dùng)<br>`turbo_fast` — Nhanh — Turbo int8, nhanh ~1,6× (cần CPU có VNNI, không có thì tự dùng bản thường)<br>`nano` — Nhẹ — cho máy yếu / VPS, 24 kHz, đọc tiếng Anh kém hơn | Model đọc |
| `speed` | number | `1.0` | 0.7 – 1.5 | Tốc độ đọc (1 = tự nhiên; 1,2 = nhanh hơn 20%), giữ nguyên cao độ giọng |
| `style` | string | `"subtitle"` | `subtitle` — Phụ đề thường (chữ trắng viền đen)<br>`tiktok` — Phụ đề TikTok (từng từ bật lên, từ đang nói đổi màu)<br>`karaoke` — Karaoke (chữ đổi màu chạy theo lời)<br>`lyric` — Lời bài hát nghệ thuật (chữ to, hiện từng chữ cái)<br>`cinema` — Điện ảnh (chữ có chân, nhẹ nhàng) | Phong cách chữ |
| `caption_chars` | integer | `42` | 0 – 120 | Số ký tự tối đa mỗi dòng phụ đề kèm theo (0 = nguyên câu; video dọc nên 16–24) |
| `position` | string | `"bottom"` | `bottom` — Dưới<br>`middle` — Giữa<br>`top` — Trên | Vị trí chữ trên khung |
| `video_volume` | integer | `20` | 0 – 100 | Âm lượng tiếng gốc của video (%), ví dụ 20 khi thêm giọng thuyết minh |
| `quality` | string | `"standard"` | `draft` — Nháp — nhanh để xem thử<br>`standard` — Chuẩn<br>`high` — Cao — đẹp nhất, chậm hơn | Chất lượng video |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `audio` | `audio` | có | Riêng giọng thuyết minh |
| `composition` | `composition` | có | Bản dựng — chỉnh tiếp bằng compose_edit |
| `subtitle` | `subtitle` | có | Phụ đề .srt khớp giọng |
| `video` | `video` | có | Video có giọng thuyết minh và phụ đề chạy theo giọng |
<!-- AUTO:io:end -->

Các tham số lấy nguyên từ tool gốc (`$from` trong `chain.json`): danh sách giọng, model, kiểu chữ… luôn khớp `speech_synthesize` và `compose_bind`.

## 3. Các bước

<!-- AUTO:steps:start -->
| # | Bước | Tool | Nhận | Tham số cố định |
|---|---|---|---|---|
| 1 | Đọc lời thuyết minh | `speech_synthesize` | `voice_file` ← `$input.voice_file` | `text="$param.text"`, `voice="$param.voice"`, `model="$param.model"`, `speed="$param.speed"`, `caption_chars="$param.caption_chars"` |
| 2 | Ghép giọng và phụ đề vào video | `compose_bind` | `video` ← `$input.video`, `audio` ← `$speak.audio`, `data` ← `$speak.transcript` | `style="$param.style"`, `position="$param.position"`, `video_volume="$param.video_volume"`, `quality="$param.quality"` |
<!-- AUTO:steps:end -->

## 4. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Thuyết minh ngắn cho video mẫu**

```powershell
mediatool-dev run tools/compose/voiceover_captions --example 1
```

```ts
await ws.tools.run("compose_voiceover_captions", { inputs: { /* asset */ }, params: {"text": "Đây là video thử nghiệm. Giọng đọc và phụ đề được tạo hoàn toàn tự động.", "voice": "Thùy Dung", "quality": "draft"} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Thêm giọng thuyết minh nữ miền Bắc và phụ đề cho video này với nội dung sau: …"

## 5. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `media_apply`, `media_probe`, `speech_dub`, `speech_voice_add`, `video_demux`, `video_info`
- **Tool nối được ra sau (nhận output):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_edit`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `lyrics_align`, `media_apply`, `media_probe`, `music_beat_track`, `speech_dub`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`, `video_info`
<!-- AUTO:chain:end -->

## 6. Cách hoạt động

Bước 1 `speech_synthesize` đọc lời, trả audio + thời gian từng câu / dòng. Bước 2 `compose_bind` ghép audio vào video (tiếng gốc còn `video_volume`%) và chèn phụ đề theo đúng thời gian đó. Lời dài hơn video thì phần thừa bị cắt (tool báo cảnh báo) — rút gọn lời hoặc tăng `speed`.

## 7. Lỗi và cảnh báo

| Mã / lỗi | Khi nào | Người dùng nên làm gì |
|---|---|---|
| `CHAIN_STEP_REJECTED` | Một bước không nhận input/tham số (ví dụ văn bản trống) | Đọc thông báo (ghi rõ bước nào, trường nào) |
| `CHAIN_STEP_FAILED` | Một bước chạy lỗi | Chạy riêng `speech_synthesize` / `compose_bind` để khoanh vùng |

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

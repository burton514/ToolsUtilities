# Lồng tiếng tự động

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `compose_auto_dub` |
| **Category** | `compose` |
| **Phiên bản** | 0.3.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 50 MB · GPU: none · heavy: no |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

**Chuỗi đã lưu** (không có code riêng): đưa vào **một video có người nói** (tiếng Việt hoặc Anh), nhận **video đã đổi sang giọng mới** (giọng có sẵn hoặc giọng riêng), giữ nhạc nền, kèm phụ đề theo giọng mới. Lời giữ nguyên — chuỗi **không dịch**. Dùng được như một tool độc lập, và lồng được vào chuỗi khác.

**Dùng khi:**
- Thay giọng thu âm kém bằng giọng đọc rõ ràng; đổi sang giọng riêng đã lưu; làm bản lồng tiếng có phụ đề.

**Không dùng khi:**
- Đã có phụ đề chuẩn → dùng thẳng `speech_dub` (bỏ bước nghe, lời đúng 100%).
- Cần dịch sang tiếng khác (chưa hỗ trợ).

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `video` | `video` | có | Video có người nói cần lồng giọng mới |
| `voice_file` | `voice` | không | Giọng riêng đã lưu (tùy chọn) |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `language` | string | `"vi"` | `vi` — Tiếng Việt<br>`en` — Tiếng Anh<br>`zh` — Tiếng Trung<br>`ja` — Tiếng Nhật<br>`ko` — Tiếng Hàn<br>`th` — Tiếng Thái<br>`fr` — Tiếng Pháp<br>`de` — Tiếng Đức<br>`es` — Tiếng Tây Ban Nha | Ngôn ngữ đang nói — chọn đúng để dùng model hợp với ngôn ngữ đó |
| `listen_model` | string | `"small"` | `base` — Nhanh (tiếng Việt 240 MB · ngôn ngữ khác 145 MB)<br>`small` — Chính xác hơn, chậm hơn (tiếng Việt 1,5 GB · ngôn ngữ khác 465 MB) | Model nghe lời gốc (small đúng hơn với giọng địa phương, tạp âm) |
| `voice` | string | `"Hải Đăng"` | `Adam bựa` — ⭐ Adam bựa — Nam · Bắc · Phong cách tự nhiên<br>`Trúc Ly` — ⭐ Trúc Ly — Nữ · Bắc · Phong cách tự nhiên<br>`Thiện Minh` — ⭐ Thiện Minh — Nam · Bắc · Phong cách kể chuyện<br>`Mai Anh` — ⭐ Mai Anh — Nữ · Bắc · Phong cách tin tức<br>`Hải Đăng` — ⭐ Hải Đăng — Nam · Bắc · Phong cách tự nhiên<br>`Thùy Dung` — ⭐ Thùy Dung — Nữ · Nam · Phong cách tin tức<br>`Thiền Tâm Đức` — ⭐ Thiền Tâm Đức — Nam · Bắc · Phong cách kể chuyện<br>`Ngọc Huyền` — ⭐ Ngọc Huyền — Nữ · Bắc · Giọng đọc tự nhiên<br>`Quang Sơn` — ⭐ Quang Sơn — Nam · Trung · Phong cách tự nhiên<br>`Ngọc Trân` — ⭐ Ngọc Trân — Nữ · Trung · Phong cách tự nhiên<br>`Minh Đức` — Minh Đức — Nam · Bắc · Phong cách tin tức<br>`Phạm Tuyên` — Phạm Tuyên — Nam · Bắc · Phong cách tự nhiên<br>`Thái Sơn` — Thái Sơn — Nam · Nam · Phong cách kể chuyện<br>`Xuân Vĩnh` — Xuân Vĩnh — Nam · Bắc · Phong cách tự nhiên<br>`Thanh Bình` — Thanh Bình — Nam · Bắc · Phong cách kể chuyện<br>`Ngọc Linh` — Ngọc Linh — Nữ · Bắc · Phong cách kể chuyện<br>`Đoan Trang` — Đoan Trang — Nữ · Bắc · Phong cách tự nhiên<br>`Thục Đoan` — Thục Đoan — Nữ · Nam · Phong cách kể chuyện<br>`Minh Triết` — Minh Triết — Nam · Nam · Phong cách tin tức<br>`Mỹ Duyên` — Mỹ Duyên — Nữ · Nam · Phong cách đọc truyện<br>`Quỳnh Anh` — Quỳnh Anh — Nữ · Bắc · Phong cách đọc truyện<br>`Đức Trí` — Đức Trí — Nam · Nam · Phong cách đọc truyện<br>`Kim Thanh` — Kim Thanh — Nữ · Nam · Phong cách đọc truyện<br>`Adam` — Adam — Nam · Nam · Giọng đọc tự nhiên<br>`Quốc Tuấn` — Quốc Tuấn — Nam · Bắc · Phong cách tự nhiên<br>`Ái Hân` — Ái Hân — Nữ · Nam · Phong cách tin tức (chỉ model Nhẹ)<br>`Hữu Quân` — Hữu Quân — Nam · Bắc · Phong cách tin tức (chỉ model Nhẹ)<br>`Xuân Tiên` — Xuân Tiên — Nữ · Bắc · Phong cách tin tức (chỉ model Nhẹ)<br>`Anh Khôi` — Anh Khôi — Nam · Bắc · Phong cách kể chuyện (chỉ model Nhẹ)<br>`Minh Quân` — Minh Quân — Nam · Bắc · Phong cách tự nhiên (chỉ model Nhẹ)<br>`Mạnh Dũng` — Mạnh Dũng — Nam · Bắc · Phong cách tự nhiên (chỉ model Nhẹ) | Giọng đọc có sẵn (⭐ = giọng tuyển chọn) |
| `model` | string | `"turbo"` | `turbo` — Chất lượng cao — 48 kHz, tự nhiên nhất (khuyên dùng)<br>`turbo_fast` — Nhanh — Turbo int8, nhanh ~1,6× (cần CPU có VNNI, không có thì tự dùng bản thường)<br>`nano` — Nhẹ — cho máy yếu / VPS, 24 kHz, đọc tiếng Anh kém hơn | Model đọc |
| `fit` | string | `"speed"` | `speed` — Đọc nhanh lên cho vừa (khuyên dùng)<br>`natural` — Giữ tốc độ, lùi câu sau | Câu đọc dài hơn khung thời gian thì |
| `original_volume` | integer | `20` | 0 – 100 | Giữ lại bao nhiêu % tiếng gốc của video (nhạc nền, tiếng động); 0 = bỏ hẳn |
| `style` | string | `"subtitle"` | `subtitle` — Phụ đề thường (chữ trắng viền đen)<br>`tiktok` — Phụ đề TikTok (từng từ bật lên, từ đang nói đổi màu)<br>`karaoke` — Karaoke (chữ đổi màu chạy theo lời)<br>`lyric` — Lời bài hát nghệ thuật (chữ to, hiện từng chữ cái)<br>`cinema` — Điện ảnh (chữ có chân, nhẹ nhàng) | Phong cách chữ |
| `position` | string | `"bottom"` | `bottom` — Dưới<br>`middle` — Giữa<br>`top` — Trên | Vị trí chữ trên khung |
| `quality` | string | `"standard"` | `draft` — Nháp — nhanh để xem thử<br>`standard` — Chuẩn<br>`high` — Cao — đẹp nhất, chậm hơn | Chất lượng video |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `composition` | `composition` | có | Bản dựng phần phụ đề — chỉnh tiếp bằng compose_edit |
| `subtitle` | `subtitle` | có | Phụ đề .srt theo giọng mới — sửa lời rồi chạy lại speech_dub nếu cần |
| `video` | `video` | có | Video đã lồng giọng mới, có phụ đề |
| `video_dub` | `video` | có | Video đã lồng giọng mới, không phụ đề |
<!-- AUTO:io:end -->

## 3. Các bước

<!-- AUTO:steps:start -->
| # | Bước | Tool | Nhận | Tham số cố định |
|---|---|---|---|---|
| 1 | Nghe và chép lời gốc | `speech_transcribe` | `media` ← `$input.video` | `language="$param.language"`, `model="$param.listen_model"` |
| 2 | Lồng giọng mới | `speech_dub` | `video` ← `$input.video`, `data` ← `$listen.transcript`, `voice_file` ← `$input.voice_file` | `voice="$param.voice"`, `model="$param.model"`, `fit="$param.fit"`, `original_volume="$param.original_volume"` |
| 3 | Chèn phụ đề khớp giọng mới | `compose_bind` | `video` ← `$dub.video`, `data` ← `$dub.transcript` | `style="$param.style"`, `position="$param.position"`, `quality="$param.quality"` |
<!-- AUTO:steps:end -->

## 4. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Đổi giọng video nói tiếng Anh mẫu (giọng VieNeu đọc được tiếng Anh)**

```powershell
mediatool-dev run tools/compose/auto_dub --example 1
```

```ts
await ws.tools.run("compose_auto_dub", { inputs: { /* asset */ }, params: {"language": "en", "listen_model": "base", "voice": "Ngọc Huyền", "quality": "draft"} });
```

**Ví dụ 2: Đổi giọng video nói tiếng Việt**

```powershell
mediatool-dev run tools/compose/auto_dub --example 2
```

```ts
await ws.tools.run("compose_auto_dub", { inputs: { /* asset */ }, params: {"language": "vi", "listen_model": "base", "voice": "Thùy Dung", "quality": "draft"} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Đổi giọng video này sang giọng đã lưu 'Giọng của Lan', giữ nhạc nền nhỏ, có phụ đề."

## 5. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `compose_auto_captions`, `compose_bind`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `media_apply`, `media_probe`, `speech_dub`, `speech_voice_add`, `video_demux`, `video_info`
- **Tool nối được ra sau (nhận output):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_bind`, `compose_edit`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `lyrics_align`, `media_apply`, `media_probe`, `music_beat_track`, `speech_dub`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`, `video_info`
<!-- AUTO:chain:end -->

## 6. Cách hoạt động

1. `speech_transcribe` nghe lời gốc kèm thời gian từng câu (tiếng Việt: PhoWhisper; mặc định mức `small` = PhoWhisper-medium cho chính xác).
2. `speech_dub` đọc lại từng câu bằng giọng mới (VieNeu Turbo đọc cả tiếng Việt lẫn tiếng Anh) đúng mốc (câu dài tự đọc nhanh lên tối đa 1,3×), trộn vào video với tiếng gốc nhỏ lại và tự nhường giọng.
3. `compose_bind` chèn phụ đề theo mốc thật của giọng mới.

Nghe sai chữ ở bước 1 thì giọng mới đọc theo chữ sai: sửa file `subtitle` (.srt) rồi chạy lại `speech_dub` với file đã sửa.

## 7. Lỗi và cảnh báo

| Mã / lỗi | Khi nào | Người dùng nên làm gì |
|---|---|---|
| `CHAIN_STEP_REJECTED` | Một bước không nhận input/tham số | Đọc thông báo (ghi rõ bước nào, trường nào) |
| `CHAIN_STEP_FAILED` | Một bước chạy lỗi (video không có tiếng, không tải được model…) | Chạy riêng từng tool để khoanh vùng |

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

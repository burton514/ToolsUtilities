# Lồng tiếng theo phụ đề

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `speech_dub` |
| **Nguồn** | [pnnbao97/VieNeu-TTS](https://github.com/pnnbao97/VieNeu-TTS) |
| **Category** | `speech` |
| **Phiên bản** | 0.1.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 2500 MB · GPU: none · heavy: yes |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Đưa vào **phụ đề có thời gian** (và tùy chọn **video**), chọn giọng — nhận lại **giọng lồng tiếng đặt đúng mốc từng câu**, phụ đề theo mốc thật, và **video đã lồng tiếng** (giữ nhạc nền, tiếng gốc tự nhỏ đi khi có lời).

**Dùng khi:**
- Thuyết minh / lồng tiếng video từ file phụ đề tiếng Việt có sẵn.
- Thay giọng nói trong video (nối sau `speech_transcribe`) — xem chuỗi `compose_auto_dub`.

**Không dùng khi:**
- Chỉ có văn bản, không có mốc thời gian → dùng `speech_synthesize`.
- Phụ đề là tiếng nước ngoài: tool không dịch — cần phụ đề tiếng Việt.

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `subtitle` | `subtitle` | không | Phụ đề có thời gian (.srt / .vtt) — lời cần đọc |
| `data` | `json` | không | Hoặc dữ liệu thời gian JSON (kết quả phiên âm…) thay cho file phụ đề |
| `video` | `video` | không | Video cần lồng tiếng (tùy chọn) — có thì trả thêm video đã lồng |
| `voice_file` | `voice` | không | Giọng riêng đã lưu (tạo bằng tool 'Lưu giọng đọc') |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `voice` | string | `"Hải Đăng"` | `Adam bựa` — ⭐ Adam bựa — Nam · Bắc · Phong cách tự nhiên<br>`Trúc Ly` — ⭐ Trúc Ly — Nữ · Bắc · Phong cách tự nhiên<br>`Thiện Minh` — ⭐ Thiện Minh — Nam · Bắc · Phong cách kể chuyện<br>`Mai Anh` — ⭐ Mai Anh — Nữ · Bắc · Phong cách tin tức<br>`Hải Đăng` — ⭐ Hải Đăng — Nam · Bắc · Phong cách tự nhiên<br>`Thùy Dung` — ⭐ Thùy Dung — Nữ · Nam · Phong cách tin tức<br>`Thiền Tâm Đức` — ⭐ Thiền Tâm Đức — Nam · Bắc · Phong cách kể chuyện<br>`Ngọc Huyền` — ⭐ Ngọc Huyền — Nữ · Bắc · Giọng đọc tự nhiên<br>`Quang Sơn` — ⭐ Quang Sơn — Nam · Trung · Phong cách tự nhiên<br>`Ngọc Trân` — ⭐ Ngọc Trân — Nữ · Trung · Phong cách tự nhiên<br>`Minh Đức` — Minh Đức — Nam · Bắc · Phong cách tin tức<br>`Phạm Tuyên` — Phạm Tuyên — Nam · Bắc · Phong cách tự nhiên<br>`Thái Sơn` — Thái Sơn — Nam · Nam · Phong cách kể chuyện<br>`Xuân Vĩnh` — Xuân Vĩnh — Nam · Bắc · Phong cách tự nhiên<br>`Thanh Bình` — Thanh Bình — Nam · Bắc · Phong cách kể chuyện<br>`Ngọc Linh` — Ngọc Linh — Nữ · Bắc · Phong cách kể chuyện<br>`Đoan Trang` — Đoan Trang — Nữ · Bắc · Phong cách tự nhiên<br>`Thục Đoan` — Thục Đoan — Nữ · Nam · Phong cách kể chuyện<br>`Minh Triết` — Minh Triết — Nam · Nam · Phong cách tin tức<br>`Mỹ Duyên` — Mỹ Duyên — Nữ · Nam · Phong cách đọc truyện<br>`Quỳnh Anh` — Quỳnh Anh — Nữ · Bắc · Phong cách đọc truyện<br>`Đức Trí` — Đức Trí — Nam · Nam · Phong cách đọc truyện<br>`Kim Thanh` — Kim Thanh — Nữ · Nam · Phong cách đọc truyện<br>`Adam` — Adam — Nam · Nam · Giọng đọc tự nhiên<br>`Quốc Tuấn` — Quốc Tuấn — Nam · Bắc · Phong cách tự nhiên<br>`Ái Hân` — Ái Hân — Nữ · Nam · Phong cách tin tức (chỉ model Nhẹ)<br>`Hữu Quân` — Hữu Quân — Nam · Bắc · Phong cách tin tức (chỉ model Nhẹ)<br>`Xuân Tiên` — Xuân Tiên — Nữ · Bắc · Phong cách tin tức (chỉ model Nhẹ)<br>`Anh Khôi` — Anh Khôi — Nam · Bắc · Phong cách kể chuyện (chỉ model Nhẹ)<br>`Minh Quân` — Minh Quân — Nam · Bắc · Phong cách tự nhiên (chỉ model Nhẹ)<br>`Mạnh Dũng` — Mạnh Dũng — Nam · Bắc · Phong cách tự nhiên (chỉ model Nhẹ) | Giọng đọc có sẵn (⭐ = giọng tuyển chọn) |
| `model` | string | `"turbo"` | `turbo` — Chất lượng cao — 48 kHz, tự nhiên nhất (khuyên dùng)<br>`turbo_fast` — Nhanh — Turbo int8, nhanh ~1,6× (cần CPU có VNNI, không có thì tự dùng bản thường)<br>`nano` — Nhẹ — cho máy yếu / VPS, 24 kHz, đọc tiếng Anh kém hơn | Model đọc |
| `fit` | string | `"speed"` | `speed` — Đọc nhanh lên cho vừa (khuyên dùng)<br>`natural` — Giữ tốc độ, lùi câu sau | Câu đọc dài hơn khung thời gian thì |
| `max_speed` | number | `1.3` | 1.0 – 1.6 | Tăng tốc tối đa khi cần cho vừa khung (1,3 = nhanh hơn 30%, vẫn tự nhiên) |
| `speed` | number | `1.0` | 0.8 – 1.3 | Tốc độ đọc chung cho mọi câu |
| `original_volume` | integer | `20` | 0 – 100 | Giữ lại bao nhiêu % tiếng gốc của video (nhạc nền, tiếng động); 0 = bỏ hẳn |
| `duck` | boolean | `true` |  | Tiếng gốc tự nhỏ xuống khi giọng mới nói, lớn lại khi nghỉ |
| `expressiveness` | number | `0.8` | 0.3 – 1.1 | Độ biểu cảm (model Turbo); 0,8 ổn định nhất |
| `seed` | integer | `0` | 0 – 1000000 | Số cố định để đọc lại y hệt; 0 = mỗi lần một khác |
| `loudness` | string | `"speech"` | `speech` — Mạng xã hội / podcast (−16 LUFS)<br>`broadcast` — Truyền hình (−23 LUFS)<br>`none` — Giữ nguyên | Chuẩn hóa độ to giọng lồng |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `audio` | `audio` | có | Giọng lồng tiếng (đúng mốc thời gian, im lặng giữa các câu) |
| `subtitle` | `subtitle` | có | Phụ đề theo mốc thời gian thật sau khi khớp |
| `transcript` | `transcript` | có | Thời gian từng câu / từ (JSON) — cho compose_bind chèn chữ khớp giọng mới |
| `video` | `video` | không | Video đã lồng tiếng (khi có video đầu vào) |
<!-- AUTO:io:end -->

**Giải thích thêm về tham số:**
- `fit = speed` (mặc định): câu đọc dài hơn khung thì đọc nhanh lên vừa khung, tối đa `max_speed` (1,3 = nhanh hơn 30%, tai người vẫn nghe tự nhiên); vẫn chưa vừa thì câu sau lùi lại. `fit = natural`: không đổi tốc độ, chỉ lùi câu sau.
- `original_volume`: phần trăm tiếng gốc giữ lại (nhạc nền, tiếng động). Muốn thay hẳn tiếng → 0.
- `duck`: tiếng gốc tự nhỏ thêm khi giọng mới cất lên (nén theo tín hiệu giọng, nhả 400 ms) rồi trở lại giữa các câu.

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Lồng tiếng video theo phụ đề tiếng Việt**

```powershell
mediatool-dev run tools/speech/dub --example 1
```

```ts
await ws.tools.run("speech_dub", { inputs: { /* asset */ }, params: {"voice": "Ngọc Huyền", "seed": 5} });
```

**Ví dụ 2: Chỉ xuất giọng lồng (không video), giữ tốc độ tự nhiên**

```powershell
mediatool-dev run tools/speech/dub --example 2
```

```ts
await ws.tools.run("speech_dub", { inputs: { /* asset */ }, params: {"voice": "Quang Sơn", "fit": "natural", "seed": 5} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Lồng tiếng video này theo file phụ đề tiếng Việt, giọng nam miền Nam, giữ nhạc nền nhỏ."

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_edit`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `lyrics_align`, `media_apply`, `media_probe`, `music_beat_track`, `speech_synthesize`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`, `video_info`
- **Tool nối được ra sau (nhận output):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_edit`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `lyrics_align`, `media_apply`, `media_probe`, `music_beat_track`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`, `video_info`
<!-- AUTO:chain:end -->

**Lưu ý khi tích hợp:**
- Input `data` nhận TimedData (ví dụ `transcript` của `speech_transcribe`), input `subtitle` nhận .srt/.vtt — đưa một trong hai.
- Output `transcript` là mốc THẬT sau khi khớp → đưa vào `compose_bind` để phụ đề khớp giọng mới.

## 5. Cách hoạt động

**Khung thời gian** của câu i = từ lúc câu i bắt đầu đến lúc câu i+1 bắt đầu (trừ 0,08 s hở) — dùng cả khoảng lặng giữa hai câu chứ không chỉ độ dài phụ đề.

1. Đọc từng câu (VieNeu), cắt im lặng thừa hai đầu.
2. Câu dài hơn khung: hệ số = min(`max_speed`, độ dài / khung). Turbo: kéo giãn thời gian bằng Rubber Band (giữ cao độ, giữ formant). Nano: đọc lại ở tốc độ mới (tự nhiên hơn kéo giãn).
3. Đặt câu: mốc = max(mốc phụ đề, hết câu trước + 0,08 s) — không bao giờ hai câu đè lên nhau.
4. Ghép thành track, chuẩn hóa độ to EBU R128 hai lượt.
5. Có video: tiếng gốc × `original_volume`, nén sidechain theo giọng (ngưỡng 0,02, tỉ lệ 8:1, attack 15 ms, release 400 ms), trộn với giọng mới, giới hạn đỉnh; hình **giữ nguyên, không mã hóa lại**.

## 6. Hiệu năng và tài nguyên

<!-- AUTO:bench:start -->
_Chưa có số đo. Chạy trong sandbox để đo RAM đỉnh và thời gian._
<!-- AUTO:bench:end -->

## 7. Model và license

<!-- AUTO:models:start -->
| Model | Kích thước | License | Nguồn |
|---|---|---|---|
| `vieneu_v3_turbo` | 607 MB | Apache-2.0 | https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo |
| `vieneu_v3_turbo_int8` | 158 MB | Apache-2.0 | https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo |
| `vieneu_v3_nano` | 400 MB | Apache-2.0 | https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Nano |
<!-- AUTO:models:end -->

## 8. Tiếng Việt

Phụ đề tiếng Việt có dấu; số, ngày tháng, đơn vị được đọc đúng tự động.

## 9. Lỗi và cảnh báo

| Mã | Loại | Khi nào xảy ra | Cách xử lý cho người dùng |
|---|---|---|---|
| `INVALID_INPUT` | InputError | Không có / có cả hai nguồn lời; phụ đề rỗng | Đưa đúng một file phụ đề hoặc dữ liệu JSON |
| `MODEL_UNAVAILABLE` | ToolError | Không tải được model | Kiểm tra mạng rồi chạy lại |
| `MUX_FAILED` | ToolError | Không trộn được tiếng vào video | Thử video khác / kiểm tra file video |
| _(cảnh báo)_ | warning | Giọng lồng dài hơn video | Rút gọn lời hoặc tăng `max_speed` |

## 10. Giới hạn đã biết

- Phụ đề quá dày chữ so với thời gian (đọc nhanh hơn 1,3 lần vẫn không kịp) sẽ làm các câu sau lùi dần — tóm gọn lời cho vừa.
- Không khớp khẩu hình (lip-sync).

## 11. Hỏi đáp và xử lý sự cố

**Câu bị đọc quá nhanh?** Giảm `max_speed` hoặc chọn `fit = natural`.
**Nhạc nền át giọng?** Giảm `original_volume` (10–15) và để `duck` bật.

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

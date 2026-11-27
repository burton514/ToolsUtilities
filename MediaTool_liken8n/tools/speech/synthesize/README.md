# Đọc văn bản thành giọng nói

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `speech_synthesize` |
| **Nguồn** | [pnnbao97/VieNeu-TTS](https://github.com/pnnbao97/VieNeu-TTS) |
| **Category** | `speech` |
| **Phiên bản** | 0.1.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 2500 MB · GPU: none · heavy: yes |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Nhập **văn bản tiếng Việt** (trộn tiếng Anh được), chọn giọng, nhận lại **file giọng đọc tự nhiên** kèm **phụ đề khớp từng câu**. Có 25 giọng ba miền dựng sẵn, hoặc dùng giọng riêng đã lưu. Chạy ngay trên máy, không gửi văn bản đi đâu.

**Dùng khi:**
- Cần giọng thuyết minh / đọc tin / đọc truyện / lời giới thiệu cho video.
- Làm bước đầu của chuỗi "chữ → video có giọng và phụ đề" (`compose_voiceover_captions`).

**Không dùng khi:**
- Đã có phụ đề có thời gian và cần đọc đúng mốc → dùng `speech_dub`.
- Muốn đọc bằng giọng của mình → tạo hồ sơ giọng bằng `speech_voice_add` trước rồi đưa vào ô `voice_file`.

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `script` | `text` | không | Văn bản cần đọc dạng file .txt (từ bước trước hoặc tải lên); có thì dùng thay ô văn bản |
| `voice_file` | `voice` | không | Giọng riêng đã lưu (tạo bằng tool 'Lưu giọng đọc'); có thì dùng thay giọng có sẵn |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `text` | string | `""` |  | Văn bản cần đọc. Xuống dòng = sang đoạn mới (nghỉ lâu hơn). Chèn [cười], [thở dài], [hắng giọng] để thêm biểu cảm |
| `voice` | string | `"Hải Đăng"` | `Adam bựa` — ⭐ Adam bựa — Nam · Bắc · Phong cách tự nhiên<br>`Trúc Ly` — ⭐ Trúc Ly — Nữ · Bắc · Phong cách tự nhiên<br>`Thiện Minh` — ⭐ Thiện Minh — Nam · Bắc · Phong cách kể chuyện<br>`Mai Anh` — ⭐ Mai Anh — Nữ · Bắc · Phong cách tin tức<br>`Hải Đăng` — ⭐ Hải Đăng — Nam · Bắc · Phong cách tự nhiên<br>`Thùy Dung` — ⭐ Thùy Dung — Nữ · Nam · Phong cách tin tức<br>`Thiền Tâm Đức` — ⭐ Thiền Tâm Đức — Nam · Bắc · Phong cách kể chuyện<br>`Ngọc Huyền` — ⭐ Ngọc Huyền — Nữ · Bắc · Giọng đọc tự nhiên<br>`Quang Sơn` — ⭐ Quang Sơn — Nam · Trung · Phong cách tự nhiên<br>`Ngọc Trân` — ⭐ Ngọc Trân — Nữ · Trung · Phong cách tự nhiên<br>`Minh Đức` — Minh Đức — Nam · Bắc · Phong cách tin tức<br>`Phạm Tuyên` — Phạm Tuyên — Nam · Bắc · Phong cách tự nhiên<br>`Thái Sơn` — Thái Sơn — Nam · Nam · Phong cách kể chuyện<br>`Xuân Vĩnh` — Xuân Vĩnh — Nam · Bắc · Phong cách tự nhiên<br>`Thanh Bình` — Thanh Bình — Nam · Bắc · Phong cách kể chuyện<br>`Ngọc Linh` — Ngọc Linh — Nữ · Bắc · Phong cách kể chuyện<br>`Đoan Trang` — Đoan Trang — Nữ · Bắc · Phong cách tự nhiên<br>`Thục Đoan` — Thục Đoan — Nữ · Nam · Phong cách kể chuyện<br>`Minh Triết` — Minh Triết — Nam · Nam · Phong cách tin tức<br>`Mỹ Duyên` — Mỹ Duyên — Nữ · Nam · Phong cách đọc truyện<br>`Quỳnh Anh` — Quỳnh Anh — Nữ · Bắc · Phong cách đọc truyện<br>`Đức Trí` — Đức Trí — Nam · Nam · Phong cách đọc truyện<br>`Kim Thanh` — Kim Thanh — Nữ · Nam · Phong cách đọc truyện<br>`Adam` — Adam — Nam · Nam · Giọng đọc tự nhiên<br>`Quốc Tuấn` — Quốc Tuấn — Nam · Bắc · Phong cách tự nhiên<br>`Ái Hân` — Ái Hân — Nữ · Nam · Phong cách tin tức (chỉ model Nhẹ)<br>`Hữu Quân` — Hữu Quân — Nam · Bắc · Phong cách tin tức (chỉ model Nhẹ)<br>`Xuân Tiên` — Xuân Tiên — Nữ · Bắc · Phong cách tin tức (chỉ model Nhẹ)<br>`Anh Khôi` — Anh Khôi — Nam · Bắc · Phong cách kể chuyện (chỉ model Nhẹ)<br>`Minh Quân` — Minh Quân — Nam · Bắc · Phong cách tự nhiên (chỉ model Nhẹ)<br>`Mạnh Dũng` — Mạnh Dũng — Nam · Bắc · Phong cách tự nhiên (chỉ model Nhẹ) | Giọng đọc có sẵn (⭐ = giọng tuyển chọn) |
| `model` | string | `"turbo"` | `turbo` — Chất lượng cao — 48 kHz, tự nhiên nhất (khuyên dùng)<br>`turbo_fast` — Nhanh — Turbo int8, nhanh ~1,6× (cần CPU có VNNI, không có thì tự dùng bản thường)<br>`nano` — Nhẹ — cho máy yếu / VPS, 24 kHz, đọc tiếng Anh kém hơn | Model đọc |
| `speed` | number | `1.0` | 0.7 – 1.5 | Tốc độ đọc (1 = tự nhiên; 1,2 = nhanh hơn 20%), giữ nguyên cao độ giọng |
| `pause` | number | `1.0` | 0.5 – 2.0 | Độ dài khoảng nghỉ giữa các câu (1 = tự nhiên) |
| `expressiveness` | number | `0.8` | 0.3 – 1.1 | Độ biểu cảm (model Turbo): thấp = đều đều, ổn định; cao = nhiều cảm xúc hơn. 0,8 ổn định nhất |
| `seed` | integer | `0` | 0 – 1000000 | Số cố định để đọc lại y hệt lần trước; 0 = mỗi lần một khác |
| `caption_chars` | integer | `42` | 0 – 120 | Số ký tự tối đa mỗi dòng phụ đề kèm theo (0 = nguyên câu; video dọc nên 16–24) |
| `loudness` | string | `"speech"` | `speech` — Mạng xã hội / podcast (−16 LUFS)<br>`broadcast` — Truyền hình (−23 LUFS)<br>`none` — Giữ nguyên | Chuẩn hóa độ to |
| `format` | string | `"wav"` | `wav` — WAV — chất lượng gốc<br>`mp3` — MP3 — nhẹ để gửi | Định dạng audio |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `audio` | `audio` | có | Giọng đọc (mono 48 kHz) |
| `subtitle` | `subtitle` | có | Phụ đề .srt khớp với giọng đọc |
| `transcript` | `transcript` | có | Thời gian từng câu / dòng / từ (JSON) — cho compose_bind chèn chữ chạy theo giọng |
<!-- AUTO:io:end -->

**Giải thích thêm về tham số:**
- `text`: số, ngày tháng, phần trăm, đơn vị, viết tắt được đọc đúng tự động ("26/11/2026" → "ngày hai mươi sáu tháng mười một…"). Xuống dòng = sang đoạn (nghỉ 0,7 giây). Thẻ `[cười]`, `[thở dài]`, `[hắng giọng]` được đọc ra nhưng không hiện trong phụ đề.
- `model`: `turbo` hay nhất (48 kHz). `turbo_fast` nhanh hơn ~1,6 lần nhưng chỉ đúng trên CPU có lệnh VNNI — máy không có thì tool tự dùng `turbo`. `nano` nhẹ nhất cho máy yếu / VPS, tiếng Anh kém hơn, có 11 giọng riêng (chọn giọng Turbo không có ở Nano thì tool báo danh sách giọng của Nano).
- `speed`: Turbo đổi tốc độ sau khi đọc bằng Rubber Band (giữ nguyên cao độ và âm sắc); Nano đọc thẳng ở tốc độ đó.
- `expressiveness`: nhiệt độ lấy mẫu của model; 0,8 là mức ổn định nhất theo tác giả VieNeu.
- `seed`: giữ cố định để đọc lại y hệt (hữu ích khi chỉ sửa tham số khác).
- `caption_chars`: chỉ ảnh hưởng phụ đề / TimedData đầu ra, không ảnh hưởng giọng đọc.

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Đọc bản tin ngắn bằng giọng có sẵn**

```powershell
mediatool-dev run tools/speech/synthesize --example 1
```

```ts
await ws.tools.run("speech_synthesize", { inputs: { /* asset */ }, params: {"text": "Xin chào các bạn! Hôm nay là ngày 26/11/2026.\nGiá vàng tăng 2,5%, còn chứng khoán đi ngang.", "voice": "Mai Anh"} });
```

**Ví dụ 2: Đọc nhanh hơn 15%, dòng phụ đề ngắn cho video dọc**

```powershell
mediatool-dev run tools/speech/synthesize --example 2
```

```ts
await ws.tools.run("speech_synthesize", { inputs: { /* asset */ }, params: {"text": "Ba mẹo nhỏ giúp bạn quay video đẹp hơn. Thứ nhất, quay ngược sáng thật cẩn thận [cười].", "voice": "Hải Đăng", "speed": 1.15, "caption_chars": 18, "seed": 7} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Đọc đoạn giới thiệu sản phẩm này bằng giọng nữ miền Nam, hơi nhanh một chút."

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `media_probe`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`, `video_info`
- **Tool nối được ra sau (nhận output):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_bind`, `compose_edit`, `compose_film_subtitles`, `compose_karaoke`, `compose_render`, `compose_template`, `lyrics_align`, `media_probe`, `music_beat_track`, `speech_dub`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`
<!-- AUTO:chain:end -->

**Lưu ý khi tích hợp:**
- `transcript` là TimedData (dòng → từ, thời gian từng từ ước lượng theo độ dài chữ) — `compose_bind` (input `data`) chèn chữ chạy theo giọng; `audio` đưa vào input `audio` của `compose_bind` để ghép giọng vào video.
- Chuỗi dựng sẵn: `compose_voiceover_captions`.

## 5. Cách hoạt động

1. Chia văn bản thành câu bằng bộ tách câu của VieNeu (hiểu ngoặc kép, viết tắt), mỗi dòng là một đoạn.
2. Mỗi câu đọc riêng bằng VieNeu-TTS v3 (VieNeu tự chuẩn hóa văn bản và phiên âm bằng sea-g2p, câu quá dài tự chia nhỏ).
3. Ghép câu với khoảng nghỉ theo loại ranh giới — hết đoạn 0,7 s, hết câu 0,5 s, dấu phẩy 0,3 s (× `pause`) — có tính phần im lặng sẵn ở đuôi / đầu câu nên nhịp đọc đều.
4. Đổi tốc độ (nếu cần), chuẩn hóa độ to EBU R128 **hai lượt** (đo rồi chỉnh tuyến tính, đỉnh ≤ −1,5 dBTP, không nén động), xuất mono 48 kHz.
5. Vị trí từng câu trong audio là chính xác (đo phần có tiếng của từng câu) → phụ đề / TimedData.

Model tải **lần đầu** theo danh mục dùng chung `tools/_models/vieneu.toml` (core kiểm sha256 từng file), chạy ONNX Runtime trên CPU, không cần GPU / PyTorch.

## 6. Hiệu năng và tài nguyên

<!-- AUTO:bench:start -->
_Chưa có số đo. Chạy trong sandbox để đo RAM đỉnh và thời gian._
<!-- AUTO:bench:end -->

Nạp model khoảng 15–20 giây mỗi lần chạy. Tốc độ đọc trên CPU 6–12 nhân: Turbo khoảng 0,6–2 lần thời gian thực (tùy CPU), `turbo_fast` nhanh hơn ~1,6 lần, Nano nhanh hơn ~3 lần.

## 7. Model và license

<!-- AUTO:models:start -->
| Model | Kích thước | License | Nguồn |
|---|---|---|---|
| `vieneu_v3_turbo` | 607 MB | Apache-2.0 | https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo |
| `vieneu_v3_turbo_int8` | 158 MB | Apache-2.0 | https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo |
| `vieneu_v3_nano` | 400 MB | Apache-2.0 | https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Nano |
<!-- AUTO:models:end -->

VieNeu-TTS © Phạm Nguyễn Ngọc Bảo (Apache-2.0); codec MOSS-Audio-Tokenizer-Nano © OpenMOSS (Apache-2.0); phiên âm sea-g2p (Apache-2.0).

## 8. Tiếng Việt

Model huấn luyện trên hơn 10.000 giờ dữ liệu tiếng Việt + Anh; giọng ba miền Bắc / Trung / Nam. Từ tiếng Anh trong câu đọc theo kiểu tiếng Anh (Turbo); có thể bọc `<en>…</en>` để chắc chắn.

## 9. Lỗi và cảnh báo

| Mã | Loại | Khi nào xảy ra | Cách xử lý cho người dùng |
|---|---|---|---|
| `INVALID_INPUT` | InputError | Văn bản trống, giọng không có ở model đã chọn, hồ sơ giọng sai | Nhập văn bản / chọn giọng khác |
| `MODEL_UNAVAILABLE` | ToolError | Không tải được model (mất mạng, sai mã băm) | Kiểm tra mạng rồi chạy lại; model chỉ tải một lần |
| `MISSING_PACKAGE` | ToolError | Máy chạy chưa cài vieneu | Dùng image core mới |
| _(cảnh báo)_ | warning | CPU không có VNNI khi chọn `turbo_fast` | Tool tự dùng `turbo` |

## 10. Giới hạn đã biết

- Thời gian từng TỪ trong phụ đề là ước lượng theo độ dài chữ (thời gian từng CÂU là chính xác).
- Thẻ cảm xúc còn thử nghiệm, không phải lần nào cũng rõ.
- Văn bản rất dài (hàng chục nghìn ký tự) chạy lâu trên CPU — chia thành nhiều lần.

## 11. Hỏi đáp và xử lý sự cố

**Đọc sai một từ?** Viết lại theo cách đọc (ví dụ "AI" → "ây ai") hoặc bọc từ tiếng Anh bằng `<en>…</en>`.
**Giọng hơi đều đều?** Tăng `expressiveness` lên 0,9–1,0; chọn giọng phong cách "kể chuyện".

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

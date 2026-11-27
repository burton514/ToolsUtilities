# Chuyển giọng nói thành chữ

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `speech_transcribe` |
| **Nguồn** | [vinai/PhoWhisper](https://github.com/VinAIResearch/PhoWhisper) · [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) |
| **Category** | `speech` |
| **Phiên bản** | 0.3.1 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 2500 MB · GPU: optional · heavy: yes |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Đưa vào **một video hoặc audio có người nói**, nhận lại **phụ đề .srt**, **lời chép thuần .txt** và **lời kèm thời gian từng từ** (JSON). **Tiếng Việt** dùng PhoWhisper của VinAI (Whisper tinh chỉnh riêng cho tiếng Việt); tiếng Anh và ngoại ngữ khác dùng Whisper. Chạy ngay trên máy — không gửi file đi đâu.

**Dùng khi:**
- Cần phụ đề cho video nói chuyện, vlog, bài giảng, podcast.
- Làm bước đầu của chuỗi tự động: phiên âm → chèn phụ đề kiểu TikTok / karaoke (`compose_bind`).

**Không dùng khi:**
- Đã có phụ đề / lời sẵn → đưa thẳng vào `compose_bind`.
- Cần căn lời bài hát có sẵn vào nhạc (giọng hát lẫn nhạc) → dùng tool căn lời (sắp có); Whisper nghe giọng hát kém hơn giọng nói.

### Chọn tool chép lời nào?

| | `speech_zipformer_30m` | `speech_zipformer_150m` | `speech_transcribe` |
|---|---|---|---|
| **Nguồn** | [hynt/Zipformer-30M-RNNT-6000h](https://huggingface.co/hynt/Zipformer-30M-RNNT-6000h) | [hynt/ZipFormer-150M-CR-CTC-RNNT-6000h](https://huggingface.co/hynt/ZipFormer-150M-CR-CTC-RNNT-6000h) | PhoWhisper (VinAI) cho tiếng Việt, Whisper (OpenAI) cho ngôn ngữ khác |
| **Ngôn ngữ** | Chỉ tiếng Việt | Chỉ tiếng Việt | Tiếng Việt + 8 ngôn ngữ khác |
| **Độ chính xác (lỗi từ, VLSP 2023–2025)** | 8–11% | **6–8% (tốt nhất)** | PhoWhisper-medium ~17% (theo bảng của hynt) |
| **Tốc độ CPU** | **Nhanh nhất** (5 phút ≈ 8 s) | Nhanh (≈ 3 lần chậm hơn 30M) | Chậm nhất (5 phút ≈ 70 s) |
| **Dung lượng model** | **32 MB** | 160 MB | 240 MB – 1,5 GB |
| **Chữ trả về** | chữ thường, viết hoa đầu câu, không dấu câu | như 30M | có dấu câu (Whisper), chữ thường (PhoWhisper) |
| **Dùng thương mại** | ✗ (CC-BY-NC-ND-4.0) | ✗ (CC-BY-NC-ND-4.0) | **✓** (MIT / BSD-3) |
| **Nên dùng khi** | Máy yếu / VPS, file dài, cần nhanh | Cần chính xác nhất: tin tức, phỏng vấn, bài giảng, giọng vùng miền | Ngoại ngữ, hoặc sản phẩm thương mại |

Trên mẫu thử 37 từ của MediaTool: cả hai ZipFormer đúng 37/37 từ; PhoWhisper-small sai 4 từ, PhoWhisper-medium đúng hết. Ba tool cho
**cùng output** (`subtitle`, `text`, `transcript`) nên thay nhau được trong mọi chuỗi.

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `media` | `media` | có | Video hoặc audio có người nói |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `language` | string | `"vi"` | `vi` — Tiếng Việt<br>`en` — Tiếng Anh<br>`zh` — Tiếng Trung<br>`ja` — Tiếng Nhật<br>`ko` — Tiếng Hàn<br>`th` — Tiếng Thái<br>`fr` — Tiếng Pháp<br>`de` — Tiếng Đức<br>`es` — Tiếng Tây Ban Nha | Ngôn ngữ đang nói — chọn đúng để dùng model hợp với ngôn ngữ đó |
| `model` | string | `"base"` | `base` — Nhanh (tiếng Việt 240 MB · ngôn ngữ khác 145 MB)<br>`small` — Chính xác hơn, chậm hơn (tiếng Việt 1,5 GB · ngôn ngữ khác 465 MB) | Mức nhận dạng |
| `max_chars` | integer | `0` | 0 – 120 | Số ký tự tối đa mỗi dòng phụ đề; 0 = theo câu. Video dọc nên 16–24 |
| `prompt` | string | `""` |  | Gợi ý từ ngữ (tên riêng, thuật ngữ) để nhận dạng đúng hơn; có thể bỏ trống |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `subtitle` | `subtitle` | có | Phụ đề .srt |
| `text` | `text` | có | Lời chép thuần (.txt, mỗi câu một dòng) — sửa dễ, đưa vào tool đọc văn bản |
| `transcript` | `transcript` | có | Lời kèm thời gian từng dòng và từng từ (JSON) — cho compose_bind kiểu TikTok / karaoke, speech_dub |
<!-- AUTO:io:end -->

**Giải thích thêm về tham số:**
- `language`: ngôn ngữ đang nói — quyết định model: tiếng Việt → PhoWhisper, còn lại → Whisper. Không có "tự nhận biết": đoán sai ngôn ngữ thì dùng sai model.
- `model`: `base` nhanh (tiếng Việt: PhoWhisper-small int8, 240 MB); `small` chính xác hơn, chậm khoảng 3–4 lần (tiếng Việt: PhoWhisper-medium, 1,5 GB) — nên dùng khi giọng địa phương nặng, nhiều tạp âm.
- `max_chars`: 0 giữ nguyên câu (phụ đề phim). Video dọc TikTok / Reels nên 16–24 để mỗi lần chỉ hiện vài từ.
- `prompt`: viết vài tên riêng / thuật ngữ có trong đoạn nói (ví dụ "MediaTool, Hà Giang") để model viết đúng chính tả.

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Chép lời đoạn nói tiếng Việt (PhoWhisper)**

```powershell
mediatool-dev run tools/speech/transcribe --example 1
```

```ts
await ws.tools.run("speech_transcribe", { inputs: { /* asset */ }, params: {"model": "base", "language": "vi"} });
```

**Ví dụ 2: Chép lời đoạn nói tiếng Anh (Whisper)**

```powershell
mediatool-dev run tools/speech/transcribe --example 2
```

```ts
await ws.tools.run("speech_transcribe", { inputs: { /* asset */ }, params: {"model": "base", "language": "en"} });
```

**Ví dụ 3: Video nói chuyện → phụ đề ngắn kiểu TikTok (tối đa 18 ký tự mỗi dòng)**

```powershell
mediatool-dev run tools/speech/transcribe --example 3
```

```ts
await ws.tools.run("speech_transcribe", { inputs: { /* asset */ }, params: {"model": "base", "language": "en", "max_chars": 18} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Làm phụ đề tiếng Việt cho video này, dòng ngắn để đăng TikTok."

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `media_apply`, `speech_dub`, `speech_synthesize`, `speech_voice_add`, `video_demux`
- **Tool nối được ra sau (nhận output):** `compose_bind`, `compose_edit`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `lyrics_align`, `speech_dub`, `speech_synthesize`
<!-- AUTO:chain:end -->

**Lưu ý khi tích hợp:**
- `transcript` là TimedData (`items` = dòng, `children` = từ) — `compose_bind` (input `data`) dùng thời gian từng từ cho kiểu TikTok / karaoke. `subtitle` (.srt) dùng được ở mọi nơi nhận phụ đề.
- Chuỗi dựng sẵn: `compose_auto_captions` (phiên âm → chèn phụ đề TikTok).

## 5. Cách hoạt động

1. ffmpeg giải mã âm thanh về 16 kHz mono.
2. Chọn model theo ngôn ngữ (bảng `ENGINES` trong `tool.py`: thêm ngôn ngữ = thêm một dòng). Cả PhoWhisper lẫn Whisper chạy trên faster-whisper (CTranslate2, lượng tử int8 trên CPU), có VAD bỏ đoạn im lặng (≥ 0,5 giây) và lấy thời gian từng từ.
3. Đoạn quá dài (> 7 giây hoặc > 100 ký tự — PhoWhisper hay chép cả đoạn một lèo, ít dấu câu) được tách thành câu tại ranh giới tốt nhất: khoảng lặng trước từ dài nhất, cộng điểm nếu có dấu câu, trừ điểm nếu hai nửa lệch nhau (`timed.split_pauses`).
4. Nếu đặt `max_chars`, mỗi câu được cắt thành dòng ngắn theo ranh giới từ (`timed.split_lines`); thời gian từng từ giữ nguyên.

Model tải **lần đầu** theo `[[models]]` (core kiểm sha256 từng file) vào thư mục `models/`, các lần sau dùng lại.

## 6. Hiệu năng và tài nguyên

<!-- AUTO:bench:start -->
_Chưa có số đo. Chạy trong sandbox để đo RAM đỉnh và thời gian._
<!-- AUTO:bench:end -->

## 7. Model và license

<!-- AUTO:models:start -->
| Model | Kích thước | License | Nguồn |
|---|---|---|---|
| `whisper_base` | 145 MB | MIT | https://huggingface.co/Systran/faster-whisper-base |
| `whisper_small` | 465 MB | MIT | https://huggingface.co/Systran/faster-whisper-small |
| `phowhisper_small` | 240 MB | BSD-3-Clause | https://huggingface.co/vinai/PhoWhisper-small |
| `phowhisper_medium` | 1461 MB | BSD-3-Clause | https://huggingface.co/vinai/PhoWhisper-medium |
<!-- AUTO:models:end -->

Whisper © OpenAI (MIT), bản CTranslate2 của Systran (MIT). PhoWhisper © VinAI Research (BSD-3-Clause) — Le et al., *PhoWhisper: Automatic Speech Recognition for Vietnamese*, ICLR 2024 Tiny Papers; bản CTranslate2 chỉ chuyển đổi định dạng, không đổi trọng số (medium có `conversion.json` ghi mã băm). Thư viện faster-whisper (MIT).

## 8. Tiếng Việt

PhoWhisper được tinh chỉnh trên 844 giờ tiếng Việt nhiều vùng miền (Bắc, Trung, Nam), cho lời có dấu đầy đủ. `small` (PhoWhisper-medium) đúng hơn rõ với giọng địa phương nặng, nói nhanh, tạp âm. Lời có thể thiếu dấu câu — tool tự tách câu theo chỗ ngắt hơi. Tên riêng, thuật ngữ: điền vào `prompt`.

## 9. Lỗi và cảnh báo

| Mã | Loại | Khi nào xảy ra | Cách xử lý cho người dùng |
|---|---|---|---|
| `INVALID_INPUT` | InputError | Input hoặc tham số sai | Kiểm tra lại file và tham số |
| `NO_AUDIO` | ToolError | File không có tiếng | Chọn file có âm thanh |
| `MODEL_UNAVAILABLE` | ToolError | Không tải được model (mất mạng, sai mã băm) | Kiểm tra mạng rồi chạy lại; model chỉ tải một lần |
| `MISSING_PACKAGE` | ToolError | Máy chạy chưa cài faster-whisper | Dùng image core mới hoặc `pip install faster-whisper` |
| _(cảnh báo)_ | warning | Không nghe thấy lời nào | File chỉ có nhạc / im lặng |

## 10. Giới hạn đã biết

- Thời gian từng từ có sai số khoảng 0,1–0,3 giây.
- Không tách người nói (ai nói câu nào).
- Lần chạy đầu phải tải model (145 MB hoặc 465 MB).

## 11. Hỏi đáp và xử lý sự cố

**Ra chữ lạ?** Kiểm tra `language` đúng với ngôn ngữ đang nói.
**Sai tên riêng?** Thêm tên đó vào `prompt`.

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

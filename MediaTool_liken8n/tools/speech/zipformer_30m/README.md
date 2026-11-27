# Chép lời tiếng Việt — ZipFormer-30M (nhanh, nhẹ)

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `speech_zipformer_30m` |
| **Nguồn** | [hynt/Zipformer-30M-RNNT-6000h](https://huggingface.co/hynt/Zipformer-30M-RNNT-6000h) |
| **Category** | `speech` |
| **Phiên bản** | 0.1.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 900 MB · GPU: none · heavy: no |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Đưa vào **video hoặc audio nói tiếng Việt**, nhận lại **phụ đề .srt**, **lời chép .txt** và **thời gian từng từ** (JSON). Bản **nhanh và nhẹ nhất**: model 30 triệu tham số, chạy rất nhanh ngay trên CPU.

> **Nguồn model:** [hynt/Zipformer-30M-RNNT-6000h](https://huggingface.co/hynt/Zipformer-30M-RNNT-6000h) — tác giả **hynt** (Hugging Face), kiến trúc ZipFormer (k2-fsa / icefall), học trên ~6.000 giờ tiếng Việt;
> kiến trúc này giành **giải nhất VLSP 2025** ([bài báo ACL](https://aclanthology.org/2025.vlsp-1.4.pdf)).
> **License CC-BY-NC-ND-4.0 — chỉ dùng phi thương mại.**

**Ưu điểm:**
- **Rất nhanh trên CPU**: 12 giây âm thanh ≈ 0,3 giây; bài 5 phút ≈ 8 giây trên máy đo.
- **Rất nhẹ**: model 32 MB, RAM thấp — chạy tốt trên máy yếu, VPS 8 GB.
- Chính xác cao cho cỡ model: lỗi từ 8–11% trên VLSP 2023–2025, tốt hơn PhoWhisper-large (1,5 tỉ tham số) trên các bộ này.

**Hạn chế:**
- Kém bản 150M khoảng 2–4 điểm lỗi từ trên bộ VLSP mới.
- Chỉ tiếng Việt; chỉ dùng phi thương mại.

**Dùng khi:**
- Cần phụ đề / lời thoại **tiếng Việt** từ video, audio (vlog, tin tức, phỏng vấn, bài giảng, podcast).
- Làm bước đầu của chuỗi phụ đề / lồng tiếng (thay `speech_transcribe` trong `compose_auto_captions`, `compose_auto_dub`).

**Không dùng khi:**
- Ngôn ngữ khác tiếng Việt → `speech_transcribe`.
- Sản phẩm thương mại → `speech_transcribe` (PhoWhisper, BSD-3).
- Bài hát có lời sẵn → `lyrics_align` (căn lời chính xác hơn nhiều so với chép tự động).

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
| `media` | `media` | có | Video hoặc audio có người nói tiếng Việt |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `max_chars` | integer | `0` | 0 – 120 | Số ký tự tối đa mỗi dòng phụ đề; 0 = theo câu. Video dọc nên 16–24 |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `subtitle` | `subtitle` | có | Phụ đề .srt |
| `text` | `text` | có | Lời chép thuần (.txt, mỗi câu một dòng) |
| `transcript` | `transcript` | có | Lời kèm thời gian từng dòng và từng từ (JSON) — cho compose_bind, speech_dub |
<!-- AUTO:io:end -->

**Giải thích thêm về tham số:**
- `max_chars`: 0 = theo câu (phụ đề phim); video dọc TikTok / Reels nên 16–24.

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Chép lời đoạn nói tiếng Việt**

```powershell
mediatool-dev run tools/speech/zipformer_30m --example 1
```

```ts
await ws.tools.run("speech_zipformer_30m", { inputs: { /* asset */ }, params: {} });
```

**Ví dụ 2: Phụ đề dòng ngắn cho video dọc**

```powershell
mediatool-dev run tools/speech/zipformer_30m --example 2
```

```ts
await ws.tools.run("speech_zipformer_30m", { inputs: { /* asset */ }, params: {"max_chars": 18} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Làm phụ đề tiếng Việt cho video phỏng vấn này."

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `media_apply`, `speech_dub`, `speech_synthesize`, `speech_voice_add`, `video_demux`
- **Tool nối được ra sau (nhận output):** `compose_bind`, `compose_edit`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `lyrics_align`, `speech_dub`, `speech_synthesize`
<!-- AUTO:chain:end -->

**Lưu ý khi tích hợp:** output giống hệt `speech_transcribe` — `transcript` (TimedData: dòng → từ) cho `compose_bind` (TikTok / karaoke) và `speech_dub`; `text` cho `speech_synthesize`.

## 5. Cách hoạt động

Phần xử lý chung ở `mediatool_sdk.asr` (dùng chung với tool ZipFormer còn lại):
1. ffmpeg giải mã âm thanh về 16 kHz mono.
2. Silero VAD (đi kèm faster-whisper) tìm đoạn có tiếng nói, gộp thành đoạn ≤ 20 giây. File bài hát / nhạc nền to (VAD coi giọng hát là "không phải tiếng nói") thì tự nhận ra, cắt đều tại chỗ nhỏ tiếng nhất và cảnh báo.
3. sherpa-onnx (Apache-2.0) chạy encoder + decoder + joiner ONNX (int8), tìm kiếm chùm `modified_beam_search` 4 nhánh.
4. Token có khoảng trắng đầu mở một từ mới → thời gian bắt đầu từng từ; từ kết thúc khi từ sau bắt đầu, tối đa 0,6 giây (không nuốt khoảng lặng).
5. Đoạn dài > 7 giây tách thành câu tại chỗ ngắt hơi dài nhất (`timed.split_pauses`), viết hoa đầu câu, cắt dòng theo `max_chars`.

## 6. Hiệu năng và tài nguyên

<!-- AUTO:bench:start -->
_Chưa có số đo. Chạy trong sandbox để đo RAM đỉnh và thời gian._
<!-- AUTO:bench:end -->

Đo trên CPU 12 luồng: 8 giây âm thanh ≈ 1,7 giây (gồm nạp model); bài 5 phút ≈ 8 giây. Model 32 MB, tải lần đầu. RAM khai báo 900 MB.

## 7. Model và license

<!-- AUTO:models:start -->
| Model | Kích thước | License | Nguồn |
|---|---|---|---|
| `zipformer_30m_vi` | 32 MB | CC-BY-NC-ND-4.0 | https://huggingface.co/hynt/Zipformer-30M-RNNT-6000h |
<!-- AUTO:models:end -->

Model © hynt, **CC-BY-NC-ND-4.0**: được dùng phi thương mại, phải ghi công tác giả, không phân phối bản sửa đổi — tool tải nguyên file
gốc từ Hugging Face (ghim commit, kiểm sha256), không sửa. File `config.json` của repo chính là bảng token, được lưu thành `tokens.txt`.
Thư viện chạy: [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0). Phương án thay thế khi thương mại hóa: `speech_transcribe`.

## 8. Tiếng Việt

Model học trên nhiều bộ dữ liệu ba miền (VLSP, FPT, Bud500, VietSpeech, ViVoice…). Lời ra **chữ thường không dấu câu** (tool viết hoa đầu câu);
tên riêng không được viết hoa ("việt nam"); số đọc bằng chữ ("hai nghìn").

## 9. Lỗi và cảnh báo

| Mã | Loại | Khi nào xảy ra | Cách xử lý cho người dùng |
|---|---|---|---|
| `INVALID_INPUT` | InputError | Input sai | Kiểm tra lại file |
| `NO_AUDIO` | ToolError | File không có tiếng | Chọn file có âm thanh |
| `MODEL_UNAVAILABLE` | ToolError | Không tải được model | Kiểm tra mạng rồi chạy lại; model chỉ tải một lần |
| `MISSING_PACKAGE` | ToolError | Máy chạy chưa cài sherpa-onnx | Dùng image core mới |
| _(cảnh báo)_ | warning | File là bài hát / nhạc nền to; không nghe thấy lời | Bài hát có lời sẵn → `lyrics_align` |

## 10. Giới hạn đã biết

- Chỉ tiếng Việt; từ tiếng Anh trong câu có thể bị phiên theo âm Việt.
- Không có dấu câu giữa câu, không viết hoa tên riêng.
- Thời gian KẾT THÚC từng từ là ước lượng (model chỉ cho lúc bắt đầu token).

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

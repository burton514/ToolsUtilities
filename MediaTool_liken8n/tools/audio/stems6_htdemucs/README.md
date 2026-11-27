# Tách 6 phần — nhẹ máy, nhanh (HTDemucs 6s)

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `audio_stems6_htdemucs` |
| **Nguồn** | [facebookresearch/demucs](https://github.com/facebookresearch/demucs) · [StemSplitio/htdemucs-6s-onnx](https://huggingface.co/StemSplitio/htdemucs-6s-onnx) |
| **Category** | `audio` |
| **Phiên bản** | 0.1.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 1500 MB · GPU: optional · heavy: yes |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Đưa vào **bài hát (file nhạc hoặc video MV)**, nhận lại **6 phần**: giọng hát, trống, bass, guitar, piano / phím, nhạc cụ khác — kèm
**nhạc nền** ghép sẵn. Bản **nhanh và nhẹ nhất**, dùng **thương mại được**.

> **Nguồn model:** HT-Demucs v4 bản 6 nguồn `htdemucs_6s` của **Meta** ([facebookresearch/demucs](https://github.com/facebookresearch/demucs), MIT),
> bản xuất ONNX [StemSplitio/htdemucs-6s-onnx](https://huggingface.co/StemSplitio/htdemucs-6s-onnx) (MIT, đối chiếu với PyTorch: sai khác
> lớn nhất ~1e-4), trọng số lưu fp16 (136 MB). **MIT — dùng thương mại được.**

**Ưu điểm:**
- **Nhanh**: bài 4 phút ≈ 3 phút trên CPU 6 nhân — nhanh hơn khoảng 4 lần SW, 8 lần Leap Xe.
- **Nhẹ**: model 136 MB, RAM đỉnh ~1.4 GB — chạy được trên máy 8 GB đang mở nhiều ứng dụng.
- **MIT**: dùng được trong sản phẩm thương mại — phương án thay thế khai báo sẵn cho hai tool RoFormer.

**Hạn chế:**
- Kém hai tool BS-RoFormer: giọng còn lẫn nhạc, nhạc nền còn vệt giọng rõ hơn; guitar / piano tách kém hơn SW.

**Dùng khi:**
- Máy yếu, file dài, cần kết quả nhanh để xem thử / dựng nháp.
- Sản phẩm thương mại.

**Không dùng khi:**
- Cần karaoke / giọng sạch nhất → `audio_vocals_leap_xe`.
- Cần nhạc cụ riêng chất lượng cao nhất → `audio_stems6_sw`.

### Chọn tool tách nào?

| | `audio_vocals_leap_xe` | `audio_stems6_sw` | `audio_stems6_htdemucs` |
|---|---|---|---|
| **Nguồn model** | [pcunwa/BS-Roformer-Leap](https://huggingface.co/pcunwa/BS-Roformer-Leap) (thư mục `Xe/`) | BS-RoFormer SW của jarredou — bản sao [koidn/BS-RoFormer-SW-6stem](https://huggingface.co/koidn/BS-RoFormer-SW-6stem) | [facebookresearch/demucs](https://github.com/facebookresearch/demucs) `htdemucs_6s` — ONNX [StemSplitio/htdemucs-6s-onnx](https://huggingface.co/StemSplitio/htdemucs-6s-onnx) |
| **Kiến trúc** | BS-RoFormer, chuyên giọng hát (67 triệu tham số) | BS-RoFormer 6 nguồn (175 triệu tham số) | Hybrid Transformer Demucs v4 (Meta, 2022) |
| **Cho ra** | giọng + nhạc nền | 6 phần + nhạc nền | 6 phần + nhạc nền |
| **Độ sạch giọng / nhạc nền** | **Cao nhất** — model chỉ học tách giọng | Cao | Khá — giọng còn lẫn nhạc, nhạc nền còn vệt giọng rõ hơn |
| **Tách nhạc cụ** | — | **Tốt nhất** cho guitar / piano | Được; guitar / piano kém hơn SW |
| **Bài 4 phút trên CPU 6 nhân** | ≈ 22 phút | ≈ 11 phút | **≈ 3 phút** |
| **Bài 4 phút trên GPU** (RTX 3050 Laptop 4 GB) | ≈ 4 phút | ≈ 2 phút | **≈ 50 giây** |
| **RAM đỉnh đo được** | 1.7 GB | 2.0 GB | **1.4 GB** |
| **Tải model lần đầu** | 268 MB (+268 MB nếu dùng model nhạc nền riêng) | 700 MB | **136 MB** |
| **Dùng thương mại** | ✗ repo không ghi giấy phép | ✗ không ghi giấy phép | **✓ MIT** |
| **Nên dùng khi** | Làm karaoke, lấy giọng để căn lời / chép lời — cần sạch nhất | Cần tách riêng trống, bass, guitar, piano chất lượng cao (remix, tập đàn) | Máy yếu, file dài, cần nhanh, hoặc sản phẩm thương mại |

Ba tool cho **cùng tên output** (`vocals`, `instrumental`; hai tool 6 phần thêm `drums`, `bass`, `guitar`, `piano`, `other`) nên thay nhau
được trong mọi chuỗi. Số đo trên Intel i5-11400H (6 nhân / 12 luồng, AVX-512), Docker 8 GB, chế độ `standard`; `best` lâu khoảng gấp đôi
(RoFormer) hoặc gấp rưỡi (HTDemucs). GPU: máy chủ chạy bản GPU (`docker-compose.gpu.yml`, xem README gốc) thì ba tool tự chạy CUDA —
không có tham số riêng; lần đầu mỗi lượt mất ~20 giây khởi động CUDA nên bài rất ngắn không nhanh hơn CPU. Xếp hạng độ sạch theo kiến trúc và bảng xếp hạng cộng đồng tách nhạc (MVSEP) — MediaTool chưa
chấm trên bộ dữ liệu đánh giá riêng.

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `media` | `media` | có | Bài hát: file nhạc hoặc video có tiếng (MV) |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `quality` | string | `"standard"` | `standard` — Chuẩn (chồng 25% như demucs)<br>`best` — Kỹ nhất (chồng 50%, lâu gấp rưỡi) | Độ chồng giữa các đoạn 7,8 giây: chồng nhiều chỗ nối mượt hơn nhưng chạy lâu hơn |
| `format` | string | `"wav"` | `wav` — WAV<br>`flac` — FLAC<br>`mp3` — MP3 320 kbps | Định dạng file xuất: wav (không nén), flac (nén không mất chất lượng), mp3 (nhẹ nhất) |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `vocals` | `audio` | có | Giọng hát — dùng cho căn lời (lyrics_align), chép lời |
| `instrumental` | `audio` | có | Nhạc nền không lời (tổng 5 phần nhạc cụ) — dùng làm nhạc karaoke |
| `drums` | `audio` | có | Trống |
| `bass` | `audio` | có | Bass |
| `guitar` | `audio` | có | Guitar |
| `piano` | `audio` | có | Piano / phím |
| `other` | `audio` | có | Nhạc cụ khác: dây, kèn, synth, hiệu ứng… |
<!-- AUTO:io:end -->

**Giải thích thêm về tham số:**
- `quality`: `standard` — các đoạn 7,8 giây chồng 25% (mặc định của demucs); `best` — chồng 50%, chỗ nối mượt hơn, lâu gấp rưỡi.
- `format`: WAV 16-bit (mặc định), FLAC (nén không mất), MP3 320 kbps.

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Tách 6 phần một bài hát**

```powershell
mediatool-dev run tools/audio/stems6_htdemucs --example 1
```

```ts
await ws.tools.run("audio_stems6_htdemucs", { inputs: { /* asset */ }, params: {} });
```

**Ví dụ 2: Tách 6 phần từ MV, chồng 50%, xuất FLAC**

```powershell
mediatool-dev run tools/audio/stems6_htdemucs --example 2
```

```ts
await ws.tools.run("audio_stems6_htdemucs", { inputs: { /* asset */ }, params: {"quality": "best", "format": "flac"} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Tách nhanh bài này thành giọng, trống, bass, guitar, piano."

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `media_apply`, `speech_dub`, `speech_synthesize`, `speech_voice_add`, `video_demux`
- **Tool nối được ra sau (nhận output):** `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_bind`, `compose_karaoke`, `compose_render`, `compose_template`, `lyrics_align`, `media_probe`, `music_beat_track`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`
<!-- AUTO:chain:end -->

**Lưu ý khi tích hợp:** output giống hệt `audio_stems6_sw`, và `vocals` / `instrumental` giống `audio_vocals_leap_xe` — thay bước tách
trong `compose_karaoke_video` bằng tool này khi cần nhanh.

## 5. Cách hoạt động

1. ffmpeg giải mã một lần ra PCM float32 44,1 kHz stereo, đọc bằng memmap.
2. Chuẩn hóa như CLI demucs: trừ trung bình, chia độ lệch chuẩn của kênh mono **cả bài** (tính từng khối).
3. Chạy theo đoạn 343 980 mẫu (7,8 s — độ dài cố định của bản ONNX), chồng 25%, trộn bằng trọng số tam giác như `demucs.apply`;
   đoạn xong ghi ngay ra WAV, bộ đệm một đoạn (`mediatool_sdk.stems`, dùng chung với hai tool RoFormer).
4. ONNX chứa cả STFT / iSTFT; onnxruntime chạy với tối ưu đồ thị TẮT — bật lên onnxruntime đổi trọng số fp16 sang fp32 nhiều lần làm
   RAM lên vài GB, tắt đi RAM ~1.4 GB, tốc độ gần như cũ. Nhạc nền = tổng 5 phần không phải giọng.

## 6. Hiệu năng và tài nguyên

<!-- AUTO:bench:start -->
<!-- AUTO:bench:end -->

Đo trên Intel i5-11400H (6 nhân), Docker 8 GB, `standard`: 60 giây nhạc ≈ 41 giây, RAM đỉnh 1421 MB. **GPU** (RTX 3050 Laptop 4 GB): bài 4 phút ≈ 50 giây
(mỗi đoạn 7,8 s chỉ 0,5 s; ~20 s là khởi động CUDA).

## 7. Model và license

<!-- AUTO:models:start -->
| Model | Kích thước | License | Nguồn |
|---|---|---|---|
| `htdemucs_6s` | 136 MB | MIT | https://github.com/facebookresearch/demucs |
<!-- AUTO:models:end -->

HTDemucs © Meta Platforms, **MIT**; bản ONNX © StemSplitio, **MIT**. Dùng thương mại được.

## 8. Tiếng Việt

Model tách theo âm thanh, không phụ thuộc ngôn ngữ. Nhạc cụ dân tộc không có phần riêng — rơi vào `other`.

## 9. Lỗi và cảnh báo

| Mã | Loại | Khi nào xảy ra | Cách xử lý cho người dùng |
|---|---|---|---|
| `INVALID_INPUT` | InputError | Thiếu file hoặc file sai định dạng | Chọn file nhạc / video có tiếng |
| `NO_AUDIO` | ToolError | File không có (đủ) âm thanh | Chọn file có tiếng, dài ít nhất 1 giây |
| `MODEL_UNAVAILABLE` | ToolError | Không tải được model / file model hỏng | Kiểm tra mạng rồi chạy lại; model chỉ tải một lần |
| `MISSING_PACKAGE` | ToolError | Máy chạy thiếu numpy / onnxruntime | Dùng image core mới |
| _(cảnh báo)_ | warning | Gần như không có giọng hát (nhạc không lời) | File giọng gần như im lặng là đúng |

## 10. Giới hạn đã biết

- Chất lượng kém hai tool BS-RoFormer (đánh đổi lấy tốc độ và RAM).
- Chỉ 6 loại; bè, dây, kèn, synth… vào `other`.
- Xuất 44,1 kHz stereo 16-bit.

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

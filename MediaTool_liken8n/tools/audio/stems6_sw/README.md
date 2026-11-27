# Tách 6 phần — chất lượng cao (BS-RoFormer SW)

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `audio_stems6_sw` |
| **Nguồn** | [jarredou/BS-ROFO-SW-Fixed](https://huggingface.co/koidn/BS-RoFormer-SW-6stem) · [ZFTurbo/Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training) |
| **Category** | `audio` |
| **Phiên bản** | 0.1.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 2600 MB · GPU: optional · heavy: yes |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Đưa vào **bài hát (file nhạc hoặc video MV)**, nhận lại **6 phần**: giọng hát, trống, bass, guitar, piano / phím, nhạc cụ khác — kèm
**nhạc nền** ghép sẵn (tổng 5 phần nhạc cụ). Bản tách 6 phần **chất lượng cao nhất** trong MediaTool.

> **Nguồn model:** BS-RoFormer **SW** 6 nguồn (`BS-Rofo-SW-Fixed`) — tác giả gốc **jarredou** (Hugging Face; tài khoản gốc đã bị xóa).
> MediaTool tải bản sao nguyên byte [koidn/BS-RoFormer-SW-6stem](https://huggingface.co/koidn/BS-RoFormer-SW-6stem) (sha256 trùng với
> danh sách SHA256SUMS của bản sao), kiến trúc BS-RoFormer ([lucidrains/BS-RoFormer](https://github.com/lucidrains/BS-RoFormer)),
> huấn luyện bằng [ZFTurbo/Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training).
> **Không ghi giấy phép — chưa dùng thương mại** (thay thế: `audio_stems6_htdemucs`, MIT).

**Ưu điểm:**
- **6 phần chất lượng cao**: tách riêng guitar và piano tốt hơn hẳn HTDemucs; giọng sạch hơn HTDemucs.
- Nhạc nền ghép sẵn — dùng làm karaoke ngay.
- Nhận thẳng video (MV), RAM ổn định ~2.0 GB bất kể bài dài bao nhiêu.

**Hạn chế:**
- **Chậm trên CPU**: bài 4 phút ≈ 11 phút (`standard`).
- Model lớn (700 MB tải lần đầu).
- Chỉ lấy giọng + nhạc nền thì `audio_vocals_leap_xe` sạch hơn.
- Chưa dùng thương mại được.

**Dùng khi:**
- Cần **từng nhạc cụ riêng**: remix, tập đàn theo (bỏ guitar / piano), lấy trống / bass làm beat, phân tích bài.

**Không dùng khi:**
- Chỉ cần giọng + nhạc nền sạch nhất (karaoke) → `audio_vocals_leap_xe`.
- Máy yếu / cần nhanh / sản phẩm thương mại → `audio_stems6_htdemucs` (cùng output).

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
| `quality` | string | `"standard"` | `standard` — Chuẩn (nối đoạn mờ dần, nhanh gấp đôi)<br>`best` — Kỹ nhất (chồng 50% như cấu hình gốc) | Độ chồng giữa các đoạn 13 giây: chồng nhiều chỗ nối mượt hơn một chút nhưng chạy lâu gấp đôi |
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
- `quality`: `standard` — các đoạn 13,35 giây nối nhau bằng chỗ mờ dần 1,3 giây (mỗi giây nhạc chạy ~1,1 lần); `best` — chồng 50%
  như cấu hình gốc của model, chỗ nối mượt hơn một chút, lâu gấp đôi.
- `format`: WAV 16-bit (mặc định), FLAC (nén không mất), MP3 320 kbps.

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Tách 6 phần một bài hát**

```powershell
mediatool-dev run tools/audio/stems6_sw --example 1
```

```ts
await ws.tools.run("audio_stems6_sw", { inputs: { /* asset */ }, params: {} });
```

**Ví dụ 2: Tách 6 phần từ MV, xuất MP3**

```powershell
mediatool-dev run tools/audio/stems6_sw --example 2
```

```ts
await ws.tools.run("audio_stems6_sw", { inputs: { /* asset */ }, params: {"format": "mp3"} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Tách bài này ra trống, bass, guitar, piano riêng để mình remix."

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `audio_stems6_htdemucs`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `media_apply`, `speech_dub`, `speech_synthesize`, `speech_voice_add`, `video_demux`
- **Tool nối được ra sau (nhận output):** `audio_stems6_htdemucs`, `audio_vocals_leap_xe`, `compose_bind`, `compose_karaoke`, `compose_render`, `compose_template`, `lyrics_align`, `media_probe`, `music_beat_track`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`
<!-- AUTO:chain:end -->

**Lưu ý khi tích hợp:** output giống hệt `audio_stems6_htdemucs` nên thay nhau trong chuỗi. `vocals` → `lyrics_align`;
`instrumental` → `compose_bind` (karaoke); từng nhạc cụ → các tool âm thanh / trộn.

## 5. Cách hoạt động

1. ffmpeg giải mã một lần ra PCM float32 44,1 kHz stereo, đọc bằng memmap.
2. Chạy cả bài theo đoạn như `demix` của ZFTurbo: đoạn 588 800 mẫu (13,35 s — đúng độ dài model học), cửa sổ mờ dần 10% hai mép,
   đệm phản chiếu hai đầu bài; bộ đệm chỉ một đoạn (`mediatool_sdk.stems`).
3. Mỗi đoạn qua BS-RoFormer (`mediatool_sdk.bs_roformer`, dùng chung với `audio_vocals_leap_xe`): STFT → 62 băng tần → 12 lớp ×
   [Transformer thời gian → Transformer tần số] → **6 bộ mặt nạ** (bass, drums, other, vocals, guitar, piano — đúng thứ tự huấn
   luyện) → iSTFT. Nhạc nền = tổng 5 phần không phải giọng.
4. Không cần PyTorch: đọc checkpoint bằng `mediatool_sdk.ckpt`, tính bằng numpy + onnxruntime. **Đối chiếu với code gốc ZFTurbo
   (PyTorch): khác biệt ~130 dB SNR** — trùng khớp tới sai số làm tròn.

## 6. Hiệu năng và tài nguyên

<!-- AUTO:bench:start -->
<!-- AUTO:bench:end -->

Đo trên Intel i5-11400H (6 nhân), Docker 8 GB, `standard`: 60 giây nhạc ≈ 166 giây, RAM đỉnh 2033 MB.
Một đoạn 13,35 s ≈ 27 s xử lý. **GPU** (RTX 3050 Laptop 4 GB): bài 4 phút ≈ 132 giây. `best`: gấp đôi thời gian.

## 7. Model và license

<!-- AUTO:models:start -->
| Model | Kích thước | License | Nguồn |
|---|---|---|---|
| `bs_roformer_sw` | 700 MB | không ghi (unknown) | https://huggingface.co/koidn/BS-RoFormer-SW-6stem |
<!-- AUTO:models:end -->

Model © jarredou. **Không ghi giấy phép** (bản sao ghi `license: unknown`) nên MediaTool coi như **chưa được dùng thương mại**; tool tải
nguyên file (ghim commit, kiểm sha256), không sửa. Kiến trúc và cách chạy theo đoạn viết lại theo lucidrains/BS-RoFormer (MIT) và
ZFTurbo/Music-Source-Separation-Training (MIT). Phương án thay thế khi thương mại hóa: `audio_stems6_htdemucs` (MIT) — xem `docs/ENGINES.md`.

## 8. Tiếng Việt

Model tách theo âm thanh, không phụ thuộc ngôn ngữ. Nhạc cụ dân tộc (đàn tranh, sáo, đàn bầu) không có phần riêng — rơi vào `other`.

## 9. Lỗi và cảnh báo

| Mã | Loại | Khi nào xảy ra | Cách xử lý cho người dùng |
|---|---|---|---|
| `INVALID_INPUT` | InputError | Thiếu file hoặc file sai định dạng | Chọn file nhạc / video có tiếng |
| `NO_AUDIO` | ToolError | File không có (đủ) âm thanh | Chọn file có tiếng, dài ít nhất 1 giây |
| `MODEL_UNAVAILABLE` | ToolError | Không tải được model / file model hỏng | Kiểm tra mạng rồi chạy lại; model chỉ tải một lần |
| `MISSING_PACKAGE` | ToolError | Máy chạy thiếu numpy / onnxruntime / onnx | Dùng image core mới |
| _(cảnh báo)_ | warning | Gần như không có giọng hát (nhạc không lời) | File giọng gần như im lặng là đúng |

## 10. Giới hạn đã biết

- Chậm trên CPU (không dùng GPU).
- Chỉ 6 loại: bè, dây, kèn, synth, nhạc cụ dân tộc… đều vào `other`.
- Xuất 44,1 kHz stereo 16-bit.

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

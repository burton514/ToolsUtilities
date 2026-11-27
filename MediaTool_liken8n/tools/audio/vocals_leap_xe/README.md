# Tách giọng & nhạc nền — BS-RoFormer Leap Xe (chính xác cao)

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `audio_vocals_leap_xe` |
| **Nguồn** | [pcunwa/BS-Roformer-Leap](https://huggingface.co/pcunwa/BS-Roformer-Leap) · [ZFTurbo/Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training) |
| **Category** | `audio` |
| **Phiên bản** | 0.1.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 2200 MB · GPU: optional · heavy: yes |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Đưa vào **bài hát (file nhạc hoặc video MV)**, nhận lại hai file: **giọng hát** đã tách và **nhạc nền không lời** (beat karaoke).
Đây là bản tách giọng **sạch nhất** trong MediaTool.

> **Nguồn model:** [pcunwa/BS-Roformer-Leap](https://huggingface.co/pcunwa/BS-Roformer-Leap), thư mục `Xe/` — tác giả **pcunwa** (Hugging Face),
> kiến trúc BS-RoFormer (Band-Split RoPE Transformer, [lucidrains/BS-RoFormer](https://github.com/lucidrains/BS-RoFormer)), huấn luyện bằng
> [ZFTurbo/Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training). Gồm hai model cùng kiến trúc:
> `bs_leap_xe_voc.ckpt` (tách giọng) và `bs_leap_xe_inst.ckpt` (tách nhạc nền).
> **Repo không ghi giấy phép — chưa dùng thương mại** (thay thế: `audio_stems6_htdemucs`, MIT).

**Ưu điểm:**
- **Giọng và nhạc nền sạch nhất**: model chỉ học một việc là tách giọng hát (thế hệ BS-RoFormer 2024–2025, mạnh hơn rõ so với Demucs ở tiếng vang, bè, hơi thở).
- Hai cách lấy nhạc nền: **bài gốc − giọng** (giữ trọn mọi thứ không phải giọng, cộng hai file lại ra đúng bài gốc) hoặc **model nhạc nền riêng** (sạch vệt giọng hơn).
- Nhận thẳng video (MV), RAM ổn định ~1.7 GB bất kể bài dài bao nhiêu.

**Hạn chế:**
- **Chậm trên CPU**: bài 4 phút ≈ 22 phút (chế độ `standard`); dùng model nhạc nền riêng thì gấp đôi.
- Chỉ ra 2 phần (không tách trống / bass / guitar / piano).
- Chưa dùng thương mại được (không ghi giấy phép).

**Dùng khi:**
- Làm **karaoke**: lấy nhạc nền không lời từ bài hát / MV.
- Lấy **giọng hát sạch** để căn lời (`lyrics_align`), chép lời, luyện hát, cover.

**Không dùng khi:**
- Cần tách cả nhạc cụ → `audio_stems6_sw` (chất lượng cao) hoặc `audio_stems6_htdemucs` (nhanh).
- Máy yếu / cần nhanh / sản phẩm thương mại → `audio_stems6_htdemucs`.

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
| `instrumental` | string | `"subtract"` | `subtract` — Bài gốc − giọng (nhanh)<br>`model` — Model nhạc nền riêng (sạch hơn, ×2 thời gian) | Cách lấy nhạc nền: bài gốc trừ giọng (nhanh) hoặc chạy thêm model nhạc nền riêng (sạch giọng hơn, lâu gấp đôi) |
| `quality` | string | `"standard"` | `standard` — Chuẩn (nối đoạn mờ dần, nhanh gấp đôi)<br>`best` — Kỹ nhất (chồng 50% như cấu hình gốc) | Độ chồng giữa các đoạn 20 giây: chồng nhiều chỗ nối mượt hơn một chút nhưng chạy lâu gấp đôi |
| `format` | string | `"wav"` | `wav` — WAV<br>`flac` — FLAC<br>`mp3` — MP3 320 kbps | Định dạng file xuất: wav (không nén), flac (nén không mất chất lượng), mp3 (nhẹ nhất) |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `vocals` | `audio` | có | Giọng hát đã tách — dùng cho căn lời (lyrics_align), chép lời |
| `instrumental` | `audio` | có | Nhạc nền không lời — dùng làm nhạc karaoke |
<!-- AUTO:io:end -->

**Giải thích thêm về tham số:**
- `instrumental`: `subtract` (mặc định) — nhạc nền = bài gốc − giọng, nhanh, không mất gì của nhạc; `model` — chạy thêm model nhạc nền
  riêng của Leap Xe, ít vệt giọng sót hơn ở đoạn hát to / có bè, lâu gấp đôi và tải thêm 268 MB.
- `quality`: `standard` — các đoạn 20 giây nối nhau bằng chỗ mờ dần 2 giây (mỗi giây nhạc chạy ~1,1 lần); `best` — chồng 50% như
  cấu hình gốc của model (mỗi giây chạy 2 lần, trung bình hai lần đoán), chỗ nối mượt hơn một chút, lâu gấp đôi.
- `format`: WAV 16-bit (mặc định), FLAC (nén không mất), MP3 320 kbps.

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Tách giọng hát và nhạc nền**

```powershell
mediatool-dev run tools/audio/vocals_leap_xe --example 1
```

```ts
await ws.tools.run("audio_vocals_leap_xe", { inputs: { /* asset */ }, params: {} });
```

**Ví dụ 2: Từ MV: nhạc nền bằng model riêng, xuất FLAC**

```powershell
mediatool-dev run tools/audio/vocals_leap_xe --example 2
```

```ts
await ws.tools.run("audio_vocals_leap_xe", { inputs: { /* asset */ }, params: {"instrumental": "model", "format": "flac"} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Tách giọng ca sĩ khỏi bài này để mình làm karaoke."

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `media_apply`, `speech_dub`, `speech_synthesize`, `speech_voice_add`, `video_demux`
- **Tool nối được ra sau (nhận output):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `compose_bind`, `compose_karaoke`, `compose_render`, `compose_template`, `lyrics_align`, `media_probe`, `music_beat_track`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`
<!-- AUTO:chain:end -->

**Lưu ý khi tích hợp:** `vocals` → `lyrics_align` (căn lời trên giọng đã tách chắc hơn trên bản gốc); `instrumental` → `compose_bind`
(input `audio`, `video_volume = 0`) để làm karaoke trên hình gốc. Chuỗi dựng sẵn: `compose_karaoke_video`.

## 5. Cách hoạt động

1. ffmpeg giải mã một lần ra PCM float32 44,1 kHz stereo trong thư mục tạm, đọc bằng memmap (không nạp cả bài vào RAM).
2. Chạy cả bài theo đoạn **như `demix` của ZFTurbo**: đoạn 881 559 mẫu (20 s — đúng độ dài model học), cửa sổ mờ dần 10% hai mép,
   đệm phản chiếu hai đầu bài; đoạn đã xong ghi ngay ra WAV → bộ đệm chỉ một đoạn (`mediatool_sdk.stems`).
3. Mỗi đoạn qua BS-RoFormer (`mediatool_sdk.bs_roformer`): STFT 2048 / hop 512 → ghép 2 kênh vào trục tần số → 90 băng tần
   (RMSNorm + Linear) → 16 lớp × [Transformer theo thời gian → Transformer theo tần số] (8 đầu attention, RoPE, cổng sigmoid,
   FF GELU) → mặt nạ phức theo từng băng (MLP tanh + GLU) → nhân với phổ gốc → iSTFT.
4. Không cần PyTorch: checkpoint `.ckpt` đọc bằng `mediatool_sdk.ckpt` (unpickler chỉ cho phép tensor — file lạ không chạy được mã);
   phép tính nặng chạy bằng onnxruntime (attention flash của onnxruntime, không dựng ma trận T×T). **Đối chiếu với code gốc
   ZFTurbo (PyTorch) trên đoạn nhạc thật: khác biệt ~65 dB SNR** — chỉ là sai số làm tròn float32.

## 6. Hiệu năng và tài nguyên

<!-- AUTO:bench:start -->
<!-- AUTO:bench:end -->

Đo trên Intel i5-11400H (6 nhân), Docker 8 GB, `standard`, nhạc nền `subtract`: 60 giây nhạc ≈ 336 giây, RAM đỉnh
1730 MB. **GPU** (RTX 3050 Laptop 4 GB, máy chủ bản GPU): bài 4 phút ≈ 222 giây (CPU ≈ ≈ 22 phút).
Một đoạn 20 s ≈ 80 s xử lý trên CPU, nên bài ngắn hơn 20 s vẫn mất ~1,5 phút. Thêm model nhạc nền riêng: gấp đôi thời gian,
+~400 MB RAM. `best`: gấp đôi thời gian.

## 7. Model và license

<!-- AUTO:models:start -->
| Model | Kích thước | License | Nguồn |
|---|---|---|---|
| `leap_xe_vocals` | 268 MB | không ghi (unknown) | https://huggingface.co/pcunwa/BS-Roformer-Leap |
| `leap_xe_instrumental` | 268 MB | không ghi (unknown) | https://huggingface.co/pcunwa/BS-Roformer-Leap |
<!-- AUTO:models:end -->

Model © pcunwa. Repo **không ghi giấy phép** nên MediaTool coi như **chưa được dùng thương mại**; tool tải nguyên file gốc (ghim commit,
kiểm sha256), không sửa, không phân phối kèm. Kiến trúc và cách chạy theo đoạn viết lại theo lucidrains/BS-RoFormer (MIT) và
ZFTurbo/Music-Source-Separation-Training (MIT). Phương án thay thế khi thương mại hóa: `audio_stems6_htdemucs` (MIT) — xem `docs/ENGINES.md`.

## 8. Tiếng Việt

Model tách theo âm thanh, không phụ thuộc ngôn ngữ — nhạc Việt (bolero, nhạc trẻ, rap) tách tốt như nhạc nước ngoài. Giọng đã tách
dùng tiếp cho `lyrics_align` (căn lời tiếng Việt) và các tool chép lời.

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
- Tiếng vang / bè rất dày có thể còn sót nhẹ trong nhạc nền khi dùng `subtract` — chọn `instrumental = model`.
- Xuất 44,1 kHz stereo 16-bit.

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

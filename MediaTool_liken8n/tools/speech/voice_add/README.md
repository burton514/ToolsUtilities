# Lưu giọng đọc riêng

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `speech_voice_add` |
| **Nguồn** | [pnnbao97/VieNeu-TTS](https://github.com/pnnbao97/VieNeu-TTS) |
| **Category** | `speech` |
| **Phiên bản** | 0.1.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 2500 MB · GPU: none · heavy: yes |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Đưa vào **một clip có giọng nói** (audio hoặc video), đặt tên, xác nhận quyền dùng giọng — nhận lại **hồ sơ giọng** để các tool đọc văn bản / lồng tiếng nói bằng giọng đó, kèm **câu đọc thử** và **độ giống giọng**.

**Dùng khi:**
- Muốn thuyết minh / lồng tiếng bằng giọng của chính mình hoặc của người đã đồng ý.

**Không dùng khi:**
- Không có quyền dùng giọng đó. Nhân bản giọng người khác khi chưa được phép có thể vi phạm pháp luật và gây hại — tool bắt buộc xác nhận (`consent`).
- Chỉ cần một giọng đọc hay → dùng 25 giọng có sẵn của `speech_synthesize`.

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `audio` | `media` | có | Clip có giọng cần lưu (audio hoặc video), một người nói, càng ít nhạc / tạp âm càng tốt |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `name` | string | (bắt buộc) |  | Tên giọng (ví dụ: Giọng của Lan) |
| `consent` | boolean | `false` |  | Tôi là chủ giọng nói này hoặc đã được chủ giọng đồng ý cho nhân bản |
| `start` | number | `0` | 0 – … | Lấy mẫu từ giây này |
| `duration` | number | `0` | 0 – 30 | Độ dài đoạn mẫu (giây); 0 = tự chọn 10 giây rõ tiếng nhất. Tốt nhất 6–15 giây |
| `denoise` | boolean | `true` |  | Khử tạp âm clip mẫu trước khi lấy giọng (tắt nếu clip đã rất sạch) |
| `model` | string | `"turbo"` | `turbo` — Chất lượng cao — 48 kHz, tự nhiên nhất (khuyên dùng)<br>`turbo_fast` — Nhanh — Turbo int8, nhanh ~1,6× (cần CPU có VNNI, không có thì tự dùng bản thường)<br>`nano` — Nhẹ — cho máy yếu / VPS, 24 kHz, đọc tiếng Anh kém hơn | Model sẽ dùng giọng này (model khác vẫn dùng được, chỉ chậm hơn vài giây lần đầu) |
| `description` | string | `""` |  | Ghi chú (giới tính, vùng miền, phong cách…) |
| `preview_text` | string | `"Xin chào, đây là giọng đọc vừa được lưu. Bạn nghe thử xem có giống không nhé!"` |  | Câu đọc thử bằng giọng mới |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `voice` | `voice` | có | Hồ sơ giọng — đưa vào ô 'Giọng riêng' của tool đọc / lồng tiếng |
| `preview` | `audio` | có | Câu đọc thử bằng giọng mới |
| `sample` | `audio` | có | Đoạn mẫu đã được chọn từ clip (để kiểm tra) |
<!-- AUTO:io:end -->

**Giải thích thêm về tham số:**
- `duration = 0` (mặc định): tool tự tìm **10 giây rõ tiếng nhất** trong 2 phút đầu (tính từ `start`).
- `denoise`: khử tạp âm clip mẫu trước khi lấy giọng — nên để bật trừ khi clip thu trong phòng thu.
- `model`: model sẽ dùng giọng này nhiều nhất; hồ sơ vẫn dùng được với model khác (tool tự lấy đặc trưng từ clip mẫu đi kèm, chậm hơn vài giây lần đầu).

**Clip mẫu tốt:** một người nói, không nhạc nền, không vang, không bị rè; 6–15 giây; nói tự nhiên theo đúng phong cách muốn dùng (đọc tin, kể chuyện…) — giọng nhân bản bắt chước cả phong cách đó.

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Lưu giọng từ clip mẫu (giọng tổng hợp, tự chọn đoạn)**

```powershell
mediatool-dev run tools/speech/voice_add --example 1
```

```ts
await ws.tools.run("speech_voice_add", { inputs: { /* asset */ }, params: {"name": "Giọng mẫu", "consent": true} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Lưu giọng của tôi từ file ghi âm này (tôi đồng ý), rồi đọc kịch bản sau bằng giọng đó."

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `media_apply`, `speech_dub`, `speech_synthesize`, `video_demux`
- **Tool nối được ra sau (nhận output):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_dub`, `compose_bind`, `compose_edit`, `compose_karaoke`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `lyrics_align`, `media_probe`, `music_beat_track`, `speech_dub`, `speech_synthesize`, `speech_transcribe`, `speech_zipformer_150m`, `speech_zipformer_30m`
<!-- AUTO:chain:end -->

**Lưu ý khi tích hợp:**
- Output `voice` (format `voice`) đưa vào input `voice_file` của `speech_synthesize`, `speech_dub` và các chuỗi `compose_voiceover_captions`, `compose_auto_dub`.
- Hồ sơ giọng là một file JSON: tên, xác nhận quyền dùng, clip mẫu (FLAC), đặc trưng giọng theo từng model, chỉ số chất lượng.

## 5. Cách hoạt động

1. ffmpeg giải mã clip về mono 44,1 kHz.
2. Chọn đoạn mẫu: năng lượng theo khung 20 ms, ngưỡng tiếng nói = nền ồn (phân vị 10%) + 12 dB; cửa sổ được chấm điểm = số khung có tiếng − 3 × số khung bị vỡ tiếng; mép cửa sổ dời về chỗ lặng gần nhất (±0,4 s) để không cắt giữa chữ. Đỉnh quá nhỏ được nâng về −1 dBFS.
3. VieNeu khử nhiễu, cắt im lặng, lấy x-vector 192 chiều và mã tham chiếu của giọng.
4. Đọc thử câu mẫu bằng giọng mới, rồi đo **độ giống** = cosine giữa x-vector của clip mẫu và của câu đọc thử (cùng bộ mã hóa người nói). Dưới 0,5 tool cảnh báo.

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

Giữ được giọng vùng miền của clip mẫu.

## 9. Lỗi và cảnh báo

| Mã | Loại | Khi nào xảy ra | Cách xử lý cho người dùng |
|---|---|---|---|
| `INVALID_INPUT` | InputError | Chưa xác nhận quyền dùng giọng; clip dưới 3 giây giọng nói | Đánh dấu xác nhận; dùng clip dài hơn |
| `MODEL_UNAVAILABLE` | ToolError | Không tải được model | Kiểm tra mạng rồi chạy lại |
| _(cảnh báo)_ | warning | Clip vỡ tiếng / ồn / độ giống thấp | Thu lại clip sạch hơn, nhỏ tiếng hơn |

## 10. Giới hạn đã biết

- Độ giống phụ thuộc nhiều vào clip mẫu; giọng hát, giọng thì thầm, nhiều người nói chồng nhau cho kết quả kém.
- Hồ sơ giọng chứa clip mẫu — đối xử như dữ liệu cá nhân, không chia sẻ tùy tiện.

## 11. Hỏi đáp và xử lý sự cố

**Giọng nghe không giống?** Thử đoạn khác (`start`, `duration` 8–12 giây), tắt nhạc nền, ghi âm gần micro hơn.

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

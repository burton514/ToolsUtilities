# Làm video karaoke

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `compose_karaoke` |
| **Category** | `compose` |
| **Phiên bản** | 0.1.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 50 MB · GPU: none · heavy: no |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

**Chuỗi đã lưu** (không có code riêng): đưa vào **bài hát + lời** (và tùy chọn **video nền**), nhận **video karaoke** — chữ đổi màu đúng lúc hát từng chữ — kèm file **.lrc** thời gian từng chữ. Dùng được như một tool độc lập, và lồng được vào chuỗi khác.

**Dùng khi:**
- Làm video karaoke / lyric video cho bài hát có sẵn lời.

**Không dùng khi:**
- Chỉ cần file .lrc → `lyrics_align`. Đã có .lrc chuẩn → `compose_bind` kiểu karaoke.

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `song` | `audio` | có | Bài hát (có giọng hát) |
| `lyrics` | `text` | có | Lời bài hát (.txt), mỗi dòng một câu hát |
| `video` | `video` | không | Video nền (tùy chọn); bỏ trống thì dùng nền màu |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `engine` | string | `"song"` | `song` — Bài hát — chính xác nhất với nhạc (chỉ dùng phi thương mại)<br>`general` — Thông dụng — dùng thương mại được, kém hơn với giọng hát | Model căn lời |
| `offset_ms` | integer | `0` | -1000 – 1000 | Dời toàn bộ thời gian (ms); số âm = chữ hiện sớm hơn (karaoke hay dùng −100) |
| `style` | string | `"karaoke"` | `subtitle` — Phụ đề thường (chữ trắng viền đen)<br>`tiktok` — Phụ đề TikTok (từng từ bật lên, từ đang nói đổi màu)<br>`karaoke` — Karaoke (chữ đổi màu chạy theo lời)<br>`lyric` — Lời bài hát nghệ thuật (chữ to, hiện từng chữ cái)<br>`cinema` — Điện ảnh (chữ có chân, nhẹ nhàng) | Phong cách chữ |
| `position` | string | `"bottom"` | `bottom` — Dưới<br>`middle` — Giữa<br>`top` — Trên | Vị trí chữ trên khung |
| `color` | string | `"#FFFFFF"` |  | Màu chữ, dạng #RRGGBB |
| `highlight` | string | `"#FFD400"` |  | Màu nhấn (từ đang nói, karaoke), dạng #RRGGBB |
| `ratio` | string | `"16:9"` | `16:9` — 16:9 — ngang (YouTube)<br>`9:16` — 9:16 — dọc (TikTok, Reels)<br>`1:1` — 1:1 — vuông | Khung hình khi không có video nền |
| `background` | string | `"#101018"` |  | Màu nền khi không có video nền |
| `video_volume` | integer | `0` | 0 – 100 | Âm lượng tiếng gốc của video nền (%); 0 = chỉ nghe bài hát |
| `quality` | string | `"standard"` | `draft` — Nháp — nhanh để xem thử<br>`standard` — Chuẩn<br>`high` — Cao — đẹp nhất, chậm hơn | Chất lượng video |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `composition` | `composition` | có | Bản dựng — chỉnh kiểu chữ, hiệu ứng bằng compose_edit |
| `lrc` | `subtitle` | có | Lời karaoke .lrc thời gian từng chữ — dùng lại cho máy karaoke / trình phát nhạc |
| `video` | `video` | có | Video karaoke: chữ đổi màu đúng lúc hát từng chữ |
<!-- AUTO:io:end -->

Tham số lấy nguyên từ tool gốc (`$from` trong `chain.json`), luôn khớp `lyrics_align` và `compose_bind`.

## 3. Các bước

<!-- AUTO:steps:start -->
| # | Bước | Tool | Nhận | Tham số cố định |
|---|---|---|---|---|
| 1 | Căn lời theo nhạc | `lyrics_align` | `media` ← `$input.song`, `lyrics` ← `$input.lyrics` | `engine="$param.engine"`, `offset_ms="$param.offset_ms"` |
| 2 | Dựng video karaoke | `compose_bind` | `video` ← `$input.video`, `audio` ← `$input.song`, `data` ← `$align.lyrics` | `style="$param.style"`, `position="$param.position"`, `color="$param.color"`, `highlight="$param.highlight"`, `ratio="$param.ratio"`, `background="$param.background"`, `video_volume="$param.video_volume"`, `quality="$param.quality"` |
<!-- AUTO:steps:end -->

## 4. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Bài hát mẫu + lời → video karaoke nền màu**

```powershell
mediatool-dev run tools/compose/karaoke --example 1
```

```ts
await ws.tools.run("compose_karaoke", { inputs: { /* asset */ }, params: {"quality": "draft"} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Làm video karaoke cho bài này với lời sau, nền tối, chữ vàng."

## 5. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_film_subtitles`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `media_apply`, `speech_dub`, `speech_synthesize`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`
- **Tool nối được ra sau (nhận output):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_edit`, `compose_film_subtitles`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `lyrics_align`, `media_apply`, `media_probe`, `music_beat_track`, `speech_dub`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`, `video_info`
<!-- AUTO:chain:end -->

## 6. Cách hoạt động

Bước 1 `lyrics_align` căn thời gian từng chữ của lời vào bài hát. Bước 2 `compose_bind` dựng video kiểu karaoke từ thời gian đó: có video nền thì ghép lên video (tiếng gốc của video tắt, mặc định `video_volume = 0`), không có thì dùng nền màu theo `ratio` / `background`. Video nền nên dài bằng bài hát — ngắn hơn thì video kết quả dừng theo độ dài video nền (có cảnh báo). Model căn mặc định (`song`) **chỉ cho dùng phi thương mại** — cần thương mại thì chọn `engine = general`.

## 7. Lỗi và cảnh báo

| Mã / lỗi | Khi nào | Người dùng nên làm gì |
|---|---|---|
| `CHAIN_STEP_REJECTED` | Một bước không nhận input/tham số | Đọc thông báo (ghi rõ bước nào, trường nào) |
| `CHAIN_STEP_FAILED` | Lời không căn được vào bài, file hỏng… | Chạy riêng `lyrics_align` để xem dòng nào sai |

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

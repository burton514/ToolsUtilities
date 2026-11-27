# Karaoke từ video bài hát

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `compose_karaoke_video` |
| **Category** | `compose` |
| **Phiên bản** | 0.2.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 50 MB · GPU: none · heavy: yes |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

**Chuỗi đã lưu** (không có code riêng): đưa vào **video bài hát (MV) + lời**, nhận **video karaoke** — hình gốc, **nhạc nền đã bỏ giọng ca sĩ**, lời chữ đổi màu đúng lúc hát từng chữ — kèm file **.lrc**, file **nhạc nền** và **giọng** đã tách. Đây là **Luồng B (Karaoke)** của mục tiêu đợt 1, chạy trọn từ đầu đến cuối.

**Dùng khi:**
- Có MV / video bài hát và lời, muốn video hát theo (lyric video karaoke) giữ nguyên hình.

**Không dùng khi:**
- Chỉ có file nhạc (mp3…) → `compose_karaoke` (nền màu hoặc video nền riêng).
- Muốn giữ nguyên tiếng ca sĩ (lyric video): mở chuỗi, bỏ bước tách và nối `video` thẳng vào `lyrics_align` / `compose_bind`.

**Tốc độ:** bước tách giọng BS-RoFormer Leap Xe chạy chậm trên CPU (bài 4 phút ≈ 22 phút trên CPU 6 nhân). Cần nhanh thì mở chuỗi và
thay bước tách bằng `audio_stems6_htdemucs` (cùng output `vocals` / `instrumental`, ≈ 8 lần nhanh hơn, giọng còn lẫn nhạc nhiều hơn).

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `video` | `video` | có | Video bài hát (MV) — giữ hình, bỏ giọng ca sĩ |
| `lyrics` | `text` | có | Lời bài hát (.txt), mỗi dòng một câu hát, chép đủ các đoạn lặp |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `instrumental` | string | `"subtract"` | `subtract` — Bài gốc − giọng (nhanh)<br>`model` — Model nhạc nền riêng (sạch hơn, ×2 thời gian) | Cách lấy nhạc nền: bài gốc trừ giọng (nhanh) hoặc chạy thêm model nhạc nền riêng (sạch giọng hơn, lâu gấp đôi) |
| `separation_quality` | string | `"standard"` | `standard` — Chuẩn (nối đoạn mờ dần, nhanh gấp đôi)<br>`best` — Kỹ nhất (chồng 50% như cấu hình gốc) | Độ chồng giữa các đoạn 20 giây: chồng nhiều chỗ nối mượt hơn một chút nhưng chạy lâu gấp đôi |
| `engine` | string | `"song"` | `song` — Bài hát — chính xác nhất với nhạc (chỉ dùng phi thương mại)<br>`general` — Thông dụng — dùng thương mại được, kém hơn với giọng hát | Model căn lời |
| `offset_ms` | integer | `-100` | -1000 – 1000 | Dời toàn bộ thời gian (ms); số âm = chữ hiện sớm hơn (karaoke hay dùng −100) |
| `style` | string | `"karaoke"` | `subtitle` — Phụ đề thường (chữ trắng viền đen)<br>`tiktok` — Phụ đề TikTok (từng từ bật lên, từ đang nói đổi màu)<br>`karaoke` — Karaoke (chữ đổi màu chạy theo lời)<br>`lyric` — Lời bài hát nghệ thuật (chữ to, hiện từng chữ cái)<br>`cinema` — Điện ảnh (chữ có chân, nhẹ nhàng) | Phong cách chữ |
| `position` | string | `"bottom"` | `bottom` — Dưới<br>`middle` — Giữa<br>`top` — Trên | Vị trí chữ trên khung |
| `color` | string | `"#FFFFFF"` |  | Màu chữ, dạng #RRGGBB |
| `highlight` | string | `"#FFD400"` |  | Màu nhấn (từ đang nói, karaoke), dạng #RRGGBB |
| `quality` | string | `"standard"` | `draft` — Nháp — nhanh để xem thử<br>`standard` — Chuẩn<br>`high` — Cao — đẹp nhất, chậm hơn | Chất lượng video |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `composition` | `composition` | có | Bản dựng — chỉnh kiểu chữ, hiệu ứng bằng compose_edit |
| `instrumental` | `audio` | có | Nhạc nền không lời (beat karaoke) |
| `lrc` | `subtitle` | có | Lời karaoke .lrc thời gian từng chữ |
| `video` | `video` | có | Video karaoke: hình gốc + nhạc nền không lời, chữ đổi màu đúng lúc hát từng chữ |
| `vocals` | `audio` | có | Giọng ca sĩ đã tách |
<!-- AUTO:io:end -->

Tham số lấy nguyên từ tool gốc (`$from` trong `chain.json`). `offset_ms` mặc định −100 ms: chữ đổi màu sớm một chút như máy karaoke.

## 3. Các bước

<!-- AUTO:steps:start -->
| # | Bước | Tool | Nhận | Tham số cố định |
|---|---|---|---|---|
| 1 | Tách giọng ca sĩ khỏi nhạc nền | `audio_vocals_leap_xe` | `media` ← `$input.video` | `instrumental="$param.instrumental"`, `quality="$param.separation_quality"` |
| 2 | Căn lời theo giọng hát đã tách | `lyrics_align` | `media` ← `$separate.vocals`, `lyrics` ← `$input.lyrics` | `engine="$param.engine"`, `offset_ms="$param.offset_ms"` |
| 3 | Chèn lời karaoke lên video, thay tiếng bằng nhạc nền | `compose_bind` | `video` ← `$input.video`, `audio` ← `$separate.instrumental`, `data` ← `$align.lyrics` | `style="$param.style"`, `position="$param.position"`, `color="$param.color"`, `highlight="$param.highlight"`, `quality="$param.quality"`, `video_volume=0` |
<!-- AUTO:steps:end -->

## 4. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: MV mẫu + lời → video karaoke**

```powershell
mediatool-dev run tools/compose/karaoke_video --example 1
```

```ts
await ws.tools.run("compose_karaoke_video", { inputs: { /* asset */ }, params: {"quality": "draft"} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Làm karaoke cho MV này với lời sau."

## 5. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_film_subtitles`, `compose_karaoke`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `media_apply`, `speech_dub`, `speech_transcribe`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`
- **Tool nối được ra sau (nhận output):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_edit`, `compose_film_subtitles`, `compose_karaoke`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `lyrics_align`, `media_apply`, `media_probe`, `music_beat_track`, `speech_dub`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`, `video_info`
<!-- AUTO:chain:end -->

## 6. Cách hoạt động

1. `audio_vocals_leap_xe` tách âm thanh của MV thành **giọng ca sĩ** và **nhạc nền** (BS-RoFormer Leap Xe — xem README của tool).
2. `lyrics_align` căn thời gian từng chữ trên **giọng đã tách** — không còn trống / bass lấn át nên căn chắc hơn ở đoạn nhạc dày.
3. `compose_bind` chèn lời kiểu karaoke lên video, **thay tiếng gốc bằng nhạc nền** (`video_volume = 0`, cố định trong chuỗi).

Model tách giọng (không ghi giấy phép) và model căn mặc định (`song`, CC-BY-NC) **chưa dùng thương mại được** — khi cần: thay bước
tách bằng `audio_stems6_htdemucs` (MIT) và chọn `engine = general` (Apache-2.0).

## 7. Lỗi và cảnh báo

| Mã / lỗi | Khi nào | Người dùng nên làm gì |
|---|---|---|
| `CHAIN_STEP_REJECTED` | Một bước không nhận input/tham số | Đọc thông báo (ghi rõ bước nào, trường nào) |
| `CHAIN_STEP_FAILED` | Lời không căn được vào bài, file hỏng… | Chạy riêng `lyrics_align` để xem dòng nào sai |

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

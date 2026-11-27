# Chèn chữ theo thời gian

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `compose_bind` |
| **Nguồn** | MediaTool engine (Skia + FFmpeg) · [rust-skia/rust-skia](https://github.com/rust-skia/rust-skia) |
| **Category** | `compose` |
| **Phiên bản** | 0.1.1 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 2400 MB · GPU: none · heavy: yes |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Đưa vào **file thời gian** (phụ đề `.srt`/`.vtt`, lời bài hát `.lrc`, hoặc JSON phiên âm) cùng **video nền** (hoặc nhạc + màu nền), chọn phong cách. Nhận lại **video đã có chữ chạy đúng thời gian** và **bản dựng** để sửa tiếp.

Phong cách: phụ đề thường · phụ đề TikTok (từng từ bật lên, từ đang nói đổi màu) · karaoke (chữ đổi màu chạy theo lời) · lời bài hát nghệ thuật · điện ảnh.

**Dùng khi:**
- Đã có phụ đề / lời có thời gian và muốn "đốt" chữ lên video cho đẹp.
- Làm video lời bài hát, karaoke từ file `.lrc` (Enhanced LRC có thời gian từng từ → tô màu chính xác từng từ).
- Bước cuối của chuỗi: phiên âm → chèn chữ, căn lời → karaoke.

**Không dùng khi:**
- Chỉ cần nhúng phụ đề mềm (bật/tắt được) vào file → dùng `media_mux` (sắp có).
- Cần chỉnh tay từng câu, vị trí, hiệu ứng riêng → mở bản dựng đầu ra trong **Dựng video** hoặc dùng `compose_edit`.

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `video` | `video` | không | Video nền (bỏ trống thì dùng nền màu, kèm nhạc nếu có) |
| `audio` | `audio` | không | Tiếng thêm vào: giọng đọc / thuyết minh / nhạc nền (có video thì trộn cùng tiếng gốc) |
| `subtitle` | `subtitle` | không | File thời gian: phụ đề .srt/.vtt hoặc lời bài hát .lrc |
| `data` | `json` | không | Dữ liệu thời gian dạng JSON (kết quả phiên âm, căn lời…) thay cho file phụ đề |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `style` | string | `"subtitle"` | `subtitle` — Phụ đề thường (chữ trắng viền đen)<br>`tiktok` — Phụ đề TikTok (từng từ bật lên, từ đang nói đổi màu)<br>`karaoke` — Karaoke (chữ đổi màu chạy theo lời)<br>`lyric` — Lời bài hát nghệ thuật (chữ to, hiện từng chữ cái)<br>`cinema` — Điện ảnh (chữ có chân, nhẹ nhàng) | Phong cách chữ |
| `position` | string | `"bottom"` | `bottom` — Dưới<br>`middle` — Giữa<br>`top` — Trên | Vị trí chữ trên khung |
| `size` | integer | `0` | 0 – 220 | Cỡ chữ (theo khung cao 1080); 0 = tự chọn theo phong cách |
| `color` | string | `"#FFFFFF"` |  | Màu chữ, dạng #RRGGBB |
| `highlight` | string | `"#FFD400"` |  | Màu nhấn (từ đang nói, karaoke), dạng #RRGGBB |
| `ratio` | string | `"16:9"` | `16:9` — 16:9 — ngang (YouTube)<br>`9:16` — 9:16 — dọc (TikTok, Reels)<br>`1:1` — 1:1 — vuông | Khung hình khi không có video nền |
| `background` | string | `"#101018"` |  | Màu nền khi không có video nền |
| `video_volume` | integer | `100` | 0 – 100 | Âm lượng tiếng gốc của video (%), ví dụ 20 khi thêm giọng thuyết minh |
| `quality` | string | `"standard"` | `draft` — Nháp — nhanh để xem thử<br>`standard` — Chuẩn<br>`high` — Cao — đẹp nhất, chậm hơn | Chất lượng video |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `video` | `video` | có | Video đã chèn chữ |
| `composition` | `composition` | có | Bản dựng tương ứng — sửa tiếp bằng compose_edit hoặc mở trong trình Dựng video |
<!-- AUTO:io:end -->

**Giải thích thêm về tham số:**
- Cần đúng **một** nguồn thời gian: `subtitle` (file) **hoặc** `data` (JSON từ tool phiên âm/căn lời, dạng TimedData `{items:[{start,end,text,children}]}` hoặc `{segments:[...]}`).
- Không có video nền: khung theo `ratio`, nền màu `background`, thời lượng = nhạc (`audio`) hoặc hết câu cuối.
- TikTok / karaoke: nếu dữ liệu có thời gian từng từ (`children`, Enhanced LRC, `words`) thì tô đúng từng từ; nếu không, thời gian câu được chia đều theo số từ.
- `size = 0`: cỡ chữ tự chọn theo phong cách.

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Phụ đề kiểu TikTok từ file SRT**

```powershell
mediatool-dev run tools/compose/bind --example 1
```

```ts
await ws.tools.run("compose_bind", { inputs: { /* asset */ }, params: {"style": "tiktok", "quality": "draft"} });
```

**Ví dụ 2: Karaoke từ lời .lrc có thời gian từng từ, nền màu**

```powershell
mediatool-dev run tools/compose/bind --example 2
```

```ts
await ws.tools.run("compose_bind", { inputs: { /* asset */ }, params: {"style": "karaoke", "ratio": "16:9", "quality": "draft"} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Gắn phụ đề này vào video theo kiểu TikTok, chữ vàng ở giữa màn hình."

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_edit`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `lyrics_align`, `media_apply`, `media_probe`, `music_beat_track`, `speech_dub`, `speech_synthesize`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`, `video_info`
- **Tool nối được ra sau (nhận output):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_edit`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `lyrics_align`, `media_apply`, `media_probe`, `music_beat_track`, `speech_dub`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`, `video_info`
<!-- AUTO:chain:end -->

**Chuỗi hay dùng:**
```
media_apply (bộ màu) → compose_bind (phụ đề điện ảnh)          = compose_film_subtitles
transcribe → compose_bind (tiktok)                               (sắp có: phụ đề tự động)
separate_stems → lyrics_align → compose_bind (karaoke)           (sắp có: karaoke trọn gói)
compose_bind → compose_edit → compose_render                     (chỉnh thêm rồi xuất lại)
```

## 5. Cách hoạt động

1. Đọc dữ liệu thời gian bằng `mediatool_sdk.timed` (SRT/VTT/LRC/JSON → một định dạng TimedData chung).
2. Dựng bản dựng: lớp nền (video, hoặc nhạc + màu nền) + **mỗi câu một lớp chữ** đặt `start/duration` theo câu, kèm kiểu chữ + chuyển động của phong cách; TikTok/karaoke thêm các *đoạn chữ có thời gian* (spans) để đổi màu từng từ đúng lúc.
3. Render bằng engine native qua `mediatool_sdk.compose` (xuất song song, có cache).

## 6. Lỗi và cảnh báo

| Mã / lỗi | Khi nào | Người dùng nên làm gì |
|---|---|---|
| `InputError subtitle` "Hãy đưa MỘT nguồn thời gian" | Không đưa, hoặc đưa cả file phụ đề lẫn JSON | Chỉ đưa một |
| `InputError subtitle/data` "Không đọc được câu nào" | File sai định dạng hoặc rỗng | Kiểm tra file `.srt/.vtt/.lrc` có dòng thời gian |
| `RENDER_FAILED` | Engine không xuất được | Thử `draft`, kiểm tra video nền |
| `MISSING_BINARY` | Thiếu engine trên máy chủ | Báo người quản trị |

## 7. Giới hạn

- Câu nằm ngoài thời lượng video nền bị cắt bớt.
- Chưa tự ngắt dòng theo số ký tự kiểu phụ đề chuẩn (dùng độ rộng tối đa 90% khung).

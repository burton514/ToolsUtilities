# Căn lời bài hát theo nhạc

<!-- AUTO:header:start -->
| | |
|---|---|
| **ID** | `lyrics_align` |
| **Nguồn** | [nguyenvulebinh/lyric-alignment](https://huggingface.co/nguyenvulebinh/lyric-alignment) · [not-tanh/wav2vec2-large-xlsr-53-vietnamese](https://huggingface.co/not-tanh/wav2vec2-large-xlsr-53-vietnamese) |
| **Category** | `lyrics` |
| **Phiên bản** | 0.1.0 · SDK `>=0.1,<0.2` |
| **Trạng thái** | beta |
| **Người phụ trách** | mediatool-core |
| **Runtime** | profile `base` · RAM khai báo 2200 MB · GPU: none · heavy: yes |
| **License code** | MIT |
<!-- AUTO:header:end -->

## 1. Tóm tắt

Đưa vào **một bài hát** (audio hoặc video) và **lời của nó**, nhận lại **thời gian bắt đầu / kết thúc của từng chữ**: file **.lrc karaoke** (thời gian từng chữ) và **JSON** (dòng → chữ, kèm độ tin cậy). Đây là phần lõi để làm karaoke và lyric video. Chạy ngay trên máy.

**Dùng khi:**
- Có bài hát + lời (chép tay, lấy từ nguồn lời bài hát…) và muốn chữ chạy đúng nhịp hát.
- Có file .lrc / .srt nhưng thời gian lệch → đưa vào để căn lại.
- Làm bước đầu của chuỗi `compose_karaoke` (ra thẳng video karaoke).

**Không dùng khi:**
- Chưa có lời → `speech_transcribe` chép nháp (bài hát có nhạc nền chép tự động hay sai), sửa lại rồi đưa vào đây.
- Video nói chuyện có lời sẵn cần phụ đề → `compose_bind` / `speech_transcribe` phù hợp hơn.

## 2. Input · Params · Output

<!-- AUTO:io:start -->
### Input
| Tên | Format | Bắt buộc | Mô tả |
|---|---|---|---|
| `media` | `media` | có | Bài hát (audio) hoặc video có bài hát |
| `lyrics` | `text` | không | Lời bài hát (.txt), mỗi dòng một câu hát |
| `subtitle` | `subtitle` | không | Hoặc file lời có sẵn (.lrc / .srt) cần căn lại cho khớp |
| `data` | `json` | không | Hoặc dữ liệu lời dạng JSON (TimedData) |

### Params
| Tên | Kiểu | Mặc định | Giá trị hợp lệ | Mô tả |
|---|---|---|---|---|
| `engine` | string | `"song"` | `song` — Bài hát — chính xác nhất với nhạc (chỉ dùng phi thương mại)<br>`general` — Thông dụng — dùng thương mại được, kém hơn với giọng hát | Model căn lời |
| `offset_ms` | integer | `0` | -1000 – 1000 | Dời toàn bộ thời gian (ms); số âm = chữ hiện sớm hơn (karaoke hay dùng −100) |

### Output
| Tên | Format | Luôn có | Mô tả |
|---|---|---|---|
| `lrc` | `subtitle` | có | Lời karaoke .lrc có thời gian từng chữ — dùng cho compose_bind kiểu karaoke, máy nghe nhạc |
| `lyrics` | `timed_lyrics` | có | Lời kèm thời gian từng dòng / từng chữ và độ tin cậy (JSON) |
<!-- AUTO:io:end -->

**Giải thích thêm về tham số:**
- Lời đưa vào **một trong ba** cách: `lyrics` (.txt, mỗi dòng một câu hát), `subtitle` (.lrc / .srt — chỉ lấy chữ, thời gian cũ bị bỏ), `data` (JSON TimedData).
- Dòng ghi chú đoạn (`[Verse 1]`, `ĐK:`, `Điệp khúc:`, `Chorus`…) tự bị bỏ. Dấu lặp `x2` bị bỏ và có cảnh báo: **hãy chép đủ lời các đoạn lặp** — tool căn đúng thứ tự lời, không tự nhân đôi.
- `engine`: `song` (mặc định) chính xác nhất với giọng hát có nhạc nền nhưng **chỉ dùng phi thương mại**; `general` dùng thương mại được, kém hơn với giọng hát (xem mục 7).
- `offset_ms`: dời toàn bộ thời gian; karaoke thường cho chữ hiện sớm một chút (−100 ms).

## 3. Ví dụ sử dụng

<!-- AUTO:examples:start -->
**Ví dụ 1: Căn lời (file .txt) cho đoạn hát mẫu có nhạc nền**

```powershell
mediatool-dev run tools/lyrics/align --example 1
```

```ts
await ws.tools.run("lyrics_align", { inputs: { /* asset */ }, params: {} });
```

**Ví dụ 2: Dùng model thương mại được (general)**

```powershell
mediatool-dev run tools/lyrics/align --example 2
```

```ts
await ws.tools.run("lyrics_align", { inputs: { /* asset */ }, params: {"engine": "general"} });
```
<!-- AUTO:examples:end -->

**Ví dụ yêu cầu cho AI (MCP):**
> "Căn lời bài hát này theo nhạc và xuất file .lrc karaoke."

## 4. Tích hợp và nối tool

<!-- AUTO:chain:start -->
- **Tool nối được vào trước (cấp input):** `audio_stems6_htdemucs`, `audio_stems6_sw`, `audio_vocals_leap_xe`, `compose_auto_captions`, `compose_auto_dub`, `compose_bind`, `compose_edit`, `compose_film_subtitles`, `compose_karaoke`, `compose_karaoke_video`, `compose_render`, `compose_template`, `compose_voiceover_captions`, `media_apply`, `media_probe`, `music_beat_track`, `speech_dub`, `speech_synthesize`, `speech_transcribe`, `speech_voice_add`, `speech_zipformer_150m`, `speech_zipformer_30m`, `video_demux`, `video_info`
- **Tool nối được ra sau (nhận output):** `compose_bind`, `compose_edit`, `compose_film_subtitles`, `compose_render`, `speech_dub`
<!-- AUTO:chain:end -->

**Lưu ý khi tích hợp:**
- `lyrics` (TimedLyrics: `items` = dòng, `children` = chữ, `confidence` từng dòng) → `compose_bind` (input `data`, kiểu `karaoke` / `lyric`); `compose_edit` (input `markers`) để gắn mốc từng dòng vào bản dựng.
- `lrc` là Enhanced LRC (`[mm:ss.xx]<mm:ss.xx>chữ …`) — `compose_bind` và hầu hết máy nghe nhạc / karaoke đọc được.
- Chuỗi dựng sẵn: `compose_karaoke` (bài hát + lời → video karaoke).

## 5. Cách hoạt động

Theo phương pháp của [nguyenvulebinh/lyric-alignment](https://github.com/nguyenvulebinh/lyric-alignment) (Zalo AI Challenge 2022, IoU 0,632), dựa trên CTC-segmentation (Kürzinger 2020):

1. **Chữ viết → cách đọc**, từng chữ một để còn đối chiếu ngược (`mediatool_sdk.vi.spoken_words`, chuẩn hóa bằng sea-g2p, có nhìn chữ đứng trước làm ngữ cảnh): "3000" → "ba nghìn", "ngày 26/11" → "…hai mươi sáu tháng mười một", "13h30" → "mười ba giờ ba mươi phút", "IronMan" → "iron man", "tình-yêu" / "anh/em" → hai âm tiết. Ký tự ngoài bảng chữ của model bị bỏ; dòng chỉ có ký hiệu ("♪ ♪") bị bỏ.
2. **Nghe**: model wav2vec2 + CTC (ONNX, CPU) cho log-xác-suất từng ký tự mỗi 20 ms. Bài dài được chạy theo đoạn 20 giây, thêm 1 giây ngữ cảnh mỗi bên, chỉ giữ phần giữa — RAM không tăng theo độ dài bài, chỗ nối không lệch.
3. **Căn ép Viterbi** (`mediatool_sdk.align`): ký tự ngăn từ `|` đóng vai ký tự trống (nhạc / khoảng lặng giữa các chữ rơi vào đó), ký tự đệm CTC gộp vào `|`, log-xác-suất chặn dưới ở −20 — đúng như repo gốc. Cho phép nhạc dạo đầu bài và đuôi bài không có lời.
4. **Như repo gốc**: mỗi chữ sáng tới lúc chữ kế tiếp bắt đầu, tối đa 3 giây. Các mẹo repo gốc dùng riêng để tăng điểm IoU của cuộc thi (dời mọi chữ sớm 120 ms, kéo chữ đầu sớm 1 s, kéo chữ cuối thêm 4 s) **cố ý không áp dụng** — chính tác giả khuyên không dùng ngoài cuộc thi; cần chữ hiện sớm thì dùng `offset_ms`.
5. Ghép âm tiết về chữ gốc ("ba nghìn" → "3000"), chữ về dòng; dòng có độ tin cậy trung bình dưới 0,5 bị cảnh báo, và cả bài dưới 0,5 thì cảnh báo "lời có vẻ không phải của bài" (đo được: lời đúng 0,96–1,0 với `song`, 0,8–0,9 với `general`; lời của bài khác ~0,35).

**Độ chính xác đo được** trên mẫu có đáp án (giọng tổng hợp + nhạc nền 120 BPM + 2 giây nhạc dạo, 4 dòng): đầu dòng lệch trung bình **0,019 s** (`song`) và **0,030 s** (`general`), lớn nhất 0,028 s / 0,048 s.

## 6. Hiệu năng và tài nguyên

<!-- AUTO:bench:start -->
_Chưa có số đo. Chạy trong sandbox để đo RAM đỉnh và thời gian._
<!-- AUTO:bench:end -->

Đo trên CPU 12 luồng: bài 5 phút căn xong trong khoảng 30 giây (gồm nạp model); đoạn 11 giây khoảng 2 giây. Lần đầu tải model ~340 MB.

## 7. Model và license

<!-- AUTO:models:start -->
| Model | Kích thước | License | Nguồn |
|---|---|---|---|
| `lyric_align_song` | 344 MB | CC-BY-NC-4.0 | https://huggingface.co/nguyenvulebinh/lyric-alignment |
| `lyric_align_general` | 339 MB | Apache-2.0 | https://huggingface.co/not-tanh/wav2vec2-large-xlsr-53-vietnamese |
<!-- AUTO:models:end -->

| Engine | Model | License | Ghi chú |
|---|---|---|---|
| `song` (mặc định) | [nguyenvulebinh/lyric-alignment](https://huggingface.co/nguyenvulebinh/lyric-alignment) — wav2vec2-large học tiếp trên ~1.500 giờ nhạc Việt; bản ONNX int8 của [phuongnse](https://huggingface.co/phuongnse/lyric-alignment-onnx) (chỉ đổi định dạng, trọng số gốc) | **CC-BY-NC-4.0 — chỉ dùng phi thương mại** | Chính xác nhất với giọng hát |
| `general` | [not-tanh/wav2vec2-large-xlsr-53-vietnamese](https://huggingface.co/not-tanh/wav2vec2-large-xlsr-53-vietnamese) (nền XLSR-53 của Meta), bản ONNX int8 của [XDcobra](https://huggingface.co/XDcobra/wav2vec2-large-xlsr-53-vietnamese-ONNX) | Apache-2.0 | Phương án thay thế khi thương mại hóa (theo `docs/ENGINES.md`). Lưu ý: dữ liệu học có VIVOS (CC BY-NC-SA) — nên hỏi ý kiến pháp lý trước khi bán sản phẩm |

Code repo gốc: Apache-2.0 — chỉ tham khảo phương pháp, viết lại bằng numpy; không dùng `vinorm` (license riêng) mà dùng sea-g2p (Apache-2.0) để đổi chữ sang cách đọc.

## 8. Tiếng Việt

Lời tiếng Việt có dấu; số, ngày giờ, đơn vị, phần trăm tự đọc đúng; từ tiếng Anh trong lời được căn theo chữ cái (đúng mốc khi ca sĩ đọc gần cách viết). Một chữ không đọc được (chỉ ký hiệu) đứng tại mốc của chữ trước.

## 9. Lỗi và cảnh báo

| Mã | Loại | Khi nào xảy ra | Cách xử lý cho người dùng |
|---|---|---|---|
| `INVALID_INPUT` | InputError | Không có / có hơn một nguồn lời; lời rỗng; lời không căn được vào bài | Kiểm tra lời đúng bài, đủ đoạn |
| `MODEL_UNAVAILABLE` | ToolError | Không tải được model | Kiểm tra mạng rồi chạy lại; model chỉ tải một lần |
| _(cảnh báo)_ | warning | Dòng có độ tin cậy thấp; lời có dấu lặp x2 | Sửa lời dòng đó / chép đủ đoạn lặp |

## 10. Giới hạn đã biết

- Lời phải đúng thứ tự bài hát; thiếu / thừa cả đoạn làm các dòng quanh đó lệch (tool cảnh báo bằng độ tin cậy).
- Nhạc nền quá to, giọng hát bị biến đổi mạnh (autotune nặng, rap rất nhanh) giảm độ chính xác; sau này tách giọng trước (tool tách nguồn âm) sẽ cải thiện.
- Chữ cuối mỗi dòng sáng tới khi dòng sau bắt đầu (tối đa 3 giây) — theo quy ước của dữ liệu Zalo.

## 11. Hỏi đáp và xử lý sự cố

**Cả bài lệch đều một khoảng?** Dùng `offset_ms`.
**Một đoạn lệch hẳn?** Thường do lời đoạn đó khác bài (sai lời, thiếu điệp khúc lặp) — xem các dòng bị cảnh báo.

---
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md)

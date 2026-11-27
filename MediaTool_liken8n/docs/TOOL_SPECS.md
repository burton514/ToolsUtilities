# Đặc tả từng tool — Input · Tham số · Output

> Danh sách tổng và mức ưu tiên: [TOOL_CATALOG.md](TOOL_CATALOG.md). File này mô tả **từng tool nhận gì, chỉnh được gì, trả ra gì**, viết sao cho người không rành kỹ thuật cũng hiểu.

## Cách đọc

- **Input**: file hoặc dữ liệu đưa vào. Chữ trong ngoặc là loại dữ liệu (`format`), ví dụ `(audio)`. Output của tool này nối được vào input của tool khác khi cùng loại.
- **Tham số**: các nút chỉnh. Tên tham số (cột đầu) là tên trong code; cột "Nghĩa là gì" giải thích bằng lời thường. Giá trị trong `ngoặc` là giá trị gửi cho tool.
- **Output**: những gì tool trả về.
- **Đơn vị chung**: thời gian tính bằng **giây** (có thể lẻ, ví dụ `12.5`). Âm lượng và độ mạnh tính bằng **%**. Màu viết dạng mã màu, ví dụ `#FFFFFF` là trắng.
- Tham số nào cũng có **mặc định hợp lý**. Người dùng không chỉnh gì vẫn ra kết quả tốt.

**Quy ước cho người viết tool:** mô tả tham số trong code (`description`) phải dễ hiểu như trong file này. Không viết thuật ngữ trần (ví dụ "LUFS", "formant") mà không giải thích. Tham số mới phải được thêm vào đây và vào README của tool.

---

## 1. Tiện ích: nhập, xuất, ghép (`media_*`)

### `media_probe` — Xem thông tin file
Đọc thông tin của file video/audio, không thay đổi gì.
- **Input:** `file` (video hoặc audio)
- **Output:** `info` (json): thời lượng, kích thước khung hình, số hình mỗi giây, có tiếng hay không, có phụ đề không, dung lượng.

Không có tham số.

### `media_transcode` — Đổi định dạng, xuất theo nơi đăng
- **Input:** `media` (video hoặc audio)
- **Output:** `media` (video hoặc audio)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `preset` | Xuất nhanh theo nơi sẽ đăng; tự chọn sẵn mọi thông số phù hợp | `custom` (tự chỉnh), `youtube_1080p`, `tiktok` (dọc 1080×1920), `facebook`, `zalo`, `mp3`, `wav` | `custom` |
| `format` | Đuôi file muốn có (chỉ dùng khi `preset` = `custom`) | `mp4`, `mkv`, `webm`, `mov`, `mp3`, `m4a`, `wav`, `flac` | giữ như file gốc |
| `quality` | Chất lượng. Cao hơn thì đẹp hơn nhưng file nặng hơn | `low` (nhẹ), `medium`, `high` (đẹp) | `medium` |
| `max_height` | Giới hạn độ cao khung hình. File lớn hơn sẽ được thu nhỏ, giữ đúng tỉ lệ | `480`, `720`, `1080`, `1440`, `2160` | giữ nguyên |
| `fps` | Số hình mỗi giây của video | `24`, `25`, `30`, `60` | giữ nguyên |

### `media_trim` — Cắt một đoạn
- **Input:** `media` (video hoặc audio)
- **Output:** `media` (đoạn đã cắt)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `start` | Bắt đầu cắt từ giây thứ mấy | ≥ 0 | `0` |
| `end` | Cắt đến giây thứ mấy | > `start` | đến hết file |
| `fade_in` | Số giây âm thanh/hình to dần, sáng dần ở đầu đoạn | 0 – 10 | `0` |
| `fade_out` | Số giây nhỏ dần, tối dần ở cuối đoạn | 0 – 10 | `0` |
| `precise` | Cắt chính xác đến từng khung hình. Tắt đi thì cắt rất nhanh nhưng có thể lệch khoảng nửa giây | `true` / `false` | `true` |

### `media_concat` — Nối nhiều file thành một
- **Input:** `items` (danh sách video, hoặc danh sách audio, nối theo đúng thứ tự)
- **Output:** `media`

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `transition` | Cách chuyển giữa hai đoạn | `none` (nối thẳng), `crossfade` (đoạn trước mờ dần sang đoạn sau) | `none` |
| `transition_duration` | Thời gian chuyển, tính bằng giây | 0.1 – 3 | `0.5` |
| `fit_size` | Khi các video có kích thước khác nhau | `pad` (thêm viền đen cho vừa), `crop` (cắt bớt cho vừa) | `pad` |

### `media_mux` — Ghép hình + tiếng + phụ đề
- **Input:** `video` (video), `audio` (audio, có thể nhiều track), `subtitle` (subtitle, không bắt buộc)
- **Output:** `video`

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `length` | Khi hình và tiếng dài khác nhau thì theo cái nào | `fit_audio` (theo độ dài tiếng: hình ngắn thì lặp lại, dài thì cắt bớt), `fit_video`, `shortest` (cắt theo cái ngắn hơn) | `fit_audio` |
| `audio_offset` | Dời tiếng sớm hơn hoặc muộn hơn so với hình. Số âm là sớm hơn | -10 – 10 giây | `0` |
| `keep_original_audio` | Giữ tiếng gốc của video và trộn chung với tiếng mới | `true` / `false` | `false` |
| `original_volume` | Âm lượng tiếng gốc khi giữ lại | 0 – 100 % | `30` |
| `subtitle_language` | Ngôn ngữ của phụ đề. Phụ đề này bật/tắt được trong trình phát, không in lên hình | `vi`, `en`, … | `vi` |

### `media_burn_subtitle` — In phụ đề lên hình
In chữ thẳng vào video, xem ở đâu cũng thấy.
- **Input:** `video` (video), `subtitle` (subtitle: SRT hoặc ASS)
- **Output:** `video`

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `font` | Kiểu chữ (chỉ áp dụng cho SRT; ASS đã có sẵn kiểu chữ) | các font tiếng Việt có sẵn | `Be Vietnam Pro` |
| `size` | Cỡ chữ | `small`, `medium`, `large` | `medium` |
| `color` | Màu chữ | mã màu | `#FFFFFF` (trắng) |
| `outline` | Viền đen quanh chữ để dễ đọc trên nền sáng | `true` / `false` | `true` |
| `position` | Vị trí chữ | `bottom`, `middle`, `top` | `bottom` |
| `quality` | Chất lượng video xuất ra | `low`, `medium`, `high` | `high` |

---

## 2. Tách video (`video_*`)

### `video_demux` — Tách video thành từng phần
- **Input:** `video` (video)
- **Output:** `video` (hình, không tiếng), `audio` (tiếng), `subtitles` (danh sách phụ đề có sẵn trong file, nếu có), `info` (json)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `audio_format` | Định dạng file tiếng tách ra | `wav` (dễ xử lý tiếp nhất), `original` (giữ nguyên, nhanh nhất), `mp3` (nhẹ) | `wav` |
| `audio_track` | Chọn track tiếng nếu video có nhiều track (ví dụ nhiều ngôn ngữ) | `1`, `2`, … | `1` |
| `extract_subtitles` | Lấy luôn phụ đề có sẵn trong file | `true` / `false` | `true` |

### `video_scene_detect` — Tìm chỗ chuyển cảnh
- **Input:** `video` (video)
- **Output:** `scenes` (scene_list: thời điểm bắt đầu và kết thúc từng cảnh), `clips` (danh sách video, chỉ có khi bật `split_clips`)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `sensitivity` | Độ nhạy. Càng cao thì càng tìm được nhiều cảnh (kể cả chuyển cảnh nhẹ) | 1 – 100 | `50` |
| `min_scene_length` | Bỏ qua các cảnh ngắn hơn số giây này | 0.3 – 10 | `1` |
| `split_clips` | Cắt sẵn mỗi cảnh thành một file video riêng | `true` / `false` | `false` |

### `video_extract_frames` — Lấy ảnh từ video
- **Input:** `video` (video)
- **Output:** `frames` (image_sequence: danh sách ảnh kèm thời điểm)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `mode` | Cách lấy ảnh | `every` (đều đặn), `at_times` (tại các giây chỉ định), `per_scene` (mỗi cảnh một ảnh) | `every` |
| `interval` | Với `every`: cứ mấy giây lấy một ảnh | 0.1 – 60 | `1` |
| `times` | Với `at_times`: danh sách các giây, ví dụ `[3, 10.5, 42]` | | trống |
| `format` | Định dạng ảnh | `jpg` (nhẹ), `png` (nét, nặng) | `jpg` |
| `max_width` | Thu nhỏ ảnh nếu rộng hơn số điểm ảnh này | ví dụ `1280` | giữ nguyên |

### `video_thumbnail` — Chọn ảnh đại diện đẹp
Tự chọn khung hình rõ nét, không mờ, không rơi vào lúc chuyển cảnh.
- **Input:** `video` (video)
- **Output:** `images` (danh sách ảnh, xếp từ đẹp nhất)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `count` | Số ảnh gợi ý | 1 – 10 | `3` |
| `width` | Độ rộng ảnh | ví dụ `1280` | `1280` |
| `format` | Định dạng ảnh | `jpg`, `png` | `jpg` |

---

## 3. Tách và làm sạch âm thanh (`audio_*`)

### `audio_separate_stems` — Tách giọng hát / nhạc cụ
> **Đã thay bằng ba tool** (người dùng chọn model): `audio_vocals_leap_xe` (giọng + nhạc nền, BS-RoFormer Leap Xe), `audio_stems6_sw` (6 phần chất lượng cao, BS-RoFormer SW), `audio_stems6_htdemucs` (6 phần nhẹ máy, HTDemucs 6s, MIT). Output dùng tên `instrumental` thay cho `accompaniment`. Đặc tả dưới đây là bản kế hoạch ban đầu.
- **Input:** `audio` (audio)
- **Output:** `stems = 2`: `vocals` (giọng hát), `accompaniment` (nhạc nền). `stems = 4`: `vocals`, `drums` (trống), `bass`, `other` (phần còn lại). `stems = 6`: thêm `piano`, `guitar`.

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `stems` | Tách thành mấy phần | `2` (giọng + nhạc nền, dùng cho karaoke), `4`, `6` (tách từng nhạc cụ) | `2` |
| `quality` | Nhanh hay sạch | `fast` (nhanh, ít RAM, đôi chỗ còn lẫn), `balanced` (chậm hơn khoảng 2 lần, sạch hơn) | `fast` |
| `output_format` | Định dạng file kết quả | `wav` (chất lượng tốt nhất), `mp3` (nhẹ) | `wav` |

### `audio_vocal_cleanup` — Làm sạch giọng hát
Dùng sau khi tách giọng, để giọng "khô" và sạch hơn, giúp căn lời chính xác hơn.
- **Input:** `vocals` (audio)
- **Output:** `vocals` (audio)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `remove_reverb` | Bỏ tiếng vang (vang phòng, hiệu ứng vang của bản thu) | `true` / `false` | `true` |
| `remove_backing` | Bỏ tiếng bè, tiếng hát nền còn sót lại | `true` / `false` | `true` |
| `strength` | Mức làm sạch. Mạnh quá có thể làm giọng bị "méo" | `light`, `medium`, `strong` | `medium` |

### `audio_denoise` — Khử ồn nền
Bỏ tiếng ù, tiếng xì, tiếng quạt, tiếng xe của bản ghi âm.
- **Input:** `audio` (audio)
- **Output:** `audio` (audio)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `strength` | Mức khử. Càng cao càng sạch, nhưng giọng có thể bị "ngộp" | 0 – 100 | `60` |

### `audio_normalize` — Chỉnh độ to chuẩn
Làm cho bài nghe to vừa phải, đều với các bài khác trên cùng nền tảng, không bị rè.
- **Input:** `audio` (audio)
- **Output:** `audio` (audio)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `target` | Độ to theo nơi sử dụng | `streaming` (YouTube, Spotify, TikTok), `broadcast` (truyền hình, nhỏ hơn), `loud` (rất to, kiểu nhạc club), `custom` | `streaming` |
| `custom_loudness` | Chỉ dùng khi `target` = `custom`. Đơn vị đo độ to (LUFS); số càng gần 0 thì càng to. `-14` là mức của YouTube | -30 – -6 | `-14` |
| `peak_limit` | Mức đỉnh cao nhất cho phép, để tiếng không bị rè (dB). Thường không cần chỉnh | -3 – 0 | `-1` |

---

## 4. Phân tích nhạc (`music_*`)

### `music_beat_track` — Bắt nhịp bài hát
- **Input:** `audio` (audio)
- **Output:** `beats` (beat_grid): tốc độ bài (BPM, số phách mỗi phút), thời điểm từng phách, phách mạnh (phách đầu ô nhịp)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `bpm_hint` | Nếu đã biết tốc độ bài (ví dụ `120`) thì nhập vào để kết quả chính xác hơn | 40 – 240 | để trống, tự đoán |
| `time_signature` | Số phách trong một ô nhịp | `auto`, `4` (đa số bài hát), `3` (điệu valse) | `auto` |

### `music_vocal_activity` — Tìm đoạn có giọng hát
Đánh dấu đoạn nào đang hát và đoạn nào chỉ có nhạc (dạo đầu, gian tấu). Dùng để căn lời và hiện đếm ngược karaoke.
- **Input:** `vocals` (audio: giọng hát đã tách)
- **Output:** `ranges` (time_ranges): các đoạn, mỗi đoạn có nhãn `vocal` hoặc `instrumental`

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `sensitivity` | Độ nhạy. Cao: bắt cả tiếng hát nhỏ, tiếng ngân cuối câu. Thấp: chỉ đoạn hát rõ | 1 – 100 | `50` |
| `min_gap` | Lặng ngắn hơn số giây này vẫn tính là đang hát (lấy hơi giữa câu) | 0.2 – 3 | `0.8` |
| `padding` | Nới rộng mỗi đoạn hát về hai đầu thêm bấy nhiêu giây, tránh mất chữ đầu/cuối câu | 0 – 1 | `0.2` |

### `music_key_detect` — Xác định tông bài hát
- **Input:** `audio` (audio)
- **Output:** `info` (json): tông bài (ví dụ "La thứ – Am"), độ tin cậy, gợi ý tăng/giảm bao nhiêu nấc để giọng nam/nữ dễ hát

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `notation` | Cách ghi tên tông | `letter` (C, D, E…), `solfege` (Đô, Rê, Mi…), `both` | `both` |

### `music_sections` — Chia đoạn bài hát
- **Input:** `audio` (audio)
- **Output:** `sections` (time_ranges): các đoạn kèm nhãn (dạo đầu, phiên khúc, điệp khúc, cầu nối, kết)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `min_section` | Đoạn ngắn nhất, tính bằng giây | 4 – 30 | `8` |
| `labels_language` | Ngôn ngữ của nhãn | `vi` (Dạo đầu, Phiên khúc, Điệp khúc…), `en` (Intro, Verse, Chorus…) | `vi` |

### `music_pitch_track` — Đường cao độ giọng hát
Đo xem từng lúc ca sĩ hát nốt cao hay thấp. Dùng cho thanh cao độ hoặc chấm điểm karaoke sau này.
- **Input:** `vocals` (audio)
- **Output:** `pitch` (json): danh sách thời điểm, nốt và tần số

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `precision` | Nhanh hay chính xác | `fast`, `accurate` | `fast` |
| `step` | Cứ bao nhiêu giây đo một lần. Nhỏ hơn thì chi tiết hơn nhưng chậm hơn | 0.005 – 0.1 | `0.01` |

---

## 5. Lời bài hát và giọng nói (`speech_*`, `lyrics_*`)

### `speech_transcribe` — Chuyển giọng nói/hát thành chữ
- **Input:** `audio` (audio; với bài hát nên dùng giọng đã tách)
- **Output:** `transcript` (transcript): từng câu, từng chữ kèm thời gian

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `language` | Ngôn ngữ đang nói/hát | `vi`, `en`, `auto` (tự nhận) | `vi` |
| `model_size` | Bộ nhận dạng nhỏ hay lớn | `small` (nhanh, khoảng 1 GB RAM), `medium` (chính xác hơn, khoảng 2.5 GB RAM, chậm hơn 2–3 lần) | `small` |
| `content` | Loại nội dung, để tool tự điều chỉnh | `speech` (lời nói), `singing` (bài hát) | `speech` |
| `hint_words` | Danh sách từ hay gặp (tên riêng, tên bài, tên ca sĩ) để nhận dạng đúng hơn | ví dụ `["Sơn Tùng", "Hà Nội"]` | trống |

### `lyrics_import` — Nhập lời bài hát
- **Input:** `file` (không bắt buộc: LRC, SRT hoặc TXT) hoặc `transcript` (không bắt buộc, lấy từ `speech_transcribe`)
- **Output:** `lyrics` (timed_lyrics; nếu nhập từ văn bản thường thì chưa có thời gian)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `text` | Lời bài hát dán vào (dùng khi không có file) | văn bản | trống |
| `title`, `artist` | Tên bài, tên ca sĩ; hiện ở màn mở đầu video karaoke | văn bản | trống |
| `remove_notes` | Bỏ các dòng ghi chú không phải lời hát, ví dụ "[Điệp khúc]", "ĐK:", "x2", hợp âm | `true` / `false` | `true` |
| `expand_repeats` | Đoạn ghi "x2" hoặc "ĐK" được nhân ra đúng số lần hát thật | `true` / `false` | `true` |
| `max_line_length` | Dòng dài hơn số ký tự này được tự ngắt làm hai ở chỗ hợp lý | 20 – 80 | `40` |

### `lyrics_align` — Căn lời theo giọng hát
Tìm chính xác lúc ca sĩ hát từng chữ. Đây là phần quan trọng nhất của karaoke.
- **Input:** `vocals` (audio: giọng đã tách), `lyrics` (timed_lyrics), `ranges` (time_ranges, không bắt buộc: lấy từ `music_vocal_activity`, giúp căn nhanh và chính xác hơn)
- **Output:** `lyrics` (timed_lyrics: có thời gian từng dòng, từng chữ), `uncertain` (time_ranges: các đoạn tool chưa chắc, người dùng nên nghe lại)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `language` | Ngôn ngữ của lời | `vi`, `en` | `vi` |
| `granularity` | Căn đến từng chữ hay từng dòng | `word` (từng chữ, dùng cho karaoke), `line` (từng dòng, dùng cho phụ đề) | `word` |
| `precision` | Nhanh hay chính xác | `fast`, `accurate` | `accurate` |

### `lyrics_snap_to_beat` — Kéo lời vào đúng phách
Dời nhẹ thời gian chữ cho trùng phách nhạc, để chữ chạy "đúng nhịp" hơn.
- **Input:** `lyrics` (timed_lyrics), `beats` (beat_grid)
- **Output:** `lyrics` (timed_lyrics)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `target` | Kéo cái gì vào phách | `line_start` (chỉ chữ đầu câu), `every_word` (mọi chữ) | `line_start` |
| `max_shift` | Chỉ dời nếu phách gần nhất cách không quá số giây này, tránh làm lệch lời | 0.05 – 0.5 | `0.15` |
| `beat_type` | Dùng loại phách nào | `any` (mọi phách), `strong` (chỉ phách mạnh) | `any` |

### `lyrics_retime` — Chỉnh thời gian lời
- **Input:** `lyrics` (timed_lyrics)
- **Output:** `lyrics` (timed_lyrics)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `shift` | Dời toàn bộ lời sớm hơn hoặc muộn hơn. Số âm là sớm hơn | -30 – 30 giây | `0` |
| `speed` | Bài đã đổi tốc độ bao nhiêu lần thì nhập vào để lời khớp theo. Ví dụ bài nhanh lên 1.25 lần thì nhập `1.25` | 0.5 – 2 | `1` |
| `edits` | Các chỉnh sửa tay từ timeline. Giao diện tự điền, người dùng không phải nhập | | trống |

### `lyrics_export` — Xuất lời ra file
- **Input:** `lyrics` (timed_lyrics) hoặc `transcript` (transcript)
- **Output:** `file` (subtitle hoặc file lời)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `format` | Loại file | `srt` (phụ đề phổ biến nhất), `vtt` (phụ đề cho web), `lrc` (lời chạy theo dòng trên app nghe nhạc), `lrc_word` (lời chạy theo từng chữ), `txt` (chỉ lời), `json` | `srt` |
| `max_chars_per_line` | Số ký tự tối đa mỗi dòng phụ đề | 20 – 60 | `42` |
| `max_lines` | Số dòng tối đa mỗi lần hiện | `1`, `2` | `2` |
| `include_title` | Thêm tên bài và ca sĩ vào đầu file | `true` / `false` | `false` |

---

## 6. Xử lý nghệ thuật âm thanh

### `audio_mix` — Trộn nhiều track thành một
- **Input:** `tracks` (danh sách audio, ví dụ các stem đã tách)
- **Output:** `audio` (audio)

Mỗi track trong `tracks` có các chỉnh riêng sau:

| Tham số (từng track) | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `volume` | Âm lượng track | 0 – 200 % | `100` |
| `pan` | Lệch về loa trái hay phải | -100 (trái) … 0 (giữa) … 100 (phải) | `0` |
| `mute` | Tắt hẳn track này | `true` / `false` | `false` |
| `start` | Dời track này bắt đầu muộn hơn bao nhiêu giây | ≥ 0 | `0` |
| `fade_in`, `fade_out` | Số giây to dần ở đầu, nhỏ dần ở cuối | 0 – 10 | `0` |

| Tham số chung | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `length` | Độ dài bản trộn | `longest` (theo track dài nhất), `shortest`, `first` (theo track đầu tiên) | `longest` |
| `normalize` | Tự chỉnh độ to bản cuối cho chuẩn, tránh rè khi trộn nhiều track | `true` / `false` | `true` |

### `audio_pitch_shift` — Đổi tông (hạ/nâng tông)
- **Input:** `audio` (audio)
- **Output:** `audio` (audio, tốc độ giữ nguyên)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `semitones` | Hạ hay nâng bao nhiêu nấc. Một nấc bằng một phím đàn. Số âm là hạ tông. Nam hát bài của nữ thường cần hạ vài nấc, tùy giọng | -12 – 12 | `0` |
| `keep_voice_natural` | Giữ giọng tự nhiên, không bị "chíp chíp" khi nâng hay "ồm ồm" khi hạ nhiều | `true` / `false` | `true` |
| `quality` | Nhanh hay mượt | `fast`, `high` | `high` |

### `audio_time_stretch` — Đổi tốc độ bài
- **Input:** `audio` (audio)
- **Output:** `audio` (audio)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `speed` | Nhanh hay chậm bao nhiêu lần. `1.25` là nhanh hơn 25%, `0.8` là chậm hơn 20% | 0.5 – 2 | `1` |
| `target_bpm` | Hoặc nhập tốc độ mong muốn theo BPM; khi có giá trị này thì bỏ qua `speed` | 40 – 240 | trống |
| `keep_pitch` | Giữ nguyên tông. Tắt đi thì nhanh sẽ cao giọng, chậm sẽ trầm giọng (như tua băng cassette) | `true` / `false` | `true` |

### `audio_effects` — Hiệu ứng âm thanh
- **Input:** `audio` (audio)
- **Output:** `audio` (audio)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `effects` | Danh sách hiệu ứng, áp theo thứ tự. Mỗi hiệu ứng gồm `type` (loại, bảng dưới) và `amount` (độ mạnh) | | trống |
| `mix` | Trộn giữa bản gốc và bản có hiệu ứng. 100 là toàn bộ bản có hiệu ứng | 0 – 100 % | `100` |

| `type` | Nghe như thế nào | `amount` |
|---|---|---|
| `reverb` | Vang, như hát trong phòng lớn hay nhà thờ | 0 – 100 |
| `echo` | Tiếng vọng lặp lại, như hét trong hang | 0 – 100 |
| `bass` | Tăng/giảm tiếng trầm (bùm bùm) | -100 – 100 |
| `treble` | Tăng/giảm tiếng bổng (trong, sáng) | -100 – 100 |
| `compressor` | Làm tiếng đều hơn: đoạn nhỏ to lên, đoạn to nhỏ lại | 0 – 100 |
| `chorus` | Giọng dày, như nhiều người hát cùng | 0 – 100 |
| `lowpass` | Nghe bị bí, như vọng qua tường hay radio cũ | 0 – 100 |
| `highpass` | Bỏ tiếng ù trầm, nghe mỏng hơn | 0 – 100 |
| `bitcrush` | Rè rè kiểu nhạc game 8-bit | 0 – 100 |

### `audio_remix_preset` — Remix nhanh một chạm
- **Input:** `audio` (audio)
- **Output:** `audio` (audio)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `preset` | Kiểu remix | `slowed_reverb` (chậm + vang, buồn và mơ màng), `sped_up` (nhanh + cao giọng, kiểu TikTok), `nightcore` (rất nhanh, rất cao), `lofi` (ấm, hơi rè, nhẹ nhàng), `8d` (tiếng chạy vòng quanh đầu, nghe bằng tai nghe), `bass_boost` (trầm rất mạnh) | `slowed_reverb` |
| `intensity` | Độ mạnh của hiệu ứng | 0 – 100 | `50` |

---

## 7. Xử lý nghệ thuật video

### `video_beat_sync_edit` — Tự dựng video theo nhịp nhạc
- **Input:** `clips` (danh sách video, hoặc scene_list từ `video_scene_detect`), `beats` (beat_grid), `audio` (audio: nhạc nền)
- **Output:** `video` (video, dài bằng bài nhạc)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `cut_every` | Cứ bao nhiêu phách thì đổi cảnh một lần. 4 phách gần bằng 1 ô nhịp | `1`, `2`, `4`, `8` | `4` |
| `align_to_strong_beat` | Đổi cảnh đúng phách mạnh (đầu ô nhịp), nghe "đã" hơn | `true` / `false` | `true` |
| `clip_order` | Thứ tự dùng các clip | `in_order` (lần lượt), `random` (ngẫu nhiên), `longest_first` (clip dài trước) | `in_order` |
| `transition` | Kiểu chuyển cảnh | `cut` (cắt thẳng), `fade` (mờ dần), `zoom` (giật zoom), `flash` (chớp trắng) | `cut` |
| `follow_energy` | Đoạn nhạc sôi động (điệp khúc) thì đổi cảnh nhanh gấp đôi | `true` / `false` | `false` |
| `ratio` | Khung hình | `16:9` (ngang, YouTube), `9:16` (dọc, TikTok), `1:1` (vuông) | `16:9` |

### `video_color_grade` — Chỉnh màu
- **Input:** `video` (video), `lut` (lut, không bắt buộc: "bộ màu" .cube tải từ ngoài)
- **Output:** `video` (video)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `preset` | Màu có sẵn | `none`, `film` (màu phim), `vintage` (cũ, ngả vàng), `cinematic` (điện ảnh), `warm` (ấm), `cool` (lạnh), `black_white` (đen trắng) | `none` |
| `strength` | Độ mạnh của preset hoặc LUT | 0 – 100 % | `100` |
| `brightness` | Độ sáng | -100 – 100 | `0` |
| `contrast` | Độ tương phản (sáng ra sáng, tối ra tối) | -100 – 100 | `0` |
| `saturation` | Độ đậm màu. -100 là đen trắng | -100 – 100 | `0` |
| `temperature` | Tông ấm (ngả vàng) hay lạnh (ngả xanh) | -100 (lạnh) – 100 (ấm) | `0` |

### `video_effects` — Hiệu ứng hình
- **Input:** `video` (video), `beats` (beat_grid, không bắt buộc: cần cho hiệu ứng theo nhịp)
- **Output:** `video` (video)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `effects` | Danh sách hiệu ứng, mỗi hiệu ứng gồm `type` và `amount` (0 – 100) | bảng dưới | trống |

| `type` | Trông như thế nào |
|---|---|
| `grain` | Hạt li ti như phim nhựa |
| `vignette` | Tối dần ở bốn góc |
| `blur` | Làm mờ |
| `glitch` | Nhiễu sọc, giật hình như lỗi tín hiệu |
| `vhs` | Như băng video cũ: nhòe màu, sọc ngang |
| `shake_on_beat` | Rung hình theo nhịp (cần `beats`) |
| `zoom_on_beat` | Giật zoom theo nhịp (cần `beats`) |

### `video_speed` — Làm chậm / tua nhanh
- **Input:** `video` (video)
- **Output:** `video` (video)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `speed` | Tốc độ cho cả video. `0.5` là chậm một nửa, `2` là nhanh gấp đôi | 0.25 – 4 | `1` |
| `segments` | Đoạn có tốc độ riêng, mỗi đoạn gồm `start`, `end`, `speed`. Ví dụ làm chậm giây 10–12 | danh sách | trống |
| `smooth_slowmo` | Làm chậm mượt hơn bằng cách tạo thêm hình. Xử lý chậm hơn nhiều trên máy yếu | `true` / `false` | `false` |
| `audio` | Tiếng xử lý thế nào | `keep_pitch` (đổi tốc độ nhưng giọng không méo), `mute` (tắt tiếng) | `keep_pitch` |

### `video_reframe` — Đổi khung hình (ngang ↔ dọc)
- **Input:** `video` (video)
- **Output:** `video` (video)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `ratio` | Khung hình mới | `9:16` (dọc), `1:1` (vuông), `4:5` (Facebook/Instagram), `16:9` (ngang) | `9:16` |
| `fill` | Phần trống xử lý thế nào | `blur_background` (giữ nguyên hình, phía sau là nền mờ), `crop_center` (cắt lấy phần giữa), `crop_smart` (tự đi theo mặt người hoặc chỗ chuyển động), `black_bars` (viền đen) | `blur_background` |

> **Chèn logo, chữ, ảnh lên video** (trước đây là `video_overlay`) giờ thuộc nhóm dựng hình ở mục 9: `compose_add_layer` + `compose_render`. Cách này hỗ trợ đủ hẹn giờ, animation và chữ nghệ thuật.

### `video_from_images` — Tạo video từ ảnh
- **Input:** `images` (danh sách ảnh), `audio` (audio, không bắt buộc), `beats` (beat_grid, không bắt buộc)
- **Output:** `video` (video)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `fit_to_audio` | Có nhạc thì tự chia thời gian ảnh cho vừa đúng độ dài bài | `true` / `false` | `true` |
| `duration_per_image` | Mỗi ảnh hiện bao nhiêu giây (khi không tự chia theo nhạc) | 1 – 30 | `4` |
| `sync_to_beats` | Đổi ảnh đúng phách nhạc (cần `beats`) | `true` / `false` | `false` |
| `motion` | Chuyển động trên ảnh | `none` (đứng yên), `ken_burns` (zoom và trượt chậm, trông sống động hơn) | `ken_burns` |
| `transition` | Chuyển giữa các ảnh | `cut`, `fade` | `fade` |
| `ratio` | Khung hình | `16:9`, `9:16`, `1:1` | `16:9` |

### `video_audio_visualizer` — Hình động nhảy theo nhạc
Tạo video cho bài nhạc không có hình.
- **Input:** `audio` (audio), `background` (image, không bắt buộc)
- **Output:** `video` (video)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `style` | Kiểu hình | `bars` (cột nhảy theo nhạc), `waves` (sóng âm), `circle` (vòng tròn đập theo nhịp), `spectrum` (dải màu tần số) | `bars` |
| `color` | Màu | mã màu | `#FFFFFF` |
| `position` | Vị trí | `bottom`, `center` | `bottom` |
| `title` | Chữ hiện trên video (tên bài, ca sĩ) | văn bản | trống |
| `ratio` | Khung hình | `16:9`, `9:16`, `1:1` | `16:9` |

---

## 8. Karaoke (`karaoke_*`)

### `karaoke_render_subtitle` — Tạo chữ karaoke chạy theo lời
- **Input:** `lyrics` (timed_lyrics: lời đã căn thời gian)
- **Output:** `subtitle` (subtitle: file ASS)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `style` | Kiểu chữ có sẵn | `classic` (chữ trắng, đổi xanh khi hát), `neon` (phát sáng), `minimal` (đơn giản, gọn) | `classic` |
| `layout` | Cách xếp dòng | `two_lines` (2 dòng so le, kiểu karaoke quen thuộc), `one_line` | `two_lines` |
| `font` | Kiểu chữ | các font tiếng Việt có sẵn | `Be Vietnam Pro` |
| `size` | Cỡ chữ | `medium`, `large`, `x_large` | `large` |
| `color_before` | Màu chữ lúc chưa hát tới | mã màu | `#FFFFFF` |
| `color_after` | Màu chữ khi đã hát tới | mã màu | `#2F80ED` (xanh) |
| `countdown` | Hiện chấm đếm ngược trước khi vào lời, sau đoạn nhạc dạo dài | `true` / `false` | `true` |
| `lead_in` | Câu tiếp theo hiện trước bao nhiêu giây để người hát kịp đọc | 0.5 – 3 | `1` |
| `show_title` | Màn mở đầu hiện tên bài và ca sĩ | `true` / `false` | `true` |
| `ratio` | Khung video sẽ dùng, để căn vị trí chữ cho đẹp | `16:9`, `9:16` | `16:9` |
| `singer_colors` | Với bài song ca: màu riêng cho giọng nam, giọng nữ, cả hai (dòng nào ai hát do người dùng gán) | 3 mã màu | trống |

### `karaoke_compose` — Ghép thành video karaoke hoàn chỉnh
- **Input:** `background` (video hoặc ảnh), `music` (audio: nhạc nền), `subtitle` (subtitle: từ `karaoke_render_subtitle`), `guide` (audio, không bắt buộc: giọng ca sĩ gốc)
- **Output:** `video` (video karaoke)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `background_mode` | Nền phía sau chữ | `blurred` (video gốc làm mờ, chữ dễ đọc), `original` (video gốc), `image` (ảnh tĩnh), `visualizer` (hình nhảy theo nhạc) | `blurred` |
| `dim` | Làm tối nền để chữ nổi hơn | 0 – 100 % | `30` |
| `guide_volume` | Giữ giọng ca sĩ gốc ở mức nhỏ để dẫn người hát. 0 là tắt hẳn | 0 – 30 % | `0` |
| `export_preset` | Xuất cho đâu | `youtube_1080p`, `tiktok` (dọc), `tv_720p` (nhẹ, cho đầu karaoke và TV) | `youtube_1080p` |

> Muốn karaoke **nghệ thuật hơn** khả năng của ASS (chữ nảy theo phách, phát sáng từng chữ, chữ 3D, xếp chữ ngẫu nhiên…)? Dùng `compose_from_lyrics` + `compose_render` ở mục 9.

---

## 9. Dựng hình, chữ nghệ thuật và animation (`compose_*`)

Nhóm này làm việc trên **composition**: một "bản dựng" gồm nhiều lớp (video, ảnh, chữ, hình vẽ, sticker, lời bài hát, hình nhảy theo nhạc). **Mỗi lớp có giờ hiện, vị trí, kiểu dáng và chuyển động riêng.** Đặc tả đầy đủ (mọi loại lớp, mốc thời gian, keyframe, animation, chữ nghệ thuật): [COMPOSITION_FORMAT.md](COMPOSITION_FORMAT.md).

Cách dùng điển hình:

```
compose_create → compose_add_layer (lặp lại nhiều lần) / compose_from_lyrics / compose_apply_template
              → compose_beat_animate → (xem thử bằng compose_render_frame) → compose_render → video
```

### Cách hẹn giờ một lớp (dùng chung cho mọi tool `compose_*`)

Tham số `start` (bắt đầu lúc nào) và `duration` (hiện bao lâu) nhận **số giây** hoặc **mốc**. Giao diện có sẵn ô chọn mốc nên người dùng không phải gõ tay.

| Viết | Nghĩa |
|---|---|
| `12.5` | Giây 12.5 |
| `marker:chorus1` | Tại mốc tên "chorus1" (ví dụ Điệp khúc 1) |
| `beat:32` / `downbeat:8` | Đúng phách thứ 32 / phách mạnh thứ 8 |
| `lyric_line:5` | Lúc bắt đầu hát câu thứ 5 |
| `section:chorus` | Đầu đoạn điệp khúc đầu tiên |
| `after:title` | Ngay sau khi lớp `title` kết thúc |
| `duration`: `4` / `full` / `beats:16` / `until:marker:outro` | 4 giây / đến hết video / 16 phách / đến mốc "outro" |

Khi đổi nhạc hoặc căn lại beat, căn lại lời, các lớp gắn theo mốc **tự dời theo**.

### `compose_create` — Tạo bản dựng mới
- **Input:** `base` (video hoặc audio, không bắt buộc: lấy độ dài, kích thước, nhạc từ đây), `beats` (beat_grid, không bắt buộc), `lyrics` (timed_lyrics, không bắt buộc), `sections` (time_ranges, không bắt buộc). Ba input cuối dùng cho các mốc `beat:`, `lyric_line:`, `section:`.
- **Output:** `composition` (composition)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `ratio` | Khung hình | `16:9` (ngang), `9:16` (dọc), `1:1` (vuông), `4:5` | theo `base`, nếu không có thì `16:9` |
| `resolution` | Độ nét (chiều nhỏ của khung) | `720`, `1080`, `1440`, `2160` | `1080` |
| `fps` | Số hình mỗi giây | `24`, `25`, `30`, `60` | `30` |
| `duration` | Thời lượng (giây) | > 0 | theo `base`, nếu không có thì `10` |
| `background` | Màu nền | mã màu, hoặc `transparent` (trong suốt) | `#000000` |
| `base_as` | Dùng `base` thế nào | `background` (video/ảnh làm lớp nền, có tiếng thì làm nhạc), `audio_only` (chỉ lấy tiếng), `none` | `background` |

### `compose_add_layer` — Thêm một lớp (chữ, ảnh, video, hình, sticker…)
- **Input:** `composition` (composition), `source` (video / image / audio / font, không bắt buộc: nguồn cho lớp media)
- **Output:** `composition` (composition), `layer_id` (mã lớp vừa thêm)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `type` | Loại lớp | `text`, `image`, `video`, `shape`, `sticker`, `visualizer`, `lyrics`, `adjustment`, `particles` (P1) | `text` |
| `text` | Nội dung chữ (lớp `text`) | văn bản, xuống dòng bằng Enter | trống |
| `start` | **Bắt đầu hiện lúc nào** (xem bảng hẹn giờ) | giây hoặc mốc | `0` |
| `duration` | **Hiện trong bao lâu** | giây hoặc mốc | `3` (chữ), `full` (video nền) |
| `position` | Vị trí: 9 vị trí có sẵn, hoặc tọa độ `x,y` từ 0 đến 1 (0.5, 0.5 là chính giữa) | `top_left` … `bottom_right`, `center`, hoặc `{x, y}` | `center` |
| `scale` | To nhỏ | 10 – 500 % | `100` |
| `rotation` | Xoay nghiêng (độ) | -360 – 360 | `0` |
| `opacity` | Độ rõ | 0 – 100 % | `100` |
| `style` | Kiểu dáng: tên preset chữ nghệ thuật (`gold_luxury`, `neon_pink`…), kiểu chữ đã lưu, hoặc mô tả đầy đủ | xem COMPOSITION_FORMAT mục 8 | `classic_white` |
| `shape` | Hình (lớp `shape`) | `rect`, `rounded_rect`, `circle`, `star`, `heart`, `arrow`, `line`, `polygon` | `rect` |
| `animation_in` | Cách **xuất hiện** | `fade`, `fade_up`, `slide_left`, `zoom_in`, `pop_bounce`, `drop`, `blur_in`, `typewriter`, `letters_rise`, `scramble`, `handwrite`… | `fade` |
| `animation_in_duration` | Xuất hiện trong bao nhiêu giây | 0.1 – 5 | `0.5` |
| `animation_out` | Cách **biến mất** | như `animation_in` (bản `_out`), hoặc `none` | `fade` |
| `animation_out_duration` | Biến mất trong bao nhiêu giây | 0.1 – 5 | `0.4` |
| `animation_loop` | Chuyển động **lặp** lúc đang hiện | `none`, `float`, `pulse`, `glow_pulse`, `shake`, `swing`, `rotate`, `flicker`, `rainbow`, `wave`, `shimmer` | `none` |
| `split` | Chữ chạy **lần lượt** theo | `none` (cả khối), `char` (từng ký tự), `word` (từng tiếng), `line` (từng dòng) | `none` |
| `stagger` | Chữ sau chạy chậm hơn chữ trước bao nhiêu giây | 0.01 – 0.5 | `0.05` |
| `effects` | Hiệu ứng thêm: `glow`, `shadow`, `blur`, `outline`… mỗi cái có `amount` 0–100 | danh sách | trống |
| `layer_order` | Đặt lớp nằm trên cùng hay dưới cùng | `top`, `bottom` | `top` |

### `compose_edit_layer` — Sửa, xóa, nhân bản lớp; thêm chuyển động tự tạo
- **Input:** `composition` (composition)
- **Output:** `composition` (composition)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `layer_id` | Lớp cần sửa | mã lớp | (bắt buộc) |
| `action` | Làm gì | `update` (sửa thuộc tính), `delete` (xóa), `duplicate` (nhân bản), `shift_time` (dời thời gian), `bring_front` (đưa lên trên), `send_back` (đưa xuống dưới) | `update` |
| `changes` | Các thuộc tính cần đổi (dùng tên giống `compose_add_layer`, ví dụ `{"text": "...", "start": "beat:40"}`) | | trống |
| `shift` | Với `shift_time`: dời sớm (số âm) hoặc muộn bao nhiêu giây | -600 – 600 | `0` |
| `keyframes` | **Chuyển động tự tạo**: danh sách điểm mốc, mỗi điểm gồm `property` (vị trí, to nhỏ, xoay, độ rõ, màu, độ mờ…), `t` (giây tính từ lúc lớp bắt đầu), `value` và `ease` (`linear`, `ease_out`, `back`, `bounce`, `elastic`…) | xem COMPOSITION_FORMAT mục 5 | trống |
| `keyframes_mode` | Thêm vào keyframe đang có, hay thay hết | `merge`, `replace` | `merge` |

### `compose_from_lyrics` — Tạo video lời bài hát / karaoke nghệ thuật
Biến lời đã căn thời gian thành các lớp chữ chạy theo bài hát, với hiệu ứng nghệ thuật mà ASS không làm được.
- **Input:** `lyrics` (timed_lyrics; hoặc `subtitle` / `transcript`), `composition` (composition, không bắt buộc: không có thì tự tạo mới), `beats` (beat_grid, không bắt buộc)
- **Output:** `composition` (composition, đã thêm các lớp lời)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `mode` | Kiểu hiển thị | `lyric_video` (từng câu hiện nổi bật giữa màn, kiểu video lời TikTok/YouTube), `karaoke` (2 dòng, tô màu dần theo chữ đang hát), `subtitle` (phụ đề gọn ở dưới) | `lyric_video` |
| `style` | Kiểu chữ nghệ thuật | tên preset (xem COMPOSITION_FORMAT mục 8) | `classic_white` |
| `position` | Vị trí lời | `center`, `bottom`, `top` | `center` (`lyric_video`), `bottom` (còn lại) |
| `animation_in` | Mỗi câu xuất hiện thế nào | như `compose_add_layer` | `letters_rise` |
| `animation_out` | Mỗi câu biến mất thế nào | như `compose_add_layer` | `fade_up` |
| `syllable_effect` | Chữ **đang được hát tới** trông thế nào | `fill` (tô màu dần), `bounce` (nảy lên), `grow` (to lên), `glow` (phát sáng), `none` | `fill` |
| `color_after` | Màu của chữ đã hát tới | mã màu | theo `style` |
| `lines_on_screen` | Số câu hiện cùng lúc | `1`, `2` | `1` (`lyric_video`), `2` (`karaoke`) |
| `lead_in` | Câu hiện trước khi hát bao nhiêu giây | 0 – 3 | `0.6` |
| `beat_pulse` | Chữ khẽ "đập" theo phách (cần `beats`) | `true` / `false` | `false` |
| `emphasis_words` | Các chữ cần nhấn mạnh: to hơn, đổi màu, có hiệu ứng riêng | danh sách, ví dụ `["yêu", "mãi"]` | trống |
| `random_layout` | Mỗi câu một vị trí, góc nghiêng, cỡ chữ khác nhau cho sinh động | `true` / `false` | `false` |
| `show_title` | Mở đầu bằng tên bài và ca sĩ | `true` / `false` | `true` |
| `countdown` | Chấm đếm ngược trước khi vào lời sau đoạn nhạc dạo dài | `true` / `false` | `true` (`karaoke`), `false` (còn lại) |

### `compose_beat_animate` — Cho các lớp nhảy theo nhịp nhạc
- **Input:** `composition` (composition), `beats` (beat_grid)
- **Output:** `composition` (composition)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `layers` | Lớp nào được nhảy theo nhạc | danh sách mã lớp; trống = cả khung hình | trống |
| `effect` | Kiểu nhảy | `pulse` (phóng to nhẹ mỗi phách), `zoom_punch` (cả khung giật zoom), `shake` (rung), `flash` (chớp sáng), `rotate_tick` (xoay nhẹ qua lại), `color_cycle` (đổi màu mỗi phách) | `pulse` |
| `on` | Nhảy vào phách nào | `beat` (mọi phách), `downbeat` (phách mạnh), `every_n` (cứ n phách một lần) | `beat` |
| `every_n` | Với `every_n`: số phách | 2 – 16 | `2` |
| `amount` | Độ mạnh | 0 – 100 | `30` |
| `start`, `duration` | Chỉ nhảy trong một đoạn, ví dụ chỉ ở điệp khúc | giây hoặc mốc | cả bài |

### `compose_apply_template` — Dùng mẫu có sẵn
Chèn nhanh một khối dựng sẵn (nhiều lớp + animation), chỉ cần điền chữ hoặc ảnh.
- **Input:** `composition` (composition), `images` (danh sách ảnh, không bắt buộc: ảnh cho các ô ảnh của mẫu)
- **Output:** `composition` (composition)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `template` | Mẫu | `title_card` (màn tiêu đề), `lower_third` (tên người + chức danh ở góc dưới), `intro_logo` (logo xuất hiện mở đầu), `outro_subscribe` (màn kết, mời đăng ký kênh), `countdown` (đếm ngược 3-2-1), `quote_card` (trích dẫn), `chapter_title` (tên chương/đoạn) | `title_card` |
| `fields` | Nội dung điền vào mẫu, ví dụ `{"title": "Nơi Này Có Anh", "subtitle": "Sơn Tùng M-TP"}` | theo từng mẫu | trống |
| `start`, `duration` | Mẫu hiện lúc nào, bao lâu | giây hoặc mốc | `0`, theo mẫu |
| `style` | Đổi kiểu chữ của mẫu | tên preset | theo mẫu |
| `theme_color` | Màu chủ đạo của mẫu | mã màu | theo mẫu |

### `compose_text_art` — Làm chữ nghệ thuật riêng lẻ
Thiết kế một dòng chữ nghệ thuật và xuất ra ảnh nền trong suốt (PNG), hoặc video nền trong suốt nếu có animation. Kiểu chữ có thể lưu lại để dùng cho lớp chữ khác.
- **Input:** `font` (font, không bắt buộc: font tự tải lên), `texture` (image, không bắt buộc: ảnh làm "ruột" chữ)
- **Output:** `image` (ảnh PNG trong suốt) hoặc `video` (nếu chọn animation), `style` (text_style: kiểu chữ để dùng lại)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `text` | Chữ | văn bản | (bắt buộc) |
| `preset` | Bắt đầu từ kiểu có sẵn rồi chỉnh tiếp | xem COMPOSITION_FORMAT mục 8 | `classic_white` |
| `font`, `weight`, `size` | Kiểu chữ, độ đậm (100 mảnh – 900 rất đậm), cỡ chữ | | theo preset |
| `fill` | Màu chữ: một màu, chuyển màu (`colors` + `angle`), hoặc lấy ảnh `texture` | | theo preset |
| `strokes` | Viền, tối đa 3 lớp, mỗi lớp có `color` và `width` | | theo preset |
| `shadow` | Đổ bóng: `color`, độ lệch `x`/`y`, độ mờ `blur` | | theo preset |
| `glow` | Phát sáng: `color`, độ lan `radius`, độ mạnh `amount` | | theo preset |
| `extrude` | Nổi khối 3D: độ dày `depth`, `color`, hướng `angle` | | không |
| `warp` | Uốn chữ: `arc` (cong vòm), `wave` (lượn sóng), `bulge` (phồng), `circle` (chạy vòng tròn), kèm `amount` | | `none` |
| `animation` | Có thì xuất video: chọn preset `in` và `loop` | như `compose_add_layer` | không có |
| `duration` | Độ dài video (khi có animation) | 1 – 30 giây | `3` |
| `output_size` | Kích thước ảnh | `fit` (vừa khít chữ), hoặc `1920x1080`… | `fit` |

### `compose_render_frame` — Xem thử một khung hình
Vẽ nhanh khung hình tại một thời điểm để xem trước, dùng khi kéo thanh thời gian. Tool chạy sẵn (*warm*) nên phản hồi gần như ngay.
- **Input:** `composition` (composition)
- **Output:** `image` (image)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `time` | Thời điểm cần xem (giây) | 0 – thời lượng | (bắt buộc) |
| `quality` | Chất lượng xem thử | `draft` (nhanh), `high` (giống hệt bản xuất) | `draft` |
| `width` | Độ rộng ảnh xem thử | 320 – 3840 | `960` |

### `compose_render` — Xuất bản dựng thành video
- **Input:** `composition` (composition)
- **Output:** `video` (video)

| Tham số | Nghĩa là gì | Chọn được | Mặc định |
|---|---|---|---|
| `quality` | Chất lượng | `draft` (540p, nhanh, để xem thử), `standard`, `high` | `standard` |
| `range_start`, `range_end` | Chỉ xuất một đoạn, ví dụ để xem thử điệp khúc | giây hoặc mốc | cả video |
| `export_preset` | Xuất cho đâu | `youtube_1080p`, `tiktok`, `facebook`, `custom` (giữ theo khung của bản dựng) | `custom` |
| `include_audio` | Kèm âm thanh | `true` / `false` | `true` |
| `transparent` | Xuất video **nền trong suốt** (WebM/MOV) để chèn vào phần mềm dựng khác. Khung phải có nền `transparent` | `true` / `false` | `false` |
| `motion_blur` | Làm mờ chuyển động cho mượt, giống quay phim thật. Render chậm hơn khoảng 2 lần | `true` / `false` | `false` |

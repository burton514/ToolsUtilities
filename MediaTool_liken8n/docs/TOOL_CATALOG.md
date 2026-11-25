# Danh mục Tool — Đợt 1

> Mục tiêu đợt 1 là phục vụ trọn vẹn hai luồng sản phẩm, ưu tiên **tiếng Việt**, chạy được trên **máy 8 GB RAM không GPU**.
>
> - **Luồng A, Video nhạc mới:** video + nhạc → tách → xử lý nghệ thuật → ghép thành video nhạc mới
> - **Luồng B, Karaoke:** video bài hát → tách giọng → căn lời theo nhịp/thời gian → video karaoke

**Mức ưu tiên**
- **P0**: bắt buộc để hai luồng chạy được từ đầu đến cuối. Làm trước.
- **P1**: vẫn thuộc đợt 1, làm sau P0, giúp sản phẩm "đẹp" và linh hoạt hơn.

**RAM**: ước tính cho bài hát dài khoảng 4–5 phút, chạy trên CPU. Đây là con số để đặt `ram_mb` ban đầu; con số thật phải đo lại trong sandbox.

---

## 0. Nguyên tắc: viết một lần, dùng mọi nơi — không làm tool cho từng trường hợp đặc biệt

```
① Thành phần cơ bản (engine + schema)  ← viết 1 lần: Timing, Fill, Stroke, Shadow, Effect, Anim, keyframe theo đường dẫn
② Thư viện (dữ liệu)                    ← thêm bằng file: font, style chữ, preset chuyển động, LUT, Lottie, sticker, template
③ Tool chung (ít, tổng quát)            ← thao tác trên ① và ②
④ Chuỗi đã lưu / mini app               ← ghép ③ + template ở ② — là thứ người dùng bấm
```

- Mọi thứ **hiện lên hình** đều là một **Composition** ([COMPOSITION_FORMAT.md](COMPOSITION_FORMAT.md)) và chỉ có **một engine render**. Không tool nào tự vẽ.
- Thứ gì là **dữ liệu** (kiểu chữ, preset, mẫu, LUT, font) thì để dạng dữ liệu trong thư viện, không viết thành code hay thành tool.
- Tool chỉ dành cho việc có **thuật toán/model riêng** (tách nhạc, căn lời, tách nền…) hoặc **thao tác tổng quát** trên Composition.
- "Công cụ" người dùng thấy như *Làm thumbnail*, *Video karaoke*, *Phụ đề TikTok*, *Áp bộ lọc* là **chuỗi tool đã lưu** + template — không có code riêng.

### 0.1 Tool chung cho dựng hình (thay cho các tool riêng lẻ)

| Tool | Input → Output | Làm gì | Thay cho | Trạng thái |
|---|---|---|---|---|
| `compose_render` | `Composition` → video / ảnh tĩnh / chuỗi ảnh | Render bằng engine native (Skia + FFmpeg); chất lượng nháp/chuẩn/cao, nền trong suốt, xuất một đoạn | `compose_text_art`, `compose_render_frame`, `karaoke_compose`, `media_burn_subtitle`, render tiêu đề/thumbnail | **Đã có** (video MP4) |
| `compose_template` | template (Composition có chỗ trống `{{...}}`) + giá trị → `Composition` | Điền mẫu dựng sẵn từ thư viện | `compose_create`, `compose_apply_template`, `title_card`, `video_from_images`, `thumbnail_maker` | Chưa làm |
| `compose_edit` | `Composition` + danh sách thao tác → `Composition` | Thêm/xóa/sắp lớp, đặt thuộc tính theo đường dẫn, áp style/animation/effect từ thư viện, đặt `timing` | `compose_add_layer`, `compose_edit_layer`, `video_color_grade`, `video_effects`, `video_speed`, `video_reframe`, `image_adjust`, `image_lut` | Chưa làm |
| `compose_bind` | `Composition` + `TimedData` + template cho từng mục → `Composition` | Mỗi mục dữ liệu có thời gian (dòng lời, từ, âm tiết, beat, cảnh) sinh lớp/chuyển động neo theo `data.start/end` | `compose_from_lyrics`, `karaoke_render_subtitle`, `subtitle_style`, `compose_beat_animate`, `video_beat_sync_edit` | Chưa làm |

**Thư viện hiệu ứng (đã có, 47 gói):** bộ màu, phim, glitch, biến dạng, xóa phông xanh, chuyển cảnh… là gói dữ liệu SkSL trong `library/effects/` ([LIBRARY.md](LIBRARY.md)), áp cho mọi lớp hoặc qua lớp điều chỉnh — thay cho `video_color_grade`, `video_effects` và mọi tool "áp bộ lọc".

API dùng chung đã có: `POST /v1/preview/frame` (render một khung + thời gian đã giải), `POST /v1/composition/prepare` (chuẩn hóa dạng cũ + giải mốc thời gian).

### 0.2 Tool tính toán (thuật toán/model riêng) — output là kiểu dữ liệu chung

| Tool | Output | Ghi chú |
|---|---|---|
| `segment` | Mặt nạ (ảnh/video) — dùng làm `mask` cho mọi lớp | Tách nền ảnh và video chung một tool (rmbg/u2net qua ONNX, CPU) |
| `upscale` | Ảnh/video nét hơn | Real-ESRGAN nhẹ qua ONNX, `heavy = true` |
| `track_motion` | `TimedData` vị trí → gắn cho mọi lớp bám theo | OpenCV CSRT |
| `library_import` | Mục thư viện (font, style, preset, LUT, Lottie, sticker, template) | Mỗi loại tự khai báo cách kiểm tra (vd font phải đủ dấu tiếng Việt). Thay cho `font_install`, `lottie_import` |
| `music_beat_track`, `video_scene_detect`, `music_vocal_activity`, `speech_transcribe`, `lyrics_align`, `audio_separate_stems`… | `TimedData` / file | Như danh sách ở mục 2 |

**Kiểu dữ liệu có thời gian thống nhất — `TimedData`:** `{ items: [ { start, end, payload, children? } ] }` (dòng → từ → âm tiết). `Transcript`, `TimedLyrics`, `BeatGrid`, `SceneList`, `TimeRanges` đều là `TimedData` (có thể kèm metadata riêng), nên `compose_bind` chỉ viết một lần cho mọi loại. Beat/cảnh cũng nạp thẳng thành `markers` của Composition để neo thời gian.

---

## 1. Luồng sản phẩm → tool

### Luồng B — Karaoke (P0 hoàn toàn)
```
video bài hát
  └─ video_demux ──┬─► video gốc (không tiếng) ─────────────────────────────┐
                   └─► audio ─► audio_separate_stems (2 stems)               │
                                 ├─► instrumental ─► [audio_pitch_shift] ──┐ │
                                 └─► vocals ─┬─► music_vocal_activity      │ │
                                             │                             │ │
     lời bài hát (dán vào) ─► lyrics_import ─┤  (không có lời thì dùng     │ │
                                             │   speech_transcribe ra nháp)│ │
                                             └─► lyrics_align ─► TimedLyrics │
  audio ─► music_beat_track ─► BeatGrid ─► [lyrics_snap_to_beat]       │   │ │
                                                                       ▼   ▼ ▼
                                   karaoke_render_subtitle ─► ASS ─► karaoke_compose ─► MP4 karaoke
```

### Luồng A — Video nhạc mới
```
video nguồn ─► video_demux ─► video_scene_detect ─► SceneList (các clip)
nhạc ─► audio_separate_stems (4/6 stems) ─► stems
                 │
     xử lý nghệ thuật: audio_effects · audio_remix_preset · audio_time_stretch · audio_pitch_shift
                 ▼
        audio_mix ─► bản nhạc mới ─► music_beat_track ─► BeatGrid
                                              │
 SceneList + BeatGrid ─► video_beat_sync_edit ─► video_color_grade / video_effects ─► video dựng
                                                                                       │
 compose_create(video dựng + nhạc mới + beats + lyrics)                                ▼
   ─► compose_apply_template (màn tiêu đề) ─► compose_add_layer (logo, chữ nghệ thuật, sticker, hẹn giờ theo mốc)
   ─► compose_from_lyrics (lời chạy nghệ thuật) ─► compose_beat_animate (nhảy theo nhịp ở điệp khúc)
   ─► compose_render ─► MP4
```

**Karaoke nghệ thuật** (thay cho bước ASS ở Luồng B): `compose_create` → `compose_from_lyrics (mode = karaoke)` → `compose_beat_animate` → `compose_render`.

---

## 2. Danh sách tool

> Input, **tham số** và output chi tiết của từng tool (viết dễ hiểu cho cả người không làm kỹ thuật): xem [TOOL_SPECS.md](TOOL_SPECS.md).

### 2.1 Nhập, xuất, tiện ích (`media.*`)

| ID | Ưu tiên | Input → Output | Chức năng | Công nghệ | RAM |
|---|---|---|---|---|---|
| `media_probe` | P0 | file → `JsonData` | Đọc thông tin: thời lượng, codec, độ phân giải, fps, sample rate, các track | ffprobe | < 100 MB |
| `media_transcode` | P0 | video/audio → video/audio | Đổi định dạng, codec, bitrate, fps, sample rate. Có **preset xuất** cho YouTube, TikTok, Facebook, Zalo | FFmpeg | < 300 MB |
| `media_trim` | P0 | video/audio → video/audio | Cắt đoạn theo thời gian, có fade in/out | FFmpeg | < 200 MB |
| `media_concat` | P1 | nhiều video/audio → một file | Nối file, có crossfade | FFmpeg | < 300 MB |
| `media_mux` | P0 | video + audio(s) + subtitle → video | Ghép luồng. Tùy chọn khớp độ dài: `shortest`, `loop_video`, `cut_to_audio`. Hỗ trợ offset audio và soft-sub | FFmpeg | < 300 MB |
| `media_burn_subtitle` | P0 | video + SRT/ASS → video | Hardsub, có font tiếng Việt kèm theo | FFmpeg + libass | < 500 MB |

### 2.2 Tách video (`video.*`)

| ID | Ưu tiên | Input → Output | Chức năng | Công nghệ | RAM |
|---|---|---|---|---|---|
| `video_demux` | P0 | video → video (không tiếng), audio, subtitle(s), `JsonData` | Tách tất cả các luồng. Mặc định không re-encode | FFmpeg | < 200 MB |
| `video_scene_detect` | P0 | video → `SceneList` (+ clip tùy chọn) | Phát hiện chuyển cảnh, có thể cắt sẵn thành từng clip | PySceneDetect | < 500 MB |
| `video_extract_frames` | P1 | video → `ImageSequence` | Trích frame theo fps hoặc theo mốc thời gian | FFmpeg | < 300 MB |
| `video_thumbnail` | P1 | video → ảnh | Chọn khung hình đẹp (độ nét cao, không nằm ở cảnh chuyển) làm thumbnail | FFmpeg + OpenCV | < 500 MB |

### 2.3 Tách và làm sạch audio (`audio.*`)

| ID | Ưu tiên | Input → Output | Chức năng | Công nghệ | RAM |
|---|---|---|---|---|---|
| `audio_separate_stems` | P0 | audio → vocals, instrumental **hoặc** vocals, drums, bass, (piano, guitar), other | Tách 2/4/6 stems. Có chế độ `fast` cho máy yếu (segment nhỏ, 1 shift) | Demucs (htdemucs / htdemucs_6s) | 1.5–3 GB |
| `audio_vocal_cleanup` | P1 | vocals → vocals | Khử vang (dereverb), khử echo, khử tiếng bè còn sót. Vocal sạch giúp căn lời chính xác hơn | Model MDX/UVR qua `audio-separator` | 1–2 GB |
| `audio_denoise` | P1 | audio → audio | Khử ồn nền (ghi âm, live) | DeepFilterNet | < 1 GB |
| `audio_normalize` | P0 | audio → audio | Chuẩn hóa độ to theo LUFS (ví dụ −14 cho YouTube/Spotify) | FFmpeg `loudnorm` (2 pass) | < 200 MB |

### 2.4 Phân tích nhạc (`music.*`)

| ID | Ưu tiên | Input → Output | Chức năng | Công nghệ | RAM |
|---|---|---|---|---|---|
| `music_beat_track` | P0 | audio → `BeatGrid` | BPM, vị trí beat và downbeat (phách mạnh), số chỉ nhịp | Beat This! (model nhỏ, CPU), dự phòng librosa | < 1 GB |
| `music_vocal_activity` | P0 | vocals → `TimeRanges` | Tìm các đoạn có giọng hát và đoạn nhạc dạo (để làm countdown karaoke và cắt đoạn trước khi căn lời) | Ngưỡng năng lượng trên stem vocals + Silero VAD | < 300 MB |
| `music_key_detect` | P1 | audio → `JsonData` | Xác định tông (ví dụ "La thứ"). Dùng để gợi ý hạ hoặc nâng tông karaoke | librosa / Essentia | < 500 MB |
| `music_sections` | P1 | audio → `TimeRanges` có nhãn | Chia đoạn intro / verse / chorus / bridge / outro | Self-similarity + beat (librosa) | < 1 GB |
| `music_pitch_track` | P1 | vocals → `JsonData` (đường F0) | Đường cao độ giọng hát, dùng cho thanh cao độ hoặc chấm điểm karaoke sau này | torchcrepe (tiny) / pYIN | < 1 GB |

### 2.5 Lời, giọng nói, tiếng Việt (`lyrics.*`, `speech.*`)

| ID | Ưu tiên | Input → Output | Chức năng | Công nghệ | RAM |
|---|---|---|---|---|---|
| `speech_transcribe` | P0 | audio → `Transcript` | Phiên âm có **timestamp từng từ**. Mặc định tiếng Việt, tự nhận diện được ngôn ngữ khác. Dùng để tạo lời nháp khi người dùng không có lời | faster-whisper (CTranslate2, int8); model: PhoWhisper (bản chuyển sang CT2) hoặc Whisper `small`/`medium` | 1–2.5 GB |
| `lyrics_import` | P0 | text / LRC / SRT / `Transcript` → `TimedLyrics` (có thể chưa có thời gian) | Nhập lời từ nhiều nguồn và tách dòng. Bỏ các dòng ghi chú như "[Điệp khúc]", "ĐK:", "x2"; đánh dấu đoạn lặp | Python | < 100 MB |
| `lyrics_align` | P0 | vocals + `TimedLyrics` → `TimedLyrics` (có thời gian từng dòng và **từng âm tiết**) | **Forced alignment**, trái tim của karaoke. Căn thời gian trên từng đoạn (dùng kết quả của `music_vocal_activity`) để chịu được bài dài và nhạc dạo dài | CTC forced alignment: wav2vec2 tiếng Việt hoặc MMS (torchaudio) | 1–2 GB |
| `lyrics_snap_to_beat` | P1 | `TimedLyrics` + `BeatGrid` → `TimedLyrics` | Căn đầu câu (và tùy chọn từng chữ) theo beat gần nhất trong một ngưỡng cho phép. Giúp chữ chạy "đúng nhịp" hơn | Python | < 100 MB |
| `lyrics_retime` | P1 | `TimedLyrics` → `TimedLyrics` | Dịch toàn bộ (offset), co giãn theo tempo mới (sau `audio_time_stretch`), sửa thời gian theo danh sách chỉnh tay | Python | < 100 MB |
| `lyrics_export` | P0 | `TimedLyrics` / `Transcript` → LRC / Enhanced LRC / SRT / VTT / JSON | Xuất lời. SRT có quy tắc ngắt dòng cho tiếng Việt (tối đa số ký tự mỗi dòng, không ngắt giữa cụm từ) | Python | < 100 MB |

### 2.6 Xử lý nghệ thuật audio

| ID | Ưu tiên | Input → Output | Chức năng | Công nghệ | RAM |
|---|---|---|---|---|---|
| `audio_mix` | P0 | nhiều audio/stem → audio | Trộn stems: gain, pan, mute, offset, fade, giữ một phần vocal làm "giọng dẫn" cho karaoke | FFmpeg `amix` / numpy | < 500 MB |
| `audio_pitch_shift` | P0 | audio → audio | Đổi tông theo nửa cung (−6 … +6), giữ nguyên tempo. Karaoke cần để hạ hoặc nâng tông | Rubber Band (`rubberband` filter của FFmpeg) | < 500 MB |
| `audio_time_stretch` | P1 | audio → audio | Đổi tempo, giữ nguyên tông | Rubber Band | < 500 MB |
| `audio_effects` | P1 | audio → audio | Chuỗi hiệu ứng: EQ, compressor, reverb, delay, chorus, low/high-pass, bitcrush. Mỗi hiệu ứng là một bước trong danh sách params | FFmpeg audio filters | < 500 MB |
| `audio_remix_preset` | P1 | audio → audio | Preset phổ biến: **slowed + reverb**, **speed up / nightcore**, **lofi**, **8D**, bass boost | Kết hợp time_stretch + effects | < 500 MB |

### 2.7 Xử lý nghệ thuật video

| ID | Ưu tiên | Input → Output | Chức năng | Công nghệ | RAM |
|---|---|---|---|---|---|
| `video_beat_sync_edit` | P0 | nhiều clip / `SceneList` + `BeatGrid` + audio → video | **Tự dựng video theo nhịp**: cắt chuyển cảnh trên beat/downbeat, chọn clip theo quy tắc (lần lượt, ngẫu nhiên, ưu tiên clip dài), chuyển cảnh (cut, fade, zoom) | FFmpeg filtergraph | < 1 GB |
| `video_color_grade` | P1 | video → video | Áp LUT `.cube`, chỉnh sáng, tương phản, bão hòa, nhiệt độ màu; có preset (film, vintage, cinematic, đen trắng) | FFmpeg `lut3d`, `eq` | < 500 MB |
| `video_effects` | P1 | video → video | Hạt phim, vignette, blur, glitch, VHS, rung theo beat (nhận `BeatGrid` tùy chọn) | FFmpeg filters | < 800 MB |
| `video_speed` | P1 | video → video | Slow motion / tua nhanh theo đoạn | FFmpeg `setpts` | < 500 MB |
| `video_reframe` | P1 | video → video | Đổi tỉ lệ 16:9 ↔ 9:16 ↔ 1:1, nền mờ hoặc crop theo vùng có chuyển động hoặc khuôn mặt | FFmpeg + OpenCV | < 1 GB |
| `video_from_images` | P1 | ảnh(s) + audio → video | Tạo video nền từ ảnh: slideshow, hiệu ứng Ken Burns (zoom/pan chậm). Dùng khi không có video gốc | FFmpeg `zoompan` | < 800 MB |
| `video_audio_visualizer` | P1 | audio (+ ảnh nền) → video | Sóng âm, phổ tần, vòng tròn nhịp theo nhạc | FFmpeg `showwaves`, `showspectrum`, `showcqt` | < 800 MB |

### 2.8 Karaoke (`karaoke.*`)

| ID | Ưu tiên | Input → Output | Chức năng | Công nghệ | RAM |
|---|---|---|---|---|---|
| `karaoke_render_subtitle` | P0 | `TimedLyrics` + style → ASS | Sinh phụ đề karaoke: **chữ đổi màu chạy theo từng âm tiết** (`\kf`), 2 dòng so le, hiện trước câu kế tiếp, **chấm đếm ngược** khi sắp vào lời, màn tiêu đề (tên bài, ca sĩ), tách màu theo giọng nam/nữ/song ca (gán tay). Font tiếng Việt kèm theo | Python sinh ASS | < 100 MB |
| `karaoke_compose` | P0 | nền (video/ảnh) + instrumental + [vocals dẫn] + ASS → MP4 | Ghép thành video karaoke hoàn chỉnh: chọn nền (video gốc, video gốc làm mờ, ảnh, visualizer), giọng dẫn nhỏ (0–30%), preset xuất | FFmpeg + libass | < 800 MB |

### 2.9 Dựng hình, chữ nghệ thuật và animation

Toàn bộ nhóm này **gộp vào 4 tool chung** ở mục 0.1 (`compose_render`, `compose_template`, `compose_edit`, `compose_bind`). Chữ nghệ thuật, chuyển động theo dòng/từ/chữ cái, nhảy theo beat, karaoke tô màu theo âm tiết, tiêu đề, thumbnail… đều là **dữ liệu** (Composition + thư viện), không phải tool riêng. Đặc tả: [COMPOSITION_FORMAT.md](COMPOSITION_FORMAT.md).

Các tool ở 2.7 (`video_color_grade`, `video_effects`, `video_speed`, `video_reframe`, `video_from_images`) và 2.8 (`karaoke_render_subtitle`, `karaoke_compose`) cùng `media_burn_subtitle` **không viết thành tool riêng** nữa: chúng là chuỗi đã lưu dùng `compose_edit` / `compose_bind` / `compose_template` + `compose_render`.

**Số tool thật sự phải viết giảm mạnh** nhờ gộp: các tool dựng hình/hiệu ứng/phụ đề ở 2.7–2.9 thành 4 tool chung + chuỗi đã lưu.

---

## 3. Lưu ý riêng cho tiếng Việt

Các helper dùng chung này đặt trong **SDK** (`mediatool_sdk.vi`), không đặt trong tool. Như vậy mọi tool xử lý tiếng Việt giống nhau và không phải copy code của nhau.

- **Chuẩn hóa Unicode NFC**: văn bản copy từ web thường lẫn kiểu dựng sẵn (NFC) và kiểu tổ hợp (NFD). Nếu không chuẩn hóa, font hiển thị lỗi dấu và so khớp chữ sai.
- **Thống nhất vị trí dấu thanh**: `hoà`/`hòa`, `thuỷ`/`thủy`. Giữ nguyên kiểu người dùng nhập để hiển thị, chỉ chuẩn hóa nội bộ khi căn lời.
- **Hai bản văn bản**: *bản hiển thị* (giữ nguyên lời gốc) và *bản phát âm* dùng để căn lời. Bản phát âm chuyển số thành chữ ("2" → "hai", "100" → "một trăm"), đọc từ viết tắt và từ tiếng Anh hay gặp trong lời bài hát.
- **Tiếng Việt đơn âm tiết**: mỗi chữ cách nhau bởi khoảng trắng là một âm tiết. Điều này rất thuận lợi cho karaoke: `TimedLyrics` lưu thời gian theo **âm tiết**, và mỗi âm tiết được tô màu riêng.
- **Hát khác nói**: phiên âm và căn lời trên giọng hát kém chính xác hơn trên giọng nói (âm kéo dài, luyến láy, bè). Vì vậy luồng chuẩn là **tách vocal → (khử vang) → căn lời trên từng đoạn có giọng**, không chạy thẳng trên bản nhạc gốc. Desktop cần có **trình chỉnh lời theo thời gian** (UI, không phải tool) để người dùng sửa tay, kết quả đưa vào `lyrics_retime`.
- **Font**: đóng gói vài font hỗ trợ đầy đủ tiếng Việt và có license mở (ví dụ Be Vietnam Pro, Montserrat, Roboto, Noto Sans) để ASS render đúng dấu trên mọi máy.
- **Phương ngữ và giọng hát**: model phiên âm tiếng Việt làm tốt nhất với giọng Bắc và Nam chuẩn. Giọng Trung, hát chèo hay cải lương có thể kém chính xác hơn, nên ghi rõ trong README của tool.

---

## 4. Kiểu asset cần thêm vào SDK

| Kiểu | Nội dung |
|---|---|
| `Transcript` | `language`, `segments[]` → `words[]` gồm `text`, `start`, `end`, `confidence` |
| `TimedLyrics` | `lines[]` gồm `text_display`, `text_spoken`, `start`, `end`, `singer?`, `syllables[]` (`text`, `start`, `end`); metadata bài hát (tên, ca sĩ) |
| `BeatGrid` | `bpm`, `time_signature`, `beats[]`, `downbeats[]` |
| `SceneList` | `scenes[]` gồm `start`, `end`, `clip?` (VideoFile) |
| `TimeRanges` | `ranges[]` gồm `start`, `end`, `label?` |
| `FontFile`, `LutFile` | File font, file LUT `.cube` |
| `Composition` | Bản dựng nhiều lớp: canvas, audio, markers, layers (thời gian, transform, style, animation, keyframes, bindings). Xem [COMPOSITION_FORMAT.md](COMPOSITION_FORMAT.md) |
| `TextStyle` | Kiểu chữ nghệ thuật đã lưu: font, fill, strokes, shadows, glow, extrude, warp |

---

## 5. License — phải kiểm tra trước khi dùng thương mại

Cột `license` của từng model trong `manifest.toml` là bắt buộc, vì một số model hoặc thư viện có điều khoản hạn chế:

| Thành phần | Ghi chú |
|---|---|
| Demucs, faster-whisper, Whisper | MIT, thoải mái |
| PhoWhisper, các model wav2vec2 tiếng Việt, MMS | **Nhiều bản có license phi thương mại (CC-BY-NC)**. Phải kiểm tra từng model trước khi chọn làm mặc định |
| Model tách trong `audio-separator` (MDX/UVR) | License khác nhau theo từng model |
| Rubber Band | GPL (có bản license thương mại trả phí) |
| FFmpeg | LGPL; thành GPL khi build kèm libx264/librubberband |
| PySceneDetect, librosa, libass | BSD / ISC, thoải mái |

Nếu sau này cần dùng thương mại hoàn toàn, mỗi tool nên có tùy chọn model thay thế có license mở.

---

## 6. Để sang đợt 2 (nặng hoặc cần GPU)

Upscale video, nội suy khung hình, xóa nền video, đổi giọng (voice conversion / AI cover), TTS tiếng Việt, dịch lời song ngữ, chấm điểm karaoke, nhận diện người hát (song ca tự động), tạo ảnh/video bằng AI. Các tool này vẫn theo đúng hợp đồng tool hiện tại, chỉ khai báo `gpu = "required"` hoặc `heavy = true`.

---

## 7. Thứ tự làm gợi ý

1. **Nền tảng** (người làm SDK làm cùng lúc): `media_probe`, `video_demux`, `media_mux`, `media_transcode`, `media_trim`, `audio_normalize`
2. **Tách**: `audio_separate_stems`, `music_beat_track`, `music_vocal_activity`
3. **Lời**: `lyrics_import`, `speech_transcribe`, `lyrics_align`, `lyrics_export`
4. **Karaoke chạy được trọn luồng**: `karaoke_render_subtitle`, `karaoke_compose`, `audio_pitch_shift`, `media_burn_subtitle`
5. **Video nhạc chạy được trọn luồng**: `audio_mix`, `video_scene_detect`, `video_beat_sync_edit`
6. **Dựng hình nghệ thuật**: engine native (Rust + Skia + FFmpeg) và `compose_render` **đã có**; tiếp theo `compose_edit`, `compose_template`, `compose_bind`, rồi thư viện (`library_import`) và `segment`
6. **P1**, chia theo nhóm cho nhiều người làm song song (mỗi tool một thư mục, không đụng nhau)

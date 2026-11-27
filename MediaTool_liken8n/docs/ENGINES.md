# Engine nền tảng — không tự dựng phần xử lý nặng

> **Quy tắc:** mọi xử lý cần hiệu năng native (giải mã/mã hóa, dựng hình, hiệu ứng, tách nhạc, nhận dạng giọng…) phải dùng **thư viện mã nguồn mở đã được kiểm chứng**. Code của tool chỉ là **lớp vỏ mỏng**: nhận input, chuyển đổi định dạng, gọi engine, trả output.
>
> Chỉ tự viết khi không có thư viện phù hợp, và phải ghi rõ lý do trong README của tool.

## 1. Cách đưa engine vào dự án

| Cách | Khi nào | Ví dụ |
|---|---|---|
| **Gói có sẵn bản build** (pip wheel, apt, npm) | Mặc định | `av` (PyAV), `faster-whisper`, `demucs`, `ffmpeg` (apt) |
| **Bản build phát hành chính thức** (release binary) | Engine C++ không có gói Python tốt | `whisper.cpp`, `rubberband` CLI |
| **Crate Rust bọc thư viện native** | Engine trong core Rust | `ffmpeg-the-third`, `skia-safe` |
| **Vendor source (git submodule)** | Chỉ khi buộc phải sửa engine | Tránh dùng |

- Engine được cài theo **runtime profile** (`profiles/base`, `profiles/torch-cpu`, `profiles/media-pro`…), không cài riêng trong từng tool. Tool khai báo `profile` trong manifest.
- **Ghim phiên bản** (pin) cho mọi engine. Nâng phiên bản bằng PR riêng, có chạy lại toàn bộ test của các tool dùng engine đó.
- **License** của engine và model ghi trong `[dependencies]` / `[[models]]` của manifest. Bảng license tổng hợp ở mục 4.

## 2. Engine chọn cho từng mảng

### 2.1 Giải mã, mã hóa, xử lý luồng

| Engine | Vai trò | Ghi chú |
|---|---|---|
| **FFmpeg** (libavcodec, libavformat, libavfilter) | Chuẩn công nghiệp: demux, mux, transcode, cắt, nối, filter hình/tiếng, loudnorm, burn phụ đề | Mọi tool `media_*`, `video_*` dùng FFmpeg |
| **PyAV** (`av`, bọc libav*) | Đọc/ghi **từng khung hình** trong Python, không cần ống qua subprocess | Dùng khi tool cần xử lý frame (dựng hình, phân tích) |
| **libass** | Render phụ đề ASS/karaoke (`\k`, `\kf`, `\t`, `\move`…) chất lượng cao, rất nhanh | Dùng qua FFmpeg `subtitles`/`ass` filter |

### 2.2 Dựng hình theo timeline, chữ nghệ thuật, animation (`compose_*`)

**Engine render native viết bằng Rust** (`core/crates/engine`, binary `mediatool-render`), theo kiến trúc của [Concat](https://github.com/jub0t/Concat): engine tách khỏi giao diện, **một đường render dùng chung cho xem trước và xuất file**, lập kế hoạch khung thuần dữ liệu. Phần nặng đều là thư viện native đã được kiểm chứng:

| Thư viện | Vai trò | Vì sao |
|---|---|---|
| **FFmpeg** qua [`ffmpeg-the-third`](https://crates.io/crates/ffmpeg-the-third) (libavformat, libavcodec, swscale) | Giải mã video, seek, đổi sang RGBA đúng kích thước cần hiển thị; decoder giữ mở giữa các khung | Chuẩn công nghiệp; cũng là lựa chọn của Concat |
| **FFmpeg CLI** | Mã hóa H.264/AAC (`libx264`), cắt/dời/chỉnh âm lượng/trộn tiếng các lớp (`atrim`, `adelay`, `volume`, `amix`) | Ổn định, đủ codec, không phải tự viết mux/mix |
| **Skia** qua [`skia-safe`](https://crates.io/crates/skia-safe) (feature `textlayout`) | Ghép lớp, biến đổi, độ rõ, blur, color matrix, gradient; chữ dàn trang bằng Skia Paragraph (HarfBuzz + ICU) | Engine đồ họa của Chrome/Android; dấu tiếng Việt luôn đúng; có backend GPU khi cần |
| **libass** *(sau)* | Lớp lời/karaoke hiệu năng cao | Nhanh hơn vẽ từng chữ |
| **Skottie** (trong Skia) *(sau)* | Animation Lottie (template After Effects/LottieFiles) | Không phải tự viết animation phức tạp |

```
Composition JSON ─► plan (anim + keyframe, thuần dữ liệu) ─► Skia ghép lớp ─┬─► JPEG + khung bao  (POST /v1/preview/frame)
        nguồn video ─► FFmpeg decode + swscale ──────────────────────────────┘
                                                                            └─► RGBA ─pipe─► FFmpeg libx264 + amix ─► MP4  (tool compose_render)
```

- **Xem trước:** core giữ một luồng render riêng với Renderer sống lâu (decoder mở sẵn), nên kéo timeline chỉ tốn vài chục ms mỗi khung.
- **Xuất file:** tool `compose_render` (Python, lớp vỏ mỏng) gọi `mediatool-render export`, đọc tiến độ JSON-lines.
- **Sau này:** backend GPU (Skia Ganesh/Graphite hoặc wgpu như Concat), giải mã phần cứng (VAAPI/D3D11VA qua FFmpeg).

**Đã cân nhắc và không chọn:**

| Hướng | Lý do |
|---|---|
| Dùng thẳng crate của Concat | License AGPL-3.0 → cả MediaTool phải theo AGPL |
| MLT (`melt`) | Ổn định nhưng khó nhúng cho xem trước tương tác, không chia sẻ được đường render với preview |
| Remotion (React) | Cần Chromium headless (tốn RAM trên máy 8 GB); license thương mại cho công ty trên 3 người |
| Motion Canvas / Revideo | Render qua trình duyệt; chưa hợp làm engine timeline |
| MoviePy | Thuần Python, chậm với video dài |

### 2.3 Âm thanh

| Engine | Vai trò | Ghi chú |
|---|---|---|
| **Demucs** (htdemucs, htdemucs_6s) | Tách 2/4/6 stems | MIT |
| **python-audio-separator** (model UVR: MDX-Net, BS/Mel-Roformer) | Tách vocal chất lượng cao, khử vang, khử bè (`audio_vocal_cleanup`) | Code MIT; **license từng model khác nhau** |
| **Rubber Band Library** | Đổi tông, đổi tốc độ chất lượng cao | GPL hoặc license thương mại. Phương án LGPL: **SoundTouch** (chất lượng thấp hơn) |
| **DeepFilterNet** | Khử ồn | MIT/Apache |
| **Spotify Pedalboard** | Chuỗi hiệu ứng (reverb, compressor, chorus, EQ…) chất lượng studio | GPLv3. Phương án khác: filter âm thanh của FFmpeg |
| **FFmpeg loudnorm** / **pyloudnorm** | Chuẩn hóa độ to (EBU R128) | |

### 2.4 Phân tích nhạc

| Engine | Vai trò | Ghi chú |
|---|---|---|
| **Beat This!** (CPJKU) | Bắt beat và downbeat, chạy được trên CPU | MIT |
| **librosa** | Tông, cao độ (pYIN), chia đoạn, dự phòng cho beat | ISC |
| **Silero VAD** | Phát hiện đoạn có giọng | MIT |
| **torchcrepe** | Đường cao độ chính xác cao | MIT |

### 2.5 Giọng nói và lời

| Engine | Vai trò | Ghi chú |
|---|---|---|
| **faster-whisper** (CTranslate2) | Phiên âm, timestamp từng từ; int8 trên CPU | MIT. Model: Whisper (MIT), PhoWhisper (kiểm tra license) |
| **whisper.cpp** (ggml, C++) | Phương án nhẹ nhất cho máy yếu / không có Python nặng | MIT |
| **WhisperX** / CTC forced alignment (torchaudio) | Căn lời theo từng từ/âm tiết | Code BSD; **model căn lời tiếng Việt thường là CC-BY-NC** |

### 2.6 Hình ảnh và video (phân tích, nâng cấp)

| Engine | Vai trò | Ghi chú |
|---|---|---|
| **PySceneDetect** | Phát hiện chuyển cảnh | BSD |
| **OpenCV** | Chọn thumbnail, crop thông minh, nhận mặt | Apache 2.0 |
| **Real-ESRGAN-ncnn-vulkan**, **RIFE-ncnn** *(đợt 2)* | Upscale, nội suy khung hình (native, có GPU thì nhanh) | MIT |

## 3. Ánh xạ tool → engine

| Tool | Engine |
|---|---|
| `media_*`, `video_demux`, `video_extract_frames`, `video_speed`, `video_reframe`, `media_burn_subtitle` | FFmpeg (+ libass) |
| `video_scene_detect`, `video_thumbnail` | PySceneDetect, OpenCV |
| `video_beat_sync_edit`, `video_color_grade`, `video_effects`, `video_from_images` | Engine render (Skia + FFmpeg), filter FFmpeg |
| `audio_vocals_leap_xe`, `audio_stems6_sw` | BS-RoFormer (`mediatool_sdk.bs_roformer`: numpy + onnxruntime, đọc checkpoint PyTorch không cần torch) |
| `audio_stems6_htdemucs` | HTDemucs 6s (ONNX, onnxruntime) |
| `audio_vocal_cleanup` | python-audio-separator (UVR) |
| `audio_denoise` | DeepFilterNet |
| `audio_normalize` | FFmpeg loudnorm |
| `audio_pitch_shift`, `audio_time_stretch` | Rubber Band |
| `audio_effects`, `audio_remix_preset` | Pedalboard (hoặc filter FFmpeg) + Rubber Band |
| `audio_mix` | FFmpeg `amix` |
| `music_beat_track` | Beat This!, dự phòng librosa |
| `music_vocal_activity` | Silero VAD |
| `music_key_detect`, `music_sections`, `music_pitch_track` | librosa, torchcrepe |
| `speech_transcribe` | faster-whisper (hoặc whisper.cpp) |
| `lyrics_align` | CTC forced alignment (torchaudio / WhisperX) |
| `karaoke_render_subtitle`, `karaoke_compose` | Sinh ASS + libass, FFmpeg |
| `compose_render`, `compose_render_frame` | Engine render native: Skia + FFmpeg (`mediatool-render`) |
| `compose_text_art` | Skia |

`lyrics_import`, `lyrics_export`, `lyrics_snap_to_beat`, `lyrics_retime` và các tool `compose_*` sửa dữ liệu là xử lý dữ liệu thuần (JSON, văn bản), không cần engine native.

## 4. License cần lưu ý khi dùng thương mại

| Mức | Engine |
|---|---|
| Thoải mái (MIT, BSD, Apache, ISC) | ffmpeg-the-third (WTFPL), skia-safe (MIT), PyAV, Skia/Skottie, libass, Demucs, faster-whisper, whisper.cpp, Beat This!, Silero VAD, librosa, PySceneDetect, OpenCV, DeepFilterNet |
| LGPL (dùng được, giữ dạng thư viện động) | FFmpeg (bản build không kèm thành phần GPL), SoundTouch |
| **GPL** (ảnh hưởng tới cách phân phối app) | Rubber Band, Pedalboard, FFmpeg build kèm x264/rubberband |
| **Phi thương mại** (CC-BY-NC) | Nhiều model căn lời và phiên âm tiếng Việt, một số model UVR, model của madmom |

Nếu sau này cần thương mại hóa, mỗi tool dùng engine GPL hoặc model phi thương mại phải có phương án thay thế khai báo sẵn.

Phương án thay thế đã khai báo:

| Tool / module | Phần GPL / phi thương mại | Thay thế |
|---|---|---|
| `lyrics_align` | model `song` (nguyenvulebinh/lyric-alignment, CC-BY-NC-4.0) — mặc định | `engine = general`: wav2vec2-large-xlsr-53 tiếng Việt (Apache-2.0), cùng đường xử lý |
| `speech_zipformer_30m`, `speech_zipformer_150m` | model ZipFormer của hynt (CC-BY-NC-ND-4.0) | `speech_transcribe` (PhoWhisper BSD-3 / Whisper MIT), cùng output nên thay thẳng trong chuỗi |
| `audio_vocals_leap_xe` | model BS-RoFormer Leap Xe (pcunwa) — repo không ghi giấy phép | `audio_stems6_htdemucs` (HTDemucs 6s, MIT): cùng output `vocals` / `instrumental` nên thay thẳng trong chuỗi |
| `audio_stems6_sw` | model BS-RoFormer SW (jarredou) — không ghi giấy phép | `audio_stems6_htdemucs` (MIT): cùng 7 output |
| `mediatool_sdk.speech.stretch` (`speech_synthesize`, `speech_dub`) | Rubber Band (GPL) qua FFmpeg | `atempo` của FFmpeg (LGPL) — tự dùng khi bản FFmpeg không có Rubber Band |

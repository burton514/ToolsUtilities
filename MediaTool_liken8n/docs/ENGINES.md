# Engine nền tảng — không tự dựng phần xử lý nặng

> **Quy tắc:** mọi xử lý cần hiệu năng native (giải mã/mã hóa, dựng hình, hiệu ứng, tách nhạc, nhận dạng giọng…) phải dùng **thư viện mã nguồn mở đã được kiểm chứng**. Code của tool chỉ là **lớp vỏ mỏng**: nhận input, chuyển đổi định dạng, gọi engine, trả output.
>
> Chỉ tự viết khi không có thư viện phù hợp, và phải ghi rõ lý do trong README của tool.

## 1. Cách đưa engine vào dự án

| Cách | Khi nào | Ví dụ |
|---|---|---|
| **Gói có sẵn bản build** (pip wheel, apt, npm) | Mặc định | `av` (PyAV), `faster-whisper`, `demucs`, `ffmpeg` (apt) |
| **Bản build phát hành chính thức** (release binary) | Engine C++ không có gói Python tốt | `melt` (MLT), `whisper.cpp`, `rubberband` CLI |
| **Build từ source trong Docker** | Cần bật tùy chọn build đặc biệt | FFmpeg kèm libass + librubberband, MLT kèm plugin |
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

Thay vì tự viết bộ dựng, `compose_render` **dịch composition JSON sang định dạng của engine** rồi gọi engine render:

| Engine | Vai trò trong MediaTool | Vì sao |
|---|---|---|
| **MLT Framework** (C++, LGPL) | **Engine dựng timeline chính**: nhiều track, cắt ghép, transition, keyframe vị trí/to nhỏ/độ rõ, filter màu, trộn tiếng, xuất qua FFmpeg | Engine của Kdenlive và Shotcut; chạy tốt trên CPU; có CLI `melt` và định dạng dự án MLT XML |
| **Skia** (Google, BSD) qua `skia-python` | Vẽ **chữ nghệ thuật** (gradient, nhiều lớp viền, bóng, phát sáng, uốn chữ, dàn chữ chuẩn bằng HarfBuzz) thành lớp ảnh/chuỗi ảnh trong suốt để MLT ghép | Engine đồ họa của Chrome và Android; dấu tiếng Việt luôn đúng |
| **Skottie** (trong Skia) hoặc **rlottie** (Samsung, C++) | Render **animation Lottie** (xuất từ After Effects / LottieFiles): chữ chạy từng ký tự, sticker động, intro/outro, lower third | Kho template Lottie miễn phí rất lớn; không phải tự viết animation |
| **libass** | Lớp lời/karaoke khi cần hiệu năng cao (`lyrics` layer kiểu `karaoke`) | Render nhanh hơn nhiều so với vẽ từng chữ bằng Skia |

Composition → engine:

```
Composition JSON ──compose_render──► MLT XML (track, clip, transition, filter, keyframe)
        │                                   ▲
        ├─ lớp text nghệ thuật ──Skia──► PNG sequence / video alpha ─┘
        ├─ lớp animation Lottie ──Skottie/rlottie──► video alpha ─┘
        └─ lớp lyrics karaoke ──► ASS ──libass (filter của MLT/FFmpeg)─┘
                                    melt ──► FFmpeg encode ──► MP4
```

**Đã cân nhắc và không chọn làm engine chính:**

| Engine | Lý do |
|---|---|
| Remotion (React) | Cần Chromium headless (tốn RAM trên máy 8 GB); license thương mại cho công ty trên 3 người |
| Motion Canvas / Revideo | Cũng render qua trình duyệt; hợp cho motion graphics viết bằng code, chưa hợp làm engine timeline |
| GStreamer Editing Services | Mạnh nhưng nặng và khó triển khai hơn MLT cho nhu cầu này |
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
| `video_beat_sync_edit`, `video_color_grade`, `video_effects`, `video_from_images` | MLT (dựng, transition, filter, LUT), FFmpeg |
| `audio_separate_stems` | Demucs |
| `audio_vocal_cleanup` | python-audio-separator (UVR) |
| `audio_denoise` | DeepFilterNet |
| `audio_normalize` | FFmpeg loudnorm |
| `audio_pitch_shift`, `audio_time_stretch` | Rubber Band |
| `audio_effects`, `audio_remix_preset` | Pedalboard (hoặc filter FFmpeg) + Rubber Band |
| `audio_mix` | FFmpeg `amix` / MLT |
| `music_beat_track` | Beat This!, dự phòng librosa |
| `music_vocal_activity` | Silero VAD |
| `music_key_detect`, `music_sections`, `music_pitch_track` | librosa, torchcrepe |
| `speech_transcribe` | faster-whisper (hoặc whisper.cpp) |
| `lyrics_align` | CTC forced alignment (torchaudio / WhisperX) |
| `karaoke_render_subtitle`, `karaoke_compose` | Sinh ASS + libass, FFmpeg |
| `compose_render`, `compose_render_frame` | MLT + Skia + Skottie/rlottie + libass |
| `compose_text_art` | Skia |

`lyrics_import`, `lyrics_export`, `lyrics_snap_to_beat`, `lyrics_retime` và các tool `compose_*` sửa dữ liệu là xử lý dữ liệu thuần (JSON, văn bản), không cần engine native.

## 4. License cần lưu ý khi dùng thương mại

| Mức | Engine |
|---|---|
| Thoải mái (MIT, BSD, Apache, ISC) | PyAV, Skia/Skottie, libass, Demucs, faster-whisper, whisper.cpp, Beat This!, Silero VAD, librosa, PySceneDetect, OpenCV, DeepFilterNet |
| LGPL (dùng được, giữ dạng thư viện động) | FFmpeg (bản build không kèm thành phần GPL), MLT, SoundTouch |
| **GPL** (ảnh hưởng tới cách phân phối app) | Rubber Band, Pedalboard, FFmpeg build kèm x264/rubberband |
| **Phi thương mại** (CC-BY-NC) | Nhiều model căn lời và phiên âm tiếng Việt, một số model UVR, model của madmom |

Nếu sau này cần thương mại hóa, mỗi tool dùng engine GPL hoặc model phi thương mại phải có phương án thay thế khai báo sẵn.

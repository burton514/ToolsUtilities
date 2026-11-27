# Third-party notices

MediaTool dùng và bê một phần mã/thiết kế từ các dự án mã nguồn mở dưới đây.

## Thư viện native (phụ thuộc, không sửa)

| Thư viện | License | Dùng ở |
|---|---|---|
| [FFmpeg](https://ffmpeg.org) | LGPL-2.1+ (bản Debian kèm libx264 → GPL khi phân phối) | Giải mã, mã hóa, trộn tiếng (engine, tool) |
| [ffmpeg-the-third](https://github.com/shssoichiro/ffmpeg-the-third) | WTFPL | Binding Rust của FFmpeg (engine) |
| [Skia](https://skia.org) / [skia-safe](https://github.com/rust-skia/rust-skia) | BSD-3-Clause / MIT | Ghép lớp, chữ, hiệu ứng (engine) |
| [React Flow (@xyflow/react)](https://github.com/xyflow/xyflow) | MIT | Trình nối tool thành chuỗi (sandbox) |

## Model AI (tải lần đầu theo `[[models]]`, kiểm sha256, không kèm trong bộ cài)

| Model | License | Dùng ở |
|---|---|---|
| [Whisper](https://github.com/openai/whisper) `base` / `small`, bản CTranslate2 của [Systran/faster-whisper](https://github.com/SYSTRAN/faster-whisper) | MIT | `speech_transcribe` |
| [PhoWhisper](https://github.com/VinAIResearch/PhoWhisper) small / medium (VinAI Research), bản CTranslate2 chỉ chuyển định dạng | BSD-3-Clause | `speech_transcribe` (tiếng Việt) |
| [lyric-alignment](https://huggingface.co/nguyenvulebinh/lyric-alignment) (nguyenvulebinh, Zalo AI 2022), bản ONNX int8 | **CC-BY-NC-4.0 — phi thương mại** | `lyrics_align` engine `song` |
| [wav2vec2-large-xlsr-53-vietnamese](https://huggingface.co/not-tanh/wav2vec2-large-xlsr-53-vietnamese) (not-tanh; nền XLSR-53 của Meta), bản ONNX int8 | Apache-2.0 | `lyrics_align` engine `general` |
| [ZipFormer-30M-RNNT-6000h](https://huggingface.co/hynt/Zipformer-30M-RNNT-6000h) và [ZipFormer-150M-CR-CTC-RNNT-6000h](https://huggingface.co/hynt/ZipFormer-150M-CR-CTC-RNNT-6000h) (hynt) — tải nguyên file gốc, không sửa | **CC-BY-NC-ND-4.0 — phi thương mại, không phân phối bản sửa đổi** | `speech_zipformer_30m`, `speech_zipformer_150m` |
| [Beat This!](https://github.com/CPJKU/beat_this) `small` (CPJKU, JKU Linz), bản xuất ONNX kèm LICENSE MIT gốc | MIT | `music_beat_track` |
| [BS-RoFormer Leap Xe](https://huggingface.co/pcunwa/BS-Roformer-Leap) (pcunwa) — checkpoint gốc `Xe/bs_leap_xe_voc.ckpt`, `Xe/bs_leap_xe_inst.ckpt`, không sửa | **Không ghi giấy phép — chưa dùng thương mại** | `audio_vocals_leap_xe` |
| BS-RoFormer SW 6 stem `BS-Rofo-SW-Fixed` (jarredou; tài khoản gốc đã xóa, tải bản sao nguyên byte [koidn/BS-RoFormer-SW-6stem](https://huggingface.co/koidn/BS-RoFormer-SW-6stem)) | **Không ghi giấy phép — chưa dùng thương mại** | `audio_stems6_sw` |
| [HTDemucs 6s](https://github.com/facebookresearch/demucs) (Meta), bản ONNX [StemSplitio/htdemucs-6s-onnx](https://huggingface.co/StemSplitio/htdemucs-6s-onnx) | MIT | `audio_stems6_htdemucs` |
| [VieNeu-TTS](https://github.com/pnnbao97/VieNeu-TTS) v3 Turbo / Nano (Phạm Nguyễn Ngọc Bảo) | Apache-2.0 | `speech_synthesize`, `speech_dub`, `speech_voice_add` |
| [MOSS-Audio-Tokenizer-Nano](https://huggingface.co/OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX) (OpenMOSS) | Apache-2.0 | codec của VieNeu v3 Turbo |

Thư viện chạy model: [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0), [vieneu](https://pypi.org/project/vieneu/) (Apache-2.0, cài không kèm gradio/torch), [sea-g2p](https://github.com/pnnbao97/sea-g2p) (Apache-2.0), [Rubber Band](https://breakfastquay.com/rubberband/) qua FFmpeg (GPL), [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT), [CTranslate2](https://github.com/OpenNMT/CTranslate2) (MIT), [ONNX Runtime](https://github.com/microsoft/onnxruntime) (MIT), [ONNX](https://github.com/onnx/onnx) (Apache-2.0), [NumPy](https://numpy.org) (BSD-3-Clause). Kiến trúc BS-RoFormer (`mediatool_sdk.bs_roformer`) viết lại bằng numpy + onnxruntime theo [lucidrains/BS-RoFormer](https://github.com/lucidrains/BS-RoFormer) (MIT) và [ZFTurbo/Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training) (MIT), đối chiếu số với code gốc; cách chạy theo đoạn theo `demix` của ZFTurbo. Đặc trưng log-mel của `music_beat_track` viết lại bằng numpy theo bài báo / cấu hình huấn luyện Beat This!, không chép mã.

## Mã/thiết kế bê từ OpenCut

Nguồn: [OpenCut-app/opencut-classic](https://github.com/OpenCut-app/opencut-classic) — MIT License.

| Phần | File gốc | Chỗ dùng trong MediaTool |
|---|---|---|
| Hình học mask: sao, tim, kim cương, dải phim | `apps/web/src/masks/builtin/definitions/*.ts` | `core/crates/engine/src/render.rs` (`draw_mask`) |
| Giải easing cubic-bezier bằng chia đôi | `apps/web/src/animation/bezier.ts` | `core/crates/engine/src/anim.rs` (`cubic_bezier`) |
| Preset easing | `apps/web/src/timeline/components/graph-editor/easing-presets.ts` | `packages/editor/src/model.ts` (`BEZIER_PRESETS`) |
| Giới hạn tốc độ | `apps/web/src/retime/rate.ts` | `packages/editor/src/model.ts` (`SPEED`) |
| Preset zoom xem trước | `apps/web/src/preview/zoom.ts` | `packages/editor/src/Preview.tsx` |
| Ý tưởng khung giao diện TikTok/Reels/Shorts | `apps/web/src/guides/definitions/*` | `packages/editor/src/Preview.tsx` (`PLATFORM_ZONES`) |

```
MIT License

Copyright 2025-2026 OpenCut

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Chỉ tham khảo kiến trúc (không copy mã)

- [lyric-alignment](https://github.com/nguyenvulebinh/lyric-alignment) — Apache-2.0: phương pháp căn lời (CTC-segmentation, đổi chữ viết → cách đọc, kéo dài chữ tới chữ sau tối đa 3 s); viết lại bằng numpy trong `mediatool_sdk.align` / `lyrics_align`.

- [Concat](https://github.com/jub0t/Concat) — AGPL-3.0: cách tách engine khỏi giao diện, một đường render cho xem trước và xuất file.
- [PhotoCraft](https://github.com/storytold/photocraft) — MIT/Apache-2.0: sổ lệnh dùng chung cho UI/CLI/MCP.

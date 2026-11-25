# Third-party notices

MediaTool dùng và bê một phần mã/thiết kế từ các dự án mã nguồn mở dưới đây.

## Thư viện native (phụ thuộc, không sửa)

| Thư viện | License | Dùng ở |
|---|---|---|
| [FFmpeg](https://ffmpeg.org) | LGPL-2.1+ (bản Debian kèm libx264 → GPL khi phân phối) | Giải mã, mã hóa, trộn tiếng (engine, tool) |
| [ffmpeg-the-third](https://github.com/shssoichiro/ffmpeg-the-third) | WTFPL | Binding Rust của FFmpeg (engine) |
| [Skia](https://skia.org) / [skia-safe](https://github.com/rust-skia/rust-skia) | BSD-3-Clause / MIT | Ghép lớp, chữ, hiệu ứng (engine) |
| [React Flow (@xyflow/react)](https://github.com/xyflow/xyflow) | MIT | Trình nối tool thành chuỗi (sandbox) |

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

- [Concat](https://github.com/jub0t/Concat) — AGPL-3.0: cách tách engine khỏi giao diện, một đường render cho xem trước và xuất file.
- [PhotoCraft](https://github.com/storytold/photocraft) — MIT/Apache-2.0: sổ lệnh dùng chung cho UI/CLI/MCP.

//! mediatool-engine: Composition → khung hình → video.
//!
//! Engine dựa hoàn toàn trên thư viện native đã được kiểm chứng:
//! - **FFmpeg** (`ffmpeg-the-third`: libavformat/libavcodec/swscale) — giải mã, seek, đổi định dạng điểm ảnh;
//!   FFmpeg CLI — mã hóa H.264/AAC, trộn tiếng.
//! - **Skia** (`skia-safe`, engine đồ họa của Chrome/Android) — ghép lớp, chữ (HarfBuzz/ICU), gradient, blur, color matrix.
//!
//! Code ở đây chỉ là mô hình dữ liệu (model), tính animation (anim) và lập kế hoạch khung (render) —
//! một đường render duy nhất dùng chung cho xem trước và xuất file.

pub mod anim;
pub mod export;
pub mod media;
pub mod model;
pub mod prepare;
pub mod render;
pub mod style;
pub mod text;

pub use export::{export, ExportOptions, Quality};
pub use model::Composition;
pub use render::{Bounds, Rendered, Renderer};

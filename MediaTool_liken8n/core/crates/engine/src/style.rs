//! Thành phần tô/viền/bóng dùng chung cho MỌI loại lớp (chữ, hình, ảnh, video) — viết một lần ở đây.
//! - `fill_paint`: màu đơn / gradient tuyến tính, tròn, xoay vòng / ảnh họa tiết → Skia Paint.
//! - `layer_filter`: bóng đổ, phát sáng, neon, bóng dài, nổi khối, viền theo hình dạng điểm ảnh → chuỗi Skia ImageFilter
//!   áp lên toàn bộ nội dung lớp (nên chữ, hình, ảnh, video dùng chung đúng một cách).

use crate::model::{parse_color, Fill, FillSpec, Shadow, Stop, Stroke};
use skia_safe::{
    color_filters, gradient_shader, image_filters, BlendMode, Color, Color4f, Image, ImageFilter, Matrix, Paint, Point, Rect,
    SamplingOptions, Shader, TileMode,
};
use std::collections::HashMap;

pub type Images = HashMap<String, Image>;

pub fn color(s: &str) -> Color {
    let (r, g, b, a) = parse_color(s);
    Color::from_argb(a, r, g, b)
}

fn with_opacity(c: Color, opacity: f64) -> Color {
    c.with_a(((c.a() as f64) * (opacity / 100.0).clamp(0.0, 1.0)).round() as u8)
}

fn stops(stops: &[Stop]) -> (Vec<Color>, Option<Vec<f32>>) {
    let cols = stops.iter().map(|s| match s { Stop::Color(c) | Stop::At { color: c, .. } => color(c) }).collect::<Vec<_>>();
    let has_pos = stops.iter().any(|s| matches!(s, Stop::At { .. }));
    let pos = has_pos.then(|| {
        let n = stops.len().max(2) as f32 - 1.0;
        stops.iter().enumerate().map(|(i, s)| match s { Stop::At { pos, .. } => (*pos as f32).clamp(0.0, 1.0), _ => i as f32 / n }).collect()
    });
    (cols, pos)
}

/// Màu đại diện của một Fill (dùng cho gạch chân, viền ảnh…).
pub fn fill_color(f: &Fill) -> Color {
    match f {
        Fill::Color(c) | Fill::Spec(FillSpec::Solid { color: c }) => color(c),
        Fill::Spec(FillSpec::Linear { stops: s, .. } | FillSpec::Radial { stops: s, .. } | FillSpec::Sweep { stops: s, .. }) => {
            s.first().map(|x| match x { Stop::Color(c) | Stop::At { color: c, .. } => color(c) }).unwrap_or(Color::WHITE)
        }
        Fill::Spec(FillSpec::Image { .. }) => Color::WHITE,
    }
}

/// Shader của Fill trong khung `r` (tọa độ vẽ hiện tại). None = màu đơn.
pub fn fill_shader(f: &Fill, r: Rect, images: &Images) -> Option<Shader> {
    let spec = match f {
        Fill::Color(_) | Fill::Spec(FillSpec::Solid { .. }) => return None,
        Fill::Spec(s) => s,
    };
    let (w, h) = (r.width().max(1.0), r.height().max(1.0));
    match spec {
        FillSpec::Linear { stops: s, angle } if s.len() >= 2 => {
            let (cols, pos) = stops(s);
            let a = (*angle as f32).to_radians();
            let (dx, dy) = (a.cos(), a.sin());
            let half = (w * dx.abs() + h * dy.abs()) / 2.0;
            let c = r.center();
            gradient_shader::linear(
                (Point::new(c.x - dx * half, c.y - dy * half), Point::new(c.x + dx * half, c.y + dy * half)),
                cols.as_slice(), pos.as_deref(), TileMode::Clamp, None, None,
            )
        }
        FillSpec::Radial { stops: s, cx, cy, r: rad } if s.len() >= 2 => {
            let (cols, pos) = stops(s);
            let c = Point::new(r.left + *cx as f32 * w, r.top + *cy as f32 * h);
            gradient_shader::radial(c, (*rad as f32 * w.max(h)).max(1.0), cols.as_slice(), pos.as_deref(), TileMode::Clamp, None, None)
        }
        FillSpec::Sweep { stops: s, cx, cy, angle } if s.len() >= 2 => {
            let (cols, pos) = stops(s);
            let c = Point::new(r.left + *cx as f32 * w, r.top + *cy as f32 * h);
            let m = Matrix::rotate_deg_pivot(*angle as f32, c);
            gradient_shader::sweep(c, cols.as_slice(), pos.as_deref(), TileMode::Clamp, None, None, Some(&m))
        }
        FillSpec::Image { source, scale } => {
            let img = images.get(source)?;
            let (iw, ih) = (img.width() as f32, img.height() as f32);
            let s = (w / iw).max(h / ih) * (*scale as f32).max(0.05);
            let mut m = Matrix::translate((r.left + (w - iw * s) / 2.0, r.top + (h - ih * s) / 2.0));
            m.pre_scale((s, s), None);
            img.to_shader(Some((TileMode::Repeat, TileMode::Repeat)), SamplingOptions::new(skia_safe::FilterMode::Linear, skia_safe::MipmapMode::None), Some(&m))
        }
        _ => None,
    }
}

/// Paint tô theo Fill (đặc), anti-alias.
pub fn fill_paint(f: &Fill, r: Rect, images: &Images) -> Paint {
    let mut p = Paint::default();
    p.set_anti_alias(true);
    match fill_shader(f, r, images) {
        Some(s) => {
            p.set_shader(s);
        }
        None => {
            p.set_color(fill_color(f));
        }
    }
    p
}

/// Paint viền vector (nét đặt giữa đường viền nên độ dày ×2 để phần lộ ra bằng `width`).
pub fn stroke_paint(s: &Stroke, width_px: f32, r: Rect, images: &Images) -> Paint {
    let mut p = fill_paint(&s.fill(), r, images);
    p.set_style(skia_safe::paint::Style::Stroke).set_stroke_width(width_px * 2.0);
    p.set_stroke_join(match s.join.as_deref() {
        Some("miter") => skia_safe::paint::Join::Miter,
        Some("bevel") => skia_safe::paint::Join::Bevel,
        _ => skia_safe::paint::Join::Round,
    });
    p.set_alpha_f(p.alpha_f() * (s.opacity / 100.0).clamp(0.0, 1.0) as f32);
    p
}

fn colorize(c: Color, input: Option<ImageFilter>) -> Option<ImageFilter> {
    image_filters::color_filter(color_filters::blend(c, BlendMode::SrcIn)?, input, None)
}

/// Bóng của một silhouette (`sil`). `unit`: số đơn vị vẽ ứng với 1 px khung 1080; `rot`: góc xoay của lớp (để hướng bóng
/// luôn theo khung hình, không xoay theo lớp).
fn shadow_filter(sh: &Shadow, sil: Option<ImageFilter>, unit: f32, rot: f32) -> Option<ImageFilter> {
    let c = with_opacity(color(&sh.color), sh.opacity);
    let (s, co) = (-rot).to_radians().sin_cos();
    let (x, y) = (sh.x as f32 * unit, sh.y as f32 * unit);
    let (dx, dy) = (x * co - y * s, x * s + y * co);
    let sigma = (sh.blur as f32 * unit / 2.0).max(0.0);
    let sil = if sh.spread > 0.0 { image_filters::dilate((sh.spread as f32 * unit, sh.spread as f32 * unit), sil, None) } else { sil };
    match sh.kind.as_deref().unwrap_or("drop") {
        "glow" => {
            let a = image_filters::drop_shadow_only((0.0, 0.0), (sigma, sigma), Color4f::from(c), None, sil.clone(), None);
            let b = image_filters::drop_shadow_only((0.0, 0.0), (sigma * 0.4, sigma * 0.4), Color4f::from(c), None, sil, None);
            image_filters::merge([a, b], None)
        }
        "neon" => {
            let wide = image_filters::drop_shadow_only((0.0, 0.0), (sigma, sigma), Color4f::from(c), None, sil.clone(), None);
            let mid = image_filters::drop_shadow_only((0.0, 0.0), (sigma * 0.45, sigma * 0.45), Color4f::from(c), None, sil.clone(), None);
            let core = image_filters::drop_shadow_only((0.0, 0.0), (sigma * 0.15, sigma * 0.15), Color4f::from(c), None, sil, None);
            image_filters::merge([wide.clone(), wide, mid, core], None)
        }
        kind @ ("long" | "extrude") => {
            // nhiều bản sao lệch dần theo hướng (x,y) → bóng dài phẳng / khối 3D
            let len = (if sh.length > 0.0 { sh.length } else { 40.0 }) as f32 * unit;
            let n = (len / unit.max(0.1) / 1.5).clamp(2.0, 64.0) as usize;
            let norm = (dx * dx + dy * dy).sqrt().max(1e-3);
            let (ux, uy) = if dx == 0.0 && dy == 0.0 { (0.7071, 0.7071) } else { (dx / norm, dy / norm) };
            let base = colorize(c, sil)?;
            let copies = (1..=n).map(|i| {
                let k = len * i as f32 / n as f32;
                let layer = image_filters::offset((ux * k, uy * k), base.clone(), None);
                if kind == "extrude" {
                    // khối nổi: các lớp xa tối dần
                    let shade = 1.0 - 0.45 * i as f32 / n as f32;
                    let m = skia_safe::ColorMatrix::new(shade, 0., 0., 0., 0., 0., shade, 0., 0., 0., 0., 0., shade, 0., 0., 0., 0., 0., 1., 0.);
                    image_filters::color_filter(color_filters::matrix(&m, None), layer, None)
                } else {
                    layer
                }
            });
            let merged = image_filters::merge(copies.rev(), None);
            if sigma > 0.05 { image_filters::blur((sigma, sigma), TileMode::Decal, merged, None) } else { merged }
        }
        _ => image_filters::drop_shadow_only((dx, dy), (sigma, sigma), Color4f::from(c), None, sil, None),
    }
}

/// Viền theo hình dạng điểm ảnh (cho ảnh/video — chữ và hình dùng viền vector chính xác hơn).
fn raster_stroke(st: &Stroke, base: Option<ImageFilter>, unit: f32, bounds: Rect, images: &Images) -> Option<ImageFilter> {
    let r = (st.width as f32 * unit).max(0.5);
    let grown = image_filters::dilate((r, r), base, None);
    let fill = st.fill();
    let out = match fill_shader(&fill, bounds, images) {
        Some(sh) => image_filters::blend(BlendMode::SrcIn, grown, image_filters::shader(sh, None), None),
        None => colorize(fill_color(&fill), grown),
    };
    if st.opacity < 100.0 {
        let a = (st.opacity / 100.0).clamp(0.0, 1.0) as f32;
        let m = skia_safe::ColorMatrix::new(1., 0., 0., 0., 0., 0., 1., 0., 0., 0., 0., 0., 1., 0., 0., 0., 0., 0., a, 0.);
        image_filters::color_filter(color_filters::matrix(&m, None), out, None)
    } else {
        out
    }
}

/// Chuỗi filter cuối cho nội dung lớp: [bóng…, viền điểm ảnh (ngoài→trong)…, nội dung].
/// `base`: filter đã có (màu, mờ) hoặc None = nội dung gốc.
pub fn layer_filter(
    base: Option<ImageFilter>,
    shadows: &[Shadow],
    raster_strokes: &[Stroke],
    unit: f32,
    rot: f32,
    bounds: Rect,
    images: &Images,
) -> Option<ImageFilter> {
    if shadows.is_empty() && raster_strokes.is_empty() {
        return base;
    }
    let max_stroke = raster_strokes.iter().map(|s| s.width).fold(0.0, f64::max) as f32 * unit;
    let sil = if max_stroke > 0.0 { image_filters::dilate((max_stroke, max_stroke), base.clone(), None) } else { base.clone() };
    let mut parts: Vec<Option<ImageFilter>> = Vec::new();
    for sh in shadows {
        parts.push(shadow_filter(sh, sil.clone(), unit, rot));
    }
    for st in raster_strokes.iter().rev() {
        parts.push(raster_stroke(st, base.clone(), unit, bounds, images));
    }
    parts.push(base);
    image_filters::merge(parts, None)
}

//! Ghép khung hình bằng Skia (CPU raster): video/ảnh/chữ/hình, biến đổi, độ rõ, blur, color matrix.
//! Chữ dàn trang bằng Skia Paragraph (HarfBuzz + ICU) → dấu tiếng Việt luôn đúng.

use crate::anim::{state_at, State};
use crate::media::{fit_within, VideoSource};
use crate::model::{parse_color, Composition, Layer, LayerKind, TextStyle};
use anyhow::{anyhow, Result};
use serde::Serialize;
use skia_safe::textlayout::{FontCollection, ParagraphBuilder, ParagraphStyle, TextAlign, TextShadow, TextStyle as SkTextStyle};
use skia_safe::{
    canvas::SaveLayerRec, color_filters, gradient_shader, image_filters, paint, surfaces, AlphaType, BlurStyle, Canvas, Color,
    ColorMatrix, ColorType, Data, EncodedImageFormat, FontMgr, FontStyle, Image, ImageInfo, MaskFilter, Paint, PathBuilder,
    Point, RRect, Rect, Surface, TileMode,
};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
pub struct Bounds {
    pub id: String,
    /// góc trái trên (trước khi xoay) và kích thước, tỉ lệ 0..1 của khung
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub rotation: f64,
}

pub struct Rendered {
    pub surface: Surface,
    pub width: u32,
    pub height: u32,
    pub bounds: Vec<Bounds>,
}

pub struct Renderer {
    fonts: FontCollection,
    videos: HashMap<String, VideoSource>,
    images: HashMap<String, Image>,
}

// Renderer chỉ được dùng trên một luồng (luồng render riêng của core / tiến trình CLI).
unsafe impl Send for Renderer {}

fn color(s: &str) -> Color {
    let (r, g, b, a) = parse_color(s);
    Color::from_argb(a, r, g, b)
}

impl Default for Renderer {
    fn default() -> Self {
        Self::new()
    }
}

impl Renderer {
    pub fn new() -> Self {
        crate::media::init();
        let mut fonts = FontCollection::new();
        fonts.set_default_font_manager(FontMgr::new(), Some("Noto Sans"));
        Self { fonts, videos: HashMap::new(), images: HashMap::new() }
    }

    /// Bỏ decoder/ảnh không còn dùng (gọi sau mỗi lần đổi composition để giải phóng RAM).
    pub fn retain_sources(&mut self, comp: &Composition) {
        let used: std::collections::HashSet<&str> = comp
            .layers
            .iter()
            .filter_map(|l| match &l.kind {
                LayerKind::Video { source, .. } | LayerKind::Image { source, .. } => Some(source.as_str()),
                _ => None,
            })
            .collect();
        self.videos.retain(|k, _| used.contains(k.as_str()));
        self.images.retain(|k, _| used.contains(k.as_str()));
    }

    /// Render khung tại `t` (giây). `out_w`: độ rộng ảnh ra (chiều cao theo tỉ lệ khung).
    pub fn render(&mut self, comp: &Composition, t: f64, out_w: u32) -> Result<Rendered> {
        let cw = comp.canvas.width as f32;
        let ch = comp.canvas.height as f32;
        let out_w = out_w.clamp(16, comp.canvas.width.max(16));
        let s = out_w as f32 / cw;
        let out_h = ((ch * s).round() as u32).max(2);
        let mut surface = surfaces::raster_n32_premul((out_w as i32, out_h as i32)).ok_or_else(|| anyhow!("Không tạo được surface Skia"))?;
        let mut bounds = Vec::new();
        {
            let canvas = surface.canvas();
            canvas.clear(color(&comp.canvas.background));
            canvas.scale((s, s));
            for layer in &comp.layers {
                if matches!(layer.kind, LayerKind::Audio { .. }) || !layer.active_at(t) {
                    continue;
                }
                let st = state_at(layer, t);
                if st.opacity <= 0.001 {
                    continue;
                }
                if let Some((w, h)) = self.draw_layer(canvas, comp, layer, &st, t, s)? {
                    let (bw, bh) = (w as f64 * st.scale / cw as f64, h as f64 * st.scale / ch as f64);
                    bounds.push(Bounds { id: layer.id.clone(), x: st.x - bw / 2.0, y: st.y - bh / 2.0, w: bw, h: bh, rotation: st.rotation });
                }
            }
        }
        Ok(Rendered { surface, width: out_w, height: out_h, bounds })
    }

    /// Lấy ảnh nguồn (video/ảnh) của lớp tại thời điểm t, đã giải mã ở độ phân giải cần dùng.
    fn source_image(&mut self, comp: &Composition, l: &Layer, st: &State, t: f64, s: f32) -> Result<Option<Image>> {
        let cw = comp.canvas.width as f32;
        let ch = comp.canvas.height as f32;
        let crop = l.crop.clone().unwrap_or_default();
        let keep_w = (1.0 - crop.left - crop.right).clamp(0.05, 1.0) as f32;
        let keep_h = (1.0 - crop.top - crop.bottom).clamp(0.05, 1.0) as f32;
        Ok(match &l.kind {
            LayerKind::Video { source, fit, trim_start, .. } => {
                // ánh xạ thời gian theo tốc độ (retime)
                let src_t = trim_start + (t - l.start) * l.speed.clamp(0.1, 5.0);
                if !self.videos.contains_key(source) {
                    self.videos.insert(source.clone(), VideoSource::open(source)?);
                }
                let v = self.videos.get_mut(source).unwrap();
                let (bw, bh) = fit_box(v.width as f32 * keep_w, v.height as f32 * keep_h, cw, ch, fit);
                let mut need_w = (bw * s * st.scale as f32 / keep_w).ceil() as u32;
                let mut need_h = (bh * s * st.scale as f32 / keep_h).ceil() as u32;
                if l.background_fill.as_deref() == Some("blur") {
                    need_w = need_w.max((cw * s * 0.25) as u32);
                    need_h = need_h.max((ch * s * 0.25) as u32);
                }
                let (tw, th) = fit_within(v.width, v.height, need_w.clamp(16, 3840), need_h.clamp(16, 3840));
                let f = v.frame_at(src_t, tw, th)?;
                let info = ImageInfo::new((f.width as i32, f.height as i32), ColorType::RGBA8888, AlphaType::Unpremul, None);
                Some(skia_safe::images::raster_from_data(&info, Data::new_copy(&f.data), f.stride).ok_or_else(|| anyhow!("Không tạo được ảnh từ khung"))?)
            }
            LayerKind::Image { source, .. } => {
                if !self.images.contains_key(source) {
                    let bytes = std::fs::read(source).map_err(|e| anyhow!("Không đọc được ảnh '{source}': {e}"))?;
                    let img = Image::from_encoded(Data::new_copy(&bytes)).ok_or_else(|| anyhow!("Skia không giải mã được ảnh '{source}'"))?;
                    self.images.insert(source.clone(), img);
                }
                Some(self.images.get(source).unwrap().clone())
            }
            _ => None,
        })
    }

    /// Vẽ một lớp, trả kích thước nội dung (đơn vị khung gốc) để tính khung bao.
    fn draw_layer(&mut self, canvas: &Canvas, comp: &Composition, l: &Layer, st: &State, t: f64, s: f32) -> Result<Option<(f32, f32)>> {
        let cw = comp.canvas.width as f32;
        let ch = comp.canvas.height as f32;
        let img = self.source_image(comp, l, st, t, s)?;
        let fit = match &l.kind {
            LayerKind::Video { fit, .. } | LayerKind::Image { fit, .. } => fit.clone(),
            _ => "contain".to_string(),
        };
        let fit = fit.as_str();
        // vùng nguồn sau khi crop
        let src_rect = img.as_ref().map(|im| {
            let c = l.crop.clone().unwrap_or_default();
            let (iw, ih) = (im.width() as f32, im.height() as f32);
            let x = (c.left.clamp(0.0, 0.95) as f32) * iw;
            let y = (c.top.clamp(0.0, 0.95) as f32) * ih;
            let w = ((1.0 - c.left - c.right).clamp(0.05, 1.0) as f32) * iw;
            let h = ((1.0 - c.top - c.bottom).clamp(0.05, 1.0) as f32) * ih;
            Rect::from_xywh(x, y, w, h)
        });

        // Nền mờ lấp khung (vẽ trước, theo toàn khung hình)
        if let (Some(im), Some(sr), Some("blur")) = (&img, &src_rect, l.background_fill.as_deref()) {
            let (fw, fh) = fit_box(sr.width(), sr.height(), cw, ch, "cover");
            let mut p = Paint::default();
            p.set_alpha_f(st.opacity as f32);
            p.set_image_filter(image_filters::blur((40.0, 40.0), TileMode::Clamp, None, None));
            canvas.save();
            canvas.clip_rect(Rect::from_xywh(0.0, 0.0, cw, ch), None, true);
            canvas.draw_image_rect_with_sampling_options(im, Some((sr, skia_safe::canvas::SrcRectConstraint::Fast)),
                Rect::from_xywh((cw - fw) / 2.0, (ch - fh) / 2.0, fw, fh), sampling(), &p);
            canvas.restore();
        }

        // Lớp tạm: độ rõ + blur + màu + blend mode
        let mut lp = Paint::default();
        lp.set_alpha_f(st.opacity as f32);
        let blur = l.effects.iter().filter(|e| e.kind == "blur").map(|e| e.amount).sum::<f64>() * 0.4 + st.blur;
        if blur > 0.05 {
            let sigma = blur as f32;
            lp.set_image_filter(image_filters::blur((sigma, sigma), TileMode::Decal, None, None));
        }
        if let Some(m) = effect_matrix(l) {
            lp.set_color_filter(color_filters::matrix(&m, None));
        }
        if let Some(b) = l.blend.as_deref().and_then(blend_mode) {
            lp.set_blend_mode(b);
        }
        canvas.save();
        canvas.translate((st.x as f32 * cw, st.y as f32 * ch));
        canvas.rotate(st.rotation as f32, None);
        canvas.scale((st.scale as f32, st.scale as f32));
        canvas.save_layer(&SaveLayerRec::default().paint(&lp));

        // kích thước nội dung để clip wipe / mask
        let content = match (&l.kind, &src_rect) {
            (LayerKind::Video { .. } | LayerKind::Image { .. }, Some(sr)) => {
                let (bw, bh) = fit_box(sr.width(), sr.height(), cw, ch, fit);
                if fit == "cover" { (bw.min(cw), bh.min(ch)) } else { (bw, bh) }
            }
            (LayerKind::Shape { w, h, .. }, _) => (*w as f32 * cw, *h as f32 * ch),
            (LayerKind::Text { text, style }, _) => self.measure_text(text, style, cw, ch),
            _ => (cw, ch),
        };
        if let Some((kind, p)) = st.wipe {
            clip_wipe(canvas, kind, p as f32, content.0, content.1);
        }
        canvas.save();
        if l.flip_h || l.flip_v {
            canvas.scale((if l.flip_h { -1.0 } else { 1.0 }, if l.flip_v { -1.0 } else { 1.0 }));
        }

        let size = match &l.kind {
            LayerKind::Video { .. } | LayerKind::Image { .. } => {
                let (im, sr) = (img.as_ref().unwrap(), src_rect.unwrap());
                let (bw, bh) = fit_box(sr.width(), sr.height(), cw, ch, fit);
                if fit == "cover" {
                    canvas.clip_rect(Rect::from_xywh(-cw / 2.0, -ch / 2.0, cw, ch), None, true);
                }
                canvas.draw_image_rect_with_sampling_options(im, Some((&sr, skia_safe::canvas::SrcRectConstraint::Fast)),
                    Rect::from_xywh(-bw / 2.0, -bh / 2.0, bw, bh), sampling(), &Paint::default());
                Some(content)
            }
            LayerKind::Text { text, style } => Some(self.draw_text(canvas, text, style, st.reveal, cw, ch)),
            LayerKind::Shape { shape, w, h, fill, stroke, corner_radius } => {
                let (w, h) = (*w as f32 * cw, *h as f32 * ch);
                let r = Rect::from_xywh(-w / 2.0, -h / 2.0, w, h);
                let mut p = Paint::default();
                p.set_anti_alias(true).set_color(color(fill));
                draw_shape(canvas, shape, r, *corner_radius as f32, &p);
                if let Some(sk) = stroke {
                    let mut sp = Paint::default();
                    sp.set_anti_alias(true).set_style(paint::Style::Stroke).set_stroke_width(sk.width as f32).set_color(color(&sk.color));
                    draw_shape(canvas, shape, r, *corner_radius as f32, &sp);
                }
                Some((w, h))
            }
            LayerKind::Audio { .. } => None,
        };
        canvas.restore(); // lật

        // Mask: giữ (DstIn) hoặc khoét (DstOut) theo hình, viền làm mềm bằng mask filter
        if let Some(m) = &l.mask {
            let mut mp = Paint::default();
            mp.set_anti_alias(true).set_color(Color::BLACK);
            mp.set_blend_mode(if m.invert { skia_safe::BlendMode::DstOut } else { skia_safe::BlendMode::DstIn });
            if m.feather > 0.0 {
                mp.set_mask_filter(MaskFilter::blur(BlurStyle::Normal, (m.feather as f32 * ch / 1080.0 / 2.0).max(0.3), false));
            }
            draw_mask(canvas, m, content.0, content.1, &mp);
        }
        canvas.restore(); // save_layer
        canvas.restore(); // biến đổi
        Ok(size)
    }

    fn measure_text(&self, text: &str, st: &TextStyle, cw: f32, ch: f32) -> (f32, f32) {
        let px = (st.size as f32) * ch / 1080.0;
        let p = self.paragraph(&shape_text(text, st), st, px, None, false, (st.max_width.clamp(0.05, 1.0) as f32) * cw);
        (p.longest_line().ceil().max(1.0), p.height().ceil().max(1.0))
    }

    fn paragraph(&self, text: &str, st: &TextStyle, px: f32, fg: Option<&Paint>, shadow: bool, width: f32) -> skia_safe::textlayout::Paragraph {
        let mut ps = ParagraphStyle::new();
        ps.set_text_align(match st.align.as_str() {
            "left" => TextAlign::Left,
            "right" => TextAlign::Right,
            _ => TextAlign::Center,
        });
        let mut ts = SkTextStyle::new();
        ts.set_font_families(&[st.font.as_str(), "Noto Sans"]);
        ts.set_font_size(px);
        let slant = if st.italic { skia_safe::font_style::Slant::Italic } else { skia_safe::font_style::Slant::Upright };
        ts.set_font_style(FontStyle::new((st.weight.round() as i32).into(), skia_safe::font_style::Width::NORMAL, slant));
        if st.line_height > 0.0 {
            ts.set_height_override(true);
            ts.set_height(st.line_height as f32);
        }
        ts.set_letter_spacing(st.letter_spacing as f32 * px / 96.0);
        match fg {
            Some(p) => {
                ts.set_foreground_paint(p);
            }
            None => {
                ts.set_color(color(&st.color));
            }
        }
        if shadow {
            if let Some(sh) = &st.shadow {
                let k = px as f64 / 96.0;
                ts.add_shadow(TextShadow::new(color(&sh.color), (sh.x as f32 * k as f32, sh.y as f32 * k as f32), sh.blur * k / 2.0));
            }
        }
        let mut b = ParagraphBuilder::new(&ps, self.fonts.clone());
        b.push_style(&ts);
        b.add_text(text);
        let mut p = b.build();
        p.layout(width);
        p
    }

    /// Chữ nghệ thuật: hộp nền → phát sáng → viền → ruột (màu/gradient) + bóng. Trả kích thước nội dung.
    fn draw_text(&self, canvas: &Canvas, text: &str, st: &TextStyle, reveal: f64, cw: f32, ch: f32) -> (f32, f32) {
        let text = &shape_text(text, st);
        let shown: String = if reveal < 1.0 {
            let n = text.chars().count();
            text.chars().take(((n as f64) * reveal).ceil() as usize).collect()
        } else {
            text.to_string()
        };
        let px = (st.size as f32) * ch / 1080.0;
        let max_w = (st.max_width.clamp(0.05, 1.0) as f32) * cw;
        // đo trên toàn bộ chữ để khung không nhảy khi typewriter
        let measure = self.paragraph(text, st, px, None, false, max_w);
        let w = measure.longest_line().ceil().max(1.0);
        let h = measure.height().ceil().max(1.0);
        let origin = Point::new(-w / 2.0, -h / 2.0);
        let layout_w = w + 1.0;

        if let Some(bg) = &st.background {
            let pad = bg.padding as f32 * px;
            let mut p = Paint::default();
            p.set_anti_alias(true).set_color(color(&bg.color));
            let r = Rect::from_xywh(-w / 2.0 - pad, -h / 2.0 - pad * 0.6, w + pad * 2.0, h + pad * 1.2);
            canvas.draw_rrect(RRect::new_rect_xy(r, bg.radius as f32, bg.radius as f32), &p);
        }
        if let Some(g) = &st.glow {
            let mut p = Paint::default();
            p.set_anti_alias(true).set_color(color(&g.color));
            p.set_mask_filter(MaskFilter::blur(BlurStyle::Normal, (g.radius as f32 * px / 96.0).max(0.5), false));
            for _ in 0..2 {
                self.paragraph(&shown, st, px, Some(&p), false, layout_w).paint(canvas, origin);
            }
        }
        if let Some(sk) = &st.stroke {
            let mut p = Paint::default();
            p.set_anti_alias(true).set_style(paint::Style::Stroke).set_stroke_width(sk.width as f32 * px / 96.0 * 2.0);
            p.set_stroke_join(paint::Join::Round).set_color(color(&sk.color));
            self.paragraph(&shown, st, px, Some(&p), true, layout_w).paint(canvas, origin);
        }
        let fill = st.gradient.as_ref().filter(|g| g.colors.len() >= 2).map(|g| {
            let a = (g.angle as f32).to_radians();
            let (dx, dy) = (a.cos() * w / 2.0, a.sin() * h / 2.0);
            let cols: Vec<Color> = g.colors.iter().map(|c| color(c)).collect();
            let mut p = Paint::default();
            p.set_anti_alias(true);
            p.set_shader(gradient_shader::linear((Point::new(-dx, -dy), Point::new(dx, dy)), cols.as_slice(), None, TileMode::Clamp, None, None));
            p
        });
        let shadow_on_fill = st.stroke.is_none();
        self.paragraph(&shown, st, px, fill.as_ref(), shadow_on_fill, layout_w).paint(canvas, origin);
        (w, h)
    }
}

fn shape_text(text: &str, st: &TextStyle) -> String {
    if st.uppercase { text.to_uppercase() } else { text.to_string() }
}

fn sampling() -> skia_safe::SamplingOptions {
    skia_safe::SamplingOptions::new(skia_safe::FilterMode::Linear, skia_safe::MipmapMode::None)
}

/// Tên blend mode → Skia BlendMode (Skia cài đặt sẵn đủ các chế độ kiểu Photoshop).
fn blend_mode(name: &str) -> Option<skia_safe::BlendMode> {
    use skia_safe::BlendMode as B;
    Some(match name {
        "multiply" => B::Multiply,
        "screen" => B::Screen,
        "overlay" => B::Overlay,
        "darken" => B::Darken,
        "lighten" => B::Lighten,
        "color_dodge" => B::ColorDodge,
        "color_burn" => B::ColorBurn,
        "hard_light" => B::HardLight,
        "soft_light" => B::SoftLight,
        "difference" => B::Difference,
        "exclusion" => B::Exclusion,
        "hue" => B::Hue,
        "saturation" => B::Saturation,
        "color" => B::Color,
        "luminosity" => B::Luminosity,
        "add" | "plus" => B::Plus,
        _ => return None,
    })
}

fn clip_wipe(canvas: &Canvas, kind: crate::anim::Wipe, p: f32, w: f32, h: f32) {
    use crate::anim::Wipe;
    let p = p.clamp(0.0, 1.0);
    let (x0, y0) = (-w / 2.0, -h / 2.0);
    match kind {
        Wipe::Left => { canvas.clip_rect(Rect::from_xywh(x0 + w * (1.0 - p), y0, w * p, h), None, true); }
        Wipe::Right => { canvas.clip_rect(Rect::from_xywh(x0, y0, w * p, h), None, true); }
        Wipe::Up => { canvas.clip_rect(Rect::from_xywh(x0, y0 + h * (1.0 - p), w, h * p), None, true); }
        Wipe::Down => { canvas.clip_rect(Rect::from_xywh(x0, y0, w, h * p), None, true); }
        Wipe::Circle => {
            let r = p * (w * w + h * h).sqrt() / 2.0;
            canvas.clip_rrect(RRect::new_oval(Rect::from_xywh(-r, -r, r * 2.0, r * 2.0)), None, true);
        }
    }
}

/// Vẽ hình mask (hình học bê từ OpenCut `masks/builtin/definitions`, MIT).
fn draw_mask(canvas: &Canvas, m: &crate::model::Mask, cw: f32, ch: f32, p: &Paint) {
    let (cx, cy) = (m.cx as f32 * cw, m.cy as f32 * ch);
    let (hw, hh) = (m.w as f32 * cw / 2.0, m.h as f32 * ch / 2.0);
    canvas.save();
    canvas.translate((cx, cy));
    canvas.rotate(m.rotation as f32, None);
    let pt = |x: f32, y: f32| Point::new(x, y);
    match m.shape.as_str() {
        "ellipse" => { canvas.draw_oval(Rect::from_xywh(-hw, -hh, hw * 2.0, hh * 2.0), p); }
        "star" => {
            let mut b = PathBuilder::new();
            for i in 0..10 {
                let (rx, ry) = if i % 2 == 0 { (hw, hh) } else { (hw * 0.45, hh * 0.45) };
                let a = i as f32 * std::f32::consts::PI / 5.0 - std::f32::consts::FRAC_PI_2;
                if i == 0 { b.move_to(pt(rx * a.cos(), ry * a.sin())); } else { b.line_to(pt(rx * a.cos(), ry * a.sin())); }
            }
            b.close();
            canvas.draw_path(&b.detach(), p);
        }
        "heart" => {
            let mut b = PathBuilder::new();
            b.move_to(pt(0.0, -hh * 0.475));
            b.cubic_to(pt(hw, -hh * 1.225), pt(hw, -hh * 0.125), pt(0.0, hh * 0.725));
            b.cubic_to(pt(-hw, -hh * 0.125), pt(-hw, -hh * 1.225), pt(0.0, -hh * 0.475));
            b.close();
            canvas.draw_path(&b.detach(), p);
        }
        "diamond" => {
            let mut b = PathBuilder::new();
            b.move_to(pt(0.0, -hh));
            b.line_to(pt(hw, 0.0));
            b.line_to(pt(0.0, hh));
            b.line_to(pt(-hw, 0.0));
            b.close();
            canvas.draw_path(&b.detach(), p);
        }
        "bars" => {
            // dải ngang kiểu phim điện ảnh: giữ phần giữa, cao = h
            let big = (cw * cw + ch * ch).sqrt();
            canvas.draw_rect(Rect::from_xywh(-big, -hh, big * 2.0, hh * 2.0), p);
        }
        _ => {
            let r = m.radius as f32 * ch / 1080.0;
            canvas.draw_rrect(RRect::new_rect_xy(Rect::from_xywh(-hw, -hh, hw * 2.0, hh * 2.0), r, r), p);
        }
    }
    canvas.restore();
}

fn fit_box(iw: f32, ih: f32, cw: f32, ch: f32, fit: &str) -> (f32, f32) {
    let s = if fit == "cover" { (cw / iw).max(ch / ih) } else { (cw / iw).min(ch / ih) };
    (iw * s, ih * s)
}

fn draw_shape(canvas: &Canvas, shape: &str, r: Rect, radius: f32, p: &Paint) {
    match shape {
        "circle" => {
            canvas.draw_oval(r, p);
        }
        "star" => {
            let (cx, cy) = (r.center_x(), r.center_y());
            let (ro, ri) = (r.width().min(r.height()) / 2.0, r.width().min(r.height()) / 4.6);
            let mut b = PathBuilder::new();
            for i in 0..10 {
                let a = std::f32::consts::PI / 5.0 * i as f32 - std::f32::consts::FRAC_PI_2;
                let rr = if i % 2 == 0 { ro } else { ri };
                let pt = Point::new(cx + rr * a.cos(), cy + rr * a.sin());
                if i == 0 {
                    b.move_to(pt);
                } else {
                    b.line_to(pt);
                }
            }
            b.close();
            canvas.draw_path(&b.detach(), p);
        }
        _ => {
            canvas.draw_rrect(RRect::new_rect_xy(r, radius, radius), p);
        }
    }
}

type Cm = [f32; 20];

fn cm_mul(a: &Cm, b: &Cm) -> Cm {
    // a ∘ b (áp b trước rồi a); ma trận 4x5 coi như 5x5 có hàng cuối [0 0 0 0 1]
    let mut r = [0f32; 20];
    for i in 0..4 {
        for j in 0..5 {
            let mut v = if j == 4 { a[i * 5 + 4] } else { 0.0 };
            for k in 0..4 {
                v += a[i * 5 + k] * b[k * 5 + j];
            }
            r[i * 5 + j] = v;
        }
    }
    r
}

const CM_ID: Cm = [1., 0., 0., 0., 0., 0., 1., 0., 0., 0., 0., 0., 1., 0., 0., 0., 0., 0., 1., 0.];

/// Gộp hiệu ứng màu thành một ma trận (Skia áp trên CPU/GPU): làm tối, phơi sáng, độ sáng, tương phản,
/// độ đậm màu, đen trắng, nhiệt độ màu, xoay hue.
fn effect_matrix(l: &Layer) -> Option<ColorMatrix> {
    let get = |k: &str| l.effects.iter().filter(|e| e.kind == k).map(|e| e.amount).sum::<f64>() as f32;
    let names = ["dim", "exposure", "brightness", "contrast", "saturation", "grayscale", "temperature", "hue"];
    if names.iter().all(|n| get(n) == 0.0) {
        return None;
    }
    let mut m = CM_ID;
    let (lr, lg, lb) = (0.2126f32, 0.7152f32, 0.0722f32);
    let sat = ((1.0 + get("saturation") / 100.0) * (1.0 - get("grayscale") / 100.0)).clamp(0.0, 3.0);
    if sat != 1.0 {
        let s = sat;
        m = cm_mul(&[
            lr * (1.0 - s) + s, lg * (1.0 - s), lb * (1.0 - s), 0., 0.,
            lr * (1.0 - s), lg * (1.0 - s) + s, lb * (1.0 - s), 0., 0.,
            lr * (1.0 - s), lg * (1.0 - s), lb * (1.0 - s) + s, 0., 0.,
            0., 0., 0., 1., 0.,
        ], &m);
    }
    let hue = get("hue");
    if hue != 0.0 {
        let (c, s) = (hue.to_radians().cos(), hue.to_radians().sin());
        m = cm_mul(&[
            lr + c * (1.0 - lr) - s * lr, lg - c * lg - s * lg, lb - c * lb + s * (1.0 - lb), 0., 0.,
            lr - c * lr + s * 0.143, lg + c * (1.0 - lg) + s * 0.140, lb - c * lb - s * 0.283, 0., 0.,
            lr - c * lr - s * (1.0 - lr), lg - c * lg + s * lg, lb + c * (1.0 - lb) + s * lb, 0., 0.,
            0., 0., 0., 1., 0.,
        ], &m);
    }
    let contrast = 1.0 + get("contrast") / 100.0;
    if contrast != 1.0 {
        let o = 0.5 * (1.0 - contrast);
        m = cm_mul(&[contrast, 0., 0., 0., o, 0., contrast, 0., 0., o, 0., 0., contrast, 0., o, 0., 0., 0., 1., 0.], &m);
    }
    let temp = get("temperature") / 100.0;
    if temp != 0.0 {
        m = cm_mul(&[1.0 + 0.12 * temp, 0., 0., 0., 0., 0., 1.0, 0., 0., 0., 0., 0., 1.0 - 0.12 * temp, 0., 0., 0., 0., 0., 1., 0.], &m);
    }
    let gain = (1.0 - get("dim") / 100.0).clamp(0.0, 1.0) * 2f32.powf(get("exposure") / 50.0);
    let add = get("brightness") / 100.0 * 0.4;
    if gain != 1.0 || add != 0.0 {
        m = cm_mul(&[gain, 0., 0., 0., add, 0., gain, 0., 0., add, 0., 0., gain, 0., add, 0., 0., 0., 1., 0.], &m);
    }
    Some(ColorMatrix::new(
        m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9],
        m[10], m[11], m[12], m[13], m[14], m[15], m[16], m[17], m[18], m[19],
    ))
}

impl Rendered {
    pub fn jpeg(&mut self, quality: u32) -> Result<Vec<u8>> {
        let img = self.surface.image_snapshot();
        #[allow(deprecated)]
        let data = img.encode_to_data_with_quality(EncodedImageFormat::JPEG, quality).ok_or_else(|| anyhow!("Không mã hóa được JPEG"))?;
        Ok(data.as_bytes().to_vec())
    }

    /// Điểm ảnh RGBA (đã ghép trên nền đục) để đưa vào FFmpeg.
    pub fn rgba(&mut self, buf: &mut Vec<u8>) -> Result<()> {
        let info = ImageInfo::new((self.width as i32, self.height as i32), ColorType::RGBA8888, AlphaType::Unpremul, None);
        buf.resize((self.width * self.height * 4) as usize, 0);
        if !self.surface.read_pixels(&info, buf.as_mut_slice(), (self.width * 4) as usize, (0, 0)) {
            return Err(anyhow!("Không đọc được điểm ảnh từ surface"));
        }
        Ok(())
    }
}

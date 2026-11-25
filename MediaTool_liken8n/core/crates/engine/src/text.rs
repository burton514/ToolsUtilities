//! Chữ nghệ thuật bằng Skia Paragraph (HarfBuzz + ICU → dấu tiếng Việt luôn đúng):
//! - rich text: từng đoạn (`spans`) có kiểu riêng, tùy chọn chỉ áp trong một khoảng thời gian;
//! - tô màu bằng mọi loại `Fill`, nhiều lớp viền (mỗi lớp tô bằng `Fill`), gạch chân / gạch ngang, hoa/thường;
//! - nền: một khung cho cả đoạn hoặc mỗi dòng một khung;
//! - animation theo dòng / từ / chữ cái (lồng nhau: dòng → từ → chữ) và uốn chữ (vòng cung, sóng).
//! Bóng/phát sáng của chữ dùng chung `style::layer_filter` như mọi lớp khác.

use crate::anim::{has_unit, unit_deltas, Delta};
use crate::model::{Layer, Span, TextStyle};
use crate::style::{fill_color, fill_paint, stroke_paint, Images};
use skia_safe::textlayout::{
    FontCollection, Paragraph, ParagraphBuilder, ParagraphStyle, RectHeightStyle, RectWidthStyle, TextAlign, TextDecoration,
    TextStyle as SkTextStyle,
};
use skia_safe::{canvas::SaveLayerRec, image_filters, Canvas, FontStyle, Paint, Point, RRect, Rect, TileMode};
use unicode_segmentation::UnicodeSegmentation;

pub struct TextRenderer<'a> {
    pub fonts: &'a FontCollection,
    pub images: &'a Images,
    pub cw: f32,
    pub ch: f32,
}

/// Một đoạn chữ liền có cùng kiểu (byte offset trong chuỗi đã đổi hoa/thường).
struct Run {
    start: usize,
    end: usize,
    style: TextStyle,
}

#[derive(Clone, Copy)]
enum Pass {
    Fill,
    Stroke(usize),
}

pub fn apply_case(text: &str, case: Option<&str>) -> String {
    match case {
        Some("upper") => text.to_uppercase(),
        Some("lower") => text.to_lowercase(),
        Some("title") => text
            .split_word_bounds()
            .map(|w| {
                let mut c = w.chars();
                match c.next() {
                    Some(f) => f.to_uppercase().collect::<String>() + &c.as_str().to_lowercase(),
                    None => String::new(),
                }
            })
            .collect(),
        _ => text.to_string(),
    }
}

/// Gộp JSON: `patch` ghi đè lên `base` (đệ quy theo object).
pub fn merge_json(base: &mut serde_json::Value, patch: &serde_json::Value) {
    match (base, patch) {
        (serde_json::Value::Object(b), serde_json::Value::Object(p)) => {
            for (k, v) in p {
                merge_json(b.entry(k.clone()).or_insert(serde_json::Value::Null), v);
            }
        }
        (b, p) => *b = p.clone(),
    }
}

/// Kiểu từng đoạn: kiểu chung (+ viền của lớp) rồi ghi đè bằng các span đang hiệu lực tại t.
fn runs(text: &str, base_in: &TextStyle, strokes: &[crate::model::Stroke], spans: &[Span], t: f64) -> Vec<Run> {
    let mut base_owned = base_in.clone();
    base_owned.strokes = strokes.to_vec();
    let base = &base_owned;
    let byte_at: Vec<usize> = text.char_indices().map(|(b, _)| b).chain(std::iter::once(text.len())).collect();
    let nchars = byte_at.len() - 1;
    let active: Vec<&Span> = spans
        .iter()
        .filter(|s| s.window.is_none_or(|(a, b)| t >= a && t < b) && s.start < s.end && s.start < nchars)
        .collect();
    if active.is_empty() {
        return vec![Run { start: 0, end: text.len(), style: base.clone() }];
    }
    let mut cuts = vec![0, nchars];
    for s in &active {
        cuts.push(s.start.min(nchars));
        cuts.push(s.end.min(nchars));
    }
    cuts.sort_unstable();
    cuts.dedup();
    let base_json = serde_json::to_value(base).unwrap_or_default();
    cuts.windows(2)
        .filter(|w| w[1] > w[0])
        .map(|w| {
            let over: Vec<&&Span> = active.iter().filter(|s| s.start <= w[0] && s.end >= w[1]).collect();
            let style = if over.is_empty() {
                base.clone()
            } else {
                let mut v = base_json.clone();
                for s in over {
                    merge_json(&mut v, &s.style);
                }
                serde_json::from_value(v).unwrap_or_else(|_| base.clone())
            };
            Run { start: byte_at[w[0]], end: byte_at[w[1]], style }
        })
        .collect()
}

impl TextRenderer<'_> {
    fn px(&self, st: &TextStyle) -> f32 {
        st.size as f32 * self.ch / 1080.0
    }

    fn sk_style(&self, st: &TextStyle, paint: Option<Paint>, decorate: bool) -> SkTextStyle {
        let px = self.px(st);
        let mut ts = SkTextStyle::new();
        ts.set_font_families(&[st.font.as_str(), "Noto Sans", "Noto Color Emoji"]);
        ts.set_font_size(px);
        let slant = if st.italic { skia_safe::font_style::Slant::Italic } else { skia_safe::font_style::Slant::Upright };
        ts.set_font_style(FontStyle::new((st.weight.round() as i32).into(), skia_safe::font_style::Width::NORMAL, slant));
        if st.line_height > 0.0 {
            ts.set_height_override(true);
            ts.set_height(st.line_height as f32);
        }
        ts.set_letter_spacing(st.letter_spacing as f32 * px / 96.0);
        if st.word_spacing != 0.0 {
            ts.set_word_spacing(st.word_spacing as f32 * px / 96.0);
        }
        match paint {
            Some(p) => {
                ts.set_foreground_paint(&p);
            }
            None => {
                ts.set_color(fill_color(&st.fill()));
            }
        }
        if decorate && (st.underline || st.strikethrough) {
            let mut d = TextDecoration::NO_DECORATION;
            if st.underline {
                d |= TextDecoration::UNDERLINE;
            }
            if st.strikethrough {
                d |= TextDecoration::LINE_THROUGH;
            }
            ts.set_decoration_type(d);
            ts.set_decoration_color(fill_color(&st.fill()));
            ts.set_decoration_thickness_multiplier(1.5);
        }
        ts
    }

    /// Dựng paragraph cho đoạn [from, to) với kiểu vẽ của `pass`; `paint_box`: khung tô (tọa độ vẽ).
    #[allow(clippy::too_many_arguments)]
    fn build(&self, text: &str, rs: &[Run], from: usize, to: usize, align: TextAlign, width: f32, pass: Option<(Pass, Rect)>) -> Paragraph {
        let mut ps = ParagraphStyle::new();
        ps.set_text_align(align);
        let mut b = ParagraphBuilder::new(&ps, self.fonts.clone());
        for r in rs {
            let (a, z) = (r.start.max(from), r.end.min(to));
            if a >= z {
                continue;
            }
            let paint = pass.map(|(p, rect)| match p {
                Pass::Fill => fill_paint(&r.style.fill(), rect, self.images),
                Pass::Stroke(i) => match r.style.strokes.get(i) {
                    Some(s) => stroke_paint(s, s.width as f32 * self.px(&r.style) / 96.0, rect, self.images),
                    None => {
                        let mut p = Paint::default();
                        p.set_alpha(0);
                        p
                    }
                },
            });
            let decorate = matches!(pass, Some((Pass::Fill, _)) | None);
            b.push_style(&self.sk_style(&r.style, paint, decorate));
            b.add_text(&text[a..z]);
            b.pop();
        }
        let mut p = b.build();
        p.layout(width);
        p
    }

    fn layout(&self, l: &Layer, raw: &str, style: &TextStyle, spans: &[Span], t: f64) -> (String, Vec<Run>, Paragraph, f32, f32, TextAlign) {
        let text = apply_case(raw, style.case.as_deref());
        let rs = runs(&text, style, &l.strokes, spans, t);
        let align = match style.align.as_str() {
            "left" => TextAlign::Left,
            "right" => TextAlign::Right,
            "justify" => TextAlign::Justify,
            _ => TextAlign::Center,
        };
        let max_w = (style.max_width.clamp(0.05, 1.0) as f32) * self.cw;
        let m = self.build(&text, &rs, 0, text.len(), align, max_w, None);
        let w = m.longest_line().ceil().max(1.0);
        let full = self.build(&text, &rs, 0, text.len(), align, w + 1.0, None);
        let h = full.height().ceil().max(1.0);
        (text, rs, full, w, h, align)
    }

    pub fn measure(&self, l: &Layer, text: &str, style: &TextStyle, spans: &[Span], t: f64) -> (f32, f32) {
        let (_, _, _, w, h, _) = self.layout(l, text, style, spans, t);
        (w, h)
    }

    /// Vẽ chữ, tâm tại (0,0). Trả kích thước nội dung.
    pub fn draw(&self, canvas: &Canvas, l: &Layer, raw: &str, style: &TextStyle, spans: &[Span], t: f64) -> (f32, f32) {
        let (text, rs, full, w, h, align) = self.layout(l, raw, style, spans, t);
        let origin = Point::new(-w / 2.0, -h / 2.0);
        let boxr = Rect::from_xywh(-w / 2.0, -h / 2.0, w, h);
        let px = self.px(style);
        let n_strokes = rs.iter().map(|r| r.style.strokes.len()).max().unwrap_or(0);
        let passes: Vec<Pass> = (0..n_strokes).rev().map(Pass::Stroke).chain(std::iter::once(Pass::Fill)).collect();

        // nền
        if let Some(bg) = &style.background {
            let pad = bg.padding as f32 * px;
            let bf = bg.fill.clone().unwrap_or_else(|| crate::model::Fill::Color(bg.color.clone()));
            let rad = bg.radius as f32 * self.ch / 1080.0;
            if bg.mode.as_deref() == Some("line") {
                for lm in full.get_line_metrics() {
                    let r = Rect::from_xywh(
                        origin.x + lm.left as f32 - pad,
                        origin.y + (lm.baseline - lm.ascent) as f32 - pad * 0.35,
                        lm.width as f32 + pad * 2.0,
                        (lm.ascent + lm.descent) as f32 + pad * 0.7,
                    );
                    canvas.draw_rrect(RRect::new_rect_xy(r, rad, rad), &fill_paint(&bf, r, self.images));
                }
            } else {
                let r = Rect::from_xywh(-w / 2.0 - pad, -h / 2.0 - pad * 0.6, w + pad * 2.0, h + pad * 1.2);
                canvas.draw_rrect(RRect::new_rect_xy(r, rad, rad), &fill_paint(&bf, r, self.images));
            }
        }

        let units = has_unit(l, "line") || has_unit(l, "word") || has_unit(l, "char") || style.warp.as_ref().is_some_and(|w| w.amount.abs() > 0.5);
        if !units {
            for pass in &passes {
                self.build(&text, &rs, 0, text.len(), align, w + 1.0, Some((*pass, boxr))).paint(canvas, origin);
            }
            return (w, h);
        }
        self.draw_units(canvas, l, &text, &rs, &full, w, h, origin, &passes, t);
        (w, h)
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_units(&self, canvas: &Canvas, l: &Layer, text: &str, rs: &[Run], full: &Paragraph, w: f32, h: f32, origin: Point, passes: &[Pass], t: f64) {
        // utf-16 offset cho mỗi byte đầu ký tự (Skia đo vị trí theo utf-16)
        let mut u16_at = std::collections::HashMap::new();
        let mut acc = 0usize;
        for (b, c) in text.char_indices() {
            u16_at.insert(b, acc);
            acc += c.len_utf16();
        }
        u16_at.insert(text.len(), acc);
        let lines = full.get_line_metrics();
        let line_of = |r: &Rect| -> usize {
            let cy = r.center_y() as f64;
            lines.iter().position(|m| cy >= m.baseline - m.ascent - 0.5 && cy <= m.baseline + m.descent + 0.5).unwrap_or(0)
        };

        // từng grapheme (ký tự hiển thị) + khung + dòng + từ
        struct G {
            a: usize,
            z: usize,
            rect: Rect,
            line: usize,
            word: Option<usize>,
            space: bool,
        }
        let mut gs: Vec<G> = Vec::new();
        let mut word = 0usize;
        let mut in_word = false;
        let mut last_line = usize::MAX;
        for (b, g) in text.grapheme_indices(true) {
            let space = g.chars().all(char::is_whitespace);
            let (ua, uz) = (u16_at[&b], u16_at[&(b + g.len())]);
            let boxes = full.get_rects_for_range(ua..uz, RectHeightStyle::Max, RectWidthStyle::Tight);
            let Some(mut rect) = boxes.first().map(|x| x.rect) else {
                in_word = false;
                continue;
            };
            for x in &boxes[1..] {
                rect.join(x.rect);
            }
            let line = line_of(&rect);
            if space || line != last_line {
                if in_word {
                    word += 1;
                }
                in_word = false;
            }
            last_line = line;
            let wi = if space {
                None
            } else {
                in_word = true;
                Some(word)
            };
            gs.push(G { a: b, z: b + g.len(), rect, line, word: wi, space });
        }
        let n_words = gs.iter().filter_map(|g| g.word).max().map(|x| x + 1).unwrap_or(0);
        let n_lines = lines.len().max(1);
        let warp = l.kind_text_style().and_then(|s| s.warp.clone()).filter(|w| w.amount.abs() > 0.5);
        let finest = if has_unit(l, "char") || warp.is_some() { 2 } else if has_unit(l, "word") { 1 } else { 0 };

        let union = |it: &mut dyn Iterator<Item = &G>| -> Option<(usize, usize, Rect)> {
            let mut r: Option<(usize, usize, Rect)> = None;
            for g in it {
                r = Some(match r {
                    None => (g.a, g.z, g.rect),
                    Some((a, z, mut rr)) => {
                        rr.join(g.rect);
                        (a.min(g.a), z.max(g.z), rr)
                    }
                });
            }
            r
        };
        let line_boxes: Vec<Option<(usize, usize, Rect)>> = (0..n_lines).map(|i| union(&mut gs.iter().filter(|g| g.line == i && !g.space))).collect();
        let word_boxes: Vec<Option<(usize, usize, Rect)>> = (0..n_words).map(|i| union(&mut gs.iter().filter(|g| g.word == Some(i)))).collect();
        let chars: Vec<&G> = gs.iter().filter(|g| !g.space).collect();
        let txt = |b: &Option<(usize, usize, Rect)>| b.map(|(a, z, _)| text[a..z].to_string()).unwrap_or_default();
        let line_d = unit_deltas(l, "line", &line_boxes.iter().map(txt).collect::<Vec<_>>(), t);
        let word_d = unit_deltas(l, "word", &word_boxes.iter().map(txt).collect::<Vec<_>>(), t);
        let char_d = unit_deltas(l, "char", &chars.iter().map(|g| text[g.a..g.z].to_string()).collect::<Vec<_>>(), t);
        let px = self.px(l.kind_text_style().expect("text"));
        let unit_len = px as f64 * 10.0;

        // phần tử vẽ ở mức nhỏ nhất đang dùng
        let mut items: Vec<(usize, usize, Rect, usize, Option<usize>, Option<usize>)> = Vec::new(); // a,z,rect,line,word,char
        match finest {
            0 => {
                for (i, b) in line_boxes.iter().enumerate() {
                    if let Some((a, z, r)) = b {
                        items.push((*a, *z, *r, i, None, None));
                    }
                }
            }
            1 => {
                for (i, b) in word_boxes.iter().enumerate() {
                    if let Some((a, z, r)) = b {
                        let line = gs.iter().find(|g| g.word == Some(i)).map(|g| g.line).unwrap_or(0);
                        items.push((*a, *z, *r, line, Some(i), None));
                    }
                }
            }
            _ => {
                for (i, g) in chars.iter().enumerate() {
                    items.push((g.a, g.z, g.rect, g.line, g.word, Some(i)));
                }
            }
        }

        let apply = |canvas: &Canvas, d: &Delta, c: Point| {
            canvas.translate((c.x + (d.dx * unit_len) as f32, c.y + (d.dy * unit_len) as f32));
            canvas.rotate(d.rot as f32, None);
            canvas.scale(((d.scale * d.sx) as f32, (d.scale * d.sy) as f32));
            canvas.translate((-c.x, -c.y));
        };
        let boxr = Rect::from_xywh(0.0, 0.0, w, h); // khung tô theo tọa độ bố cục (gradient liền mạch qua các chữ)
        for (a, z, rect, line, wi, ci) in items {
            let mut d_total = Delta::default();
            canvas.save();
            canvas.translate((origin.x, origin.y));
            if finest > 0 {
                if let Some(d) = line_d.get(line).filter(|d| !d.is_identity()) {
                    if let Some(Some((_, _, lr))) = line_boxes.get(line) {
                        apply(canvas, d, lr.center());
                    }
                    d_total.opacity *= d.opacity;
                    d_total.blur += d.blur;
                }
            }
            if finest > 1 {
                if let Some(d) = wi.and_then(|i| word_d.get(i)).filter(|d| !d.is_identity()) {
                    if let Some(Some((_, _, wr))) = wi.and_then(|i| word_boxes.get(i)) {
                        apply(canvas, d, wr.center());
                    }
                    d_total.opacity *= d.opacity;
                    d_total.blur += d.blur;
                }
            }
            let own = match finest {
                0 => line_d.get(line).copied(),
                1 => wi.and_then(|i| word_d.get(i)).copied(),
                _ => ci.and_then(|i| char_d.get(i)).copied(),
            }
            .unwrap_or_default();
            // uốn chữ: đặt từng chữ lên vòng cung / sóng
            let mut wd = Delta::default();
            if let (Some(wp), 2) = (&warp, finest) {
                let xc = (rect.center_x() - w / 2.0) as f64;
                let amt = (wp.amount / 100.0).clamp(-1.0, 1.0);
                if wp.kind == "wave" {
                    let f = 2.0 * std::f64::consts::PI * 1.5 / w as f64;
                    let amp = amt * px as f64 * 0.6;
                    wd.dy = amp * (f * rect.center_x() as f64).sin() / unit_len;
                    wd.rot = (amp * f * (f * rect.center_x() as f64).cos()).atan().to_degrees();
                } else {
                    let r = w as f64 / (amt * std::f64::consts::PI);
                    let th = xc / r;
                    wd.dx = (r * th.sin() - xc) / unit_len;
                    wd.dy = (r * (1.0 - th.cos())) / unit_len;
                    wd.rot = th.to_degrees();
                }
            }
            wd.add(&own);
            apply(canvas, &wd, rect.center());
            d_total.opacity *= wd.opacity;
            d_total.blur += wd.blur;
            if d_total.opacity <= 0.002 {
                canvas.restore();
                continue;
            }
            let layered = d_total.opacity < 0.999 || d_total.blur > 0.05;
            if layered {
                let mut p = Paint::default();
                p.set_alpha_f(d_total.opacity.clamp(0.0, 1.0) as f32);
                if d_total.blur > 0.05 {
                    let s = (d_total.blur * self.ch as f64 / 1080.0) as f32;
                    p.set_image_filter(image_filters::blur((s, s), TileMode::Decal, None, None));
                }
                canvas.save_layer(&SaveLayerRec::default().paint(&p));
            }
            // đoạn chữ con, đặt đúng đường chân chữ của dòng
            let probe = self.build(text, rs, a, z, TextAlign::Left, 100_000.0, None);
            let base_y = lines.get(line).map(|m| m.baseline as f32).unwrap_or(rect.bottom);
            let at = Point::new(rect.left, base_y - probe.alphabetic_baseline());
            for pass in passes {
                self.build(text, rs, a, z, TextAlign::Left, 100_000.0, Some((*pass, boxr))).paint(canvas, at);
            }
            if layered {
                canvas.restore();
            }
            canvas.restore();
        }
    }
}

impl Layer {
    pub fn kind_text_style(&self) -> Option<&TextStyle> {
        match &self.kind {
            crate::model::LayerKind::Text { style, .. } => Some(style),
            _ => None,
        }
    }
}

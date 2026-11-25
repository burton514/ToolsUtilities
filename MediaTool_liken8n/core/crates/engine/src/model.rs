//! Composition (bản dựng). Khớp với `packages/editor/src/model.ts`. Thời gian: giây; vị trí: tỉ lệ 0..1.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Composition {
    #[serde(default = "one")]
    pub version: u32,
    pub canvas: Canvas,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub layers: Vec<Layer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Canvas {
    pub width: u32,
    pub height: u32,
    #[serde(default = "thirty")]
    pub fps: f64,
    #[serde(default = "black")]
    pub background: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keyframe {
    pub t: f64,
    pub value: f64,
    #[serde(default)]
    pub ease: Option<String>,
    /// Easing tùy chỉnh kiểu CSS cubic-bezier(x1, y1, x2, y2); có thì ưu tiên hơn `ease`
    #[serde(default)]
    pub bezier: Option<[f64; 4]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnimPreset {
    pub preset: String,
    #[serde(default = "half")]
    pub duration: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Animation {
    #[serde(default, rename = "in")]
    pub in_: Option<AnimPreset>,
    #[serde(default)]
    pub out: Option<AnimPreset>,
    #[serde(default, rename = "loop")]
    pub loop_: Option<AnimPreset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Effect {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layer {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub start: f64,
    #[serde(default = "five")]
    pub duration: f64,
    #[serde(default = "center")]
    pub x: f64,
    #[serde(default = "center")]
    pub y: f64,
    #[serde(default = "one_f")]
    pub scale: f64,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default = "hundred")]
    pub opacity: f64,
    #[serde(default)]
    pub animation: Option<Animation>,
    #[serde(default)]
    pub keyframes: BTreeMap<String, Vec<Keyframe>>,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default)]
    pub hidden: bool,
    /// Cách hòa trộn với lớp dưới (Skia BlendMode): normal, multiply, screen, overlay, darken, lighten,
    /// color_dodge, color_burn, hard_light, soft_light, difference, exclusion, hue, saturation, color, luminosity, add
    #[serde(default)]
    pub blend: Option<String>,
    #[serde(default)]
    pub mask: Option<Mask>,
    /// Cắt bớt mép nguồn (video/ảnh), tỉ lệ 0..1 mỗi phía
    #[serde(default)]
    pub crop: Option<Crop>,
    #[serde(default)]
    pub flip_h: bool,
    #[serde(default)]
    pub flip_v: bool,
    /// Tốc độ phát nguồn (video/audio): 0.1..5. Tiếng giữ nguyên cao độ (FFmpeg atempo).
    #[serde(default = "one_f")]
    pub speed: f64,
    /// Âm lượng to dần / nhỏ dần (giây) ở đầu / cuối lớp
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
    /// "blur": lấp chỗ trống quanh video/ảnh bằng chính nó phóng to và làm mờ (hợp cho khung dọc)
    #[serde(default)]
    pub background_fill: Option<String>,
    #[serde(flatten)]
    pub kind: LayerKind,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Crop {
    #[serde(default)]
    pub left: f64,
    #[serde(default)]
    pub top: f64,
    #[serde(default)]
    pub right: f64,
    #[serde(default)]
    pub bottom: f64,
}

/// Mask hình học (định nghĩa hình bê từ OpenCut, MIT). Tọa độ theo kích thước nội dung lớp.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mask {
    /// rect | ellipse | star | heart | diamond | bars
    pub shape: String,
    /// tâm mask, lệch so với tâm lớp, tỉ lệ -0.5..0.5 của nội dung
    #[serde(default)]
    pub cx: f64,
    #[serde(default)]
    pub cy: f64,
    #[serde(default = "point6")]
    pub w: f64,
    #[serde(default = "point6")]
    pub h: f64,
    #[serde(default)]
    pub rotation: f64,
    /// làm mềm viền (pixel theo khung cao 1080)
    #[serde(default)]
    pub feather: f64,
    #[serde(default)]
    pub radius: f64,
    #[serde(default)]
    pub invert: bool,
}

fn point6() -> f64 {
    0.6
}

impl Layer {
    pub fn end(&self) -> f64 {
        self.start + self.duration
    }
    pub fn active_at(&self, t: f64) -> bool {
        !self.hidden && t >= self.start && t < self.end()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum LayerKind {
    Video {
        source: String,
        #[serde(default = "contain")]
        fit: String,
        #[serde(default)]
        trim_start: f64,
        #[serde(default = "hundred")]
        volume: f64,
        #[serde(default)]
        muted: bool,
    },
    Image {
        source: String,
        #[serde(default = "contain")]
        fit: String,
    },
    Text {
        text: String,
        style: TextStyle,
    },
    Shape {
        #[serde(default = "rect")]
        shape: String,
        #[serde(default = "point3")]
        w: f64,
        #[serde(default = "point2")]
        h: f64,
        #[serde(default = "blue")]
        fill: String,
        #[serde(default)]
        stroke: Option<Stroke>,
        #[serde(default)]
        corner_radius: f64,
    },
    Audio {
        source: String,
        #[serde(default)]
        trim_start: f64,
        #[serde(default = "hundred")]
        volume: f64,
        #[serde(default)]
        muted: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stroke {
    pub color: String,
    pub width: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Gradient {
    pub colors: Vec<String>,
    #[serde(default = "ninety")]
    pub angle: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shadow {
    pub color: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub blur: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Glow {
    pub color: String,
    #[serde(default = "twelve")]
    pub radius: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoxBg {
    pub color: String,
    #[serde(default = "point3")]
    pub padding: f64,
    #[serde(default)]
    pub radius: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextStyle {
    #[serde(default = "noto")]
    pub font: String,
    #[serde(default = "seven_hundred")]
    pub weight: f64,
    #[serde(default = "ninety_six")]
    pub size: f64,
    #[serde(default = "white")]
    pub color: String,
    #[serde(default)]
    pub gradient: Option<Gradient>,
    #[serde(default)]
    pub stroke: Option<Stroke>,
    #[serde(default)]
    pub shadow: Option<Shadow>,
    #[serde(default)]
    pub glow: Option<Glow>,
    #[serde(default)]
    pub background: Option<BoxBg>,
    #[serde(default = "center_s")]
    pub align: String,
    #[serde(default)]
    pub letter_spacing: f64,
    #[serde(default = "point9")]
    pub max_width: f64,
    /// khoảng cách dòng (bội số cỡ chữ); 0 = mặc định của font
    #[serde(default)]
    pub line_height: f64,
    #[serde(default)]
    pub italic: bool,
    #[serde(default)]
    pub uppercase: bool,
}

fn one() -> u32 { 1 }
fn one_f() -> f64 { 1.0 }
fn thirty() -> f64 { 30.0 }
fn half() -> f64 { 0.5 }
fn five() -> f64 { 5.0 }
fn center() -> f64 { 0.5 }
fn hundred() -> f64 { 100.0 }
fn ninety() -> f64 { 90.0 }
fn twelve() -> f64 { 12.0 }
fn point2() -> f64 { 0.2 }
fn point3() -> f64 { 0.3 }
fn point9() -> f64 { 0.9 }
fn seven_hundred() -> f64 { 700.0 }
fn ninety_six() -> f64 { 96.0 }
fn black() -> String { "#000000".into() }
fn white() -> String { "#FFFFFF".into() }
fn blue() -> String { "#2F6FED".into() }
fn noto() -> String { "Noto Sans".into() }
fn contain() -> String { "contain".into() }
fn rect() -> String { "rect".into() }
fn center_s() -> String { "center".into() }

impl Composition {
    pub fn end(&self) -> f64 {
        self.layers.iter().map(Layer::end).fold(self.duration.max(0.0), f64::max)
    }

    /// Đổi mọi `source` theo hàm ánh xạ (ví dụ "asset:<id>" → đường dẫn file). Trả lỗi nếu có nguồn không giải được.
    pub fn resolve_sources(&mut self, mut f: impl FnMut(&str) -> Option<String>) -> Result<(), String> {
        for l in &mut self.layers {
            let src = match &mut l.kind {
                LayerKind::Video { source, .. } | LayerKind::Image { source, .. } | LayerKind::Audio { source, .. } => source,
                _ => continue,
            };
            match f(src) {
                Some(p) => *src = p,
                None => return Err(format!("Không tìm thấy nguồn '{src}' của lớp '{}'", l.name)),
            }
        }
        Ok(())
    }
}

/// "#RRGGBB" | "#RRGGBBAA" | "#RGB" → (r,g,b,a)
pub fn parse_color(s: &str) -> (u8, u8, u8, u8) {
    let h = s.trim().trim_start_matches('#');
    let hex = |i: usize| u8::from_str_radix(h.get(i..i + 2).unwrap_or("ff"), 16).unwrap_or(255);
    match h.len() {
        3 => {
            let d = |i: usize| u8::from_str_radix(&h[i..i + 1].repeat(2), 16).unwrap_or(255);
            (d(0), d(1), d(2), 255)
        }
        8 => (hex(0), hex(2), hex(4), hex(6)),
        _ => (hex(0), hex(2), hex(4), 255),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_editor_json() {
        let c: Composition = serde_json::from_str(r##"{
            "version":1,"canvas":{"width":1920,"height":1080,"fps":30,"background":"#000000"},"duration":4,
            "layers":[
              {"id":"a","name":"Chữ","start":0,"duration":4,"x":0.5,"y":0.5,"scale":1,"rotation":0,"opacity":100,
               "type":"text","text":"Xin chào","style":{"font":"Noto Sans","weight":700,"size":96,"color":"#FFFFFF","align":"center","letter_spacing":0,"max_width":0.9,"stroke":null},
               "animation":{"in":{"preset":"fade","duration":0.5},"out":null,"loop":null},
               "keyframes":{"x":[{"t":0,"value":0.2,"ease":"ease_out"},{"t":2,"value":0.8}]}},
              {"id":"b","type":"video","source":"asset:x","fit":"contain","trim_start":0,"volume":100,"muted":false,"start":0,"duration":3}
            ]}"##).unwrap();
        assert_eq!(c.layers.len(), 2);
        assert!(matches!(c.layers[1].kind, LayerKind::Video { .. }));
        assert_eq!(parse_color("#FF000080"), (255, 0, 0, 128));
    }
}

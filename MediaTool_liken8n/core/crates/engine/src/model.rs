//! Composition (bản dựng). Khớp với `packages/editor/src/model.ts` và `docs/COMPOSITION_FORMAT.md`.
//! Thời gian: giây; vị trí: tỉ lệ 0..1; độ dài (viền, bóng…): pixel theo khung cao 1080.
//!
//! Nguyên tắc "viết một lần, dùng mọi nơi": các thành phần cơ bản — `Timing`/`TimeRef`, `Fill`, `Stroke`, `Shadow`,
//! `Effect`, `Anim` — định nghĩa một lần ở đây và gắn được cho mọi loại lớp. Bản dựng cũ (animation in/out/loop,
//! style.color/gradient/stroke/shadow/glow…) được `prepare()` tự chuyển sang dạng mới.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Composition {
    #[serde(default = "one")]
    pub version: u32,
    pub canvas: Canvas,
    #[serde(default)]
    pub duration: f64,
    /// Mốc có tên trên timeline (điệp khúc, beat, cảnh…) — dùng làm điểm neo thời gian.
    #[serde(default)]
    pub markers: Vec<Marker>,
    #[serde(default)]
    pub layers: Vec<Layer>,
    /// Đã qua `prepare()` (chuẩn hóa + giải mốc thời gian) chưa.
    #[serde(skip)]
    pub prepared: bool,
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
pub struct Marker {
    #[serde(default)]
    pub id: String,
    #[serde(alias = "time")]
    pub start: f64,
    #[serde(default)]
    pub end: Option<f64>,
    #[serde(default)]
    pub label: Option<String>,
    /// beat | downbeat | section | scene | … (tùy ý)
    #[serde(default)]
    pub kind: Option<String>,
}

// ------------------------------------------------------------------ thời gian

/// Một mốc thời gian: số giây tuyệt đối, hoặc neo vào thứ khác (+ lệch `offset` giây).
///
/// `ref`: `self.start` · `self.end` · `layer:<id>.start|end` · `marker:<id>[.end]` · `beat` / `downbeat` (kèm `n`, đếm từ 1)
/// · `kind:<loại>` (mốc thứ `n` có `kind` đó) · `comp.start` · `comp.end`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TimeRef {
    Abs(f64),
    Ref {
        #[serde(rename = "ref")]
        r: String,
        #[serde(default)]
        offset: f64,
        #[serde(default)]
        n: Option<u32>,
    },
}

/// Thời gian đầu/cuối — gắn được cho lớp, animation, effect, đoạn chữ.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Timing {
    #[serde(default)]
    pub start: Option<TimeRef>,
    #[serde(default)]
    pub end: Option<TimeRef>,
    /// thay cho `end` (giây tính từ `start`)
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub repeat: Option<Repeat>,
}

/// Lặp trong khoảng của `Timing`: mỗi `every` giây, hoặc tại mỗi mốc (`{"ref":"beat"}`, `{"ref":"kind:scene"}`…).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Repeat {
    pub every: TimeRef,
    /// độ dài mỗi lần (giây); mặc định = độ dài của animation hoặc khoảng giữa hai lần
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub count: Option<u32>,
}

// ------------------------------------------------------------------ tô màu, viền, bóng

/// Tô màu: chuỗi màu "#RRGGBB[AA]" hoặc `{type: solid|linear|radial|sweep|image, …}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Fill {
    Color(String),
    Spec(FillSpec),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum FillSpec {
    Solid { color: String },
    /// `angle`: độ, 0 = trái→phải, 90 = trên→dưới
    Linear {
        stops: Vec<Stop>,
        #[serde(default = "ninety")]
        angle: f64,
    },
    /// tâm `cx,cy` và bán kính `r` theo tỉ lệ khung chứa (0..1)
    Radial {
        stops: Vec<Stop>,
        #[serde(default = "center")]
        cx: f64,
        #[serde(default = "center")]
        cy: f64,
        #[serde(default = "center")]
        r: f64,
    },
    Sweep {
        stops: Vec<Stop>,
        #[serde(default = "center")]
        cx: f64,
        #[serde(default = "center")]
        cy: f64,
        #[serde(default)]
        angle: f64,
    },
    /// Tô bằng ảnh (vân vàng, kim loại, bầu trời…): ảnh phủ kín khung chứa, `scale` > 1 để phóng to họa tiết.
    Image {
        source: String,
        #[serde(default = "one_f")]
        scale: f64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Stop {
    Color(String),
    At { color: String, pos: f64 },
}

/// Một lớp viền. Danh sách viền tính từ trong ra ngoài; mỗi `width` đo từ mép nét chữ/hình.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stroke {
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub fill: Option<Fill>,
    #[serde(default = "four")]
    pub width: f64,
    /// round | miter | bevel
    #[serde(default)]
    pub join: Option<String>,
    #[serde(default = "hundred")]
    pub opacity: f64,
}

impl Stroke {
    pub fn fill(&self) -> Fill {
        self.fill.clone().unwrap_or_else(|| Fill::Color(self.color.clone().unwrap_or_else(black)))
    }
}

/// Một lớp bóng/phát sáng. `kind`: drop (mặc định) | glow | neon | long | extrude.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shadow {
    #[serde(default = "shadow_color")]
    pub color: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub blur: f64,
    /// nở bóng ra trước khi làm mờ
    #[serde(default)]
    pub spread: f64,
    #[serde(default)]
    pub kind: Option<String>,
    /// độ dài cho long / extrude (hướng theo x,y)
    #[serde(default)]
    pub length: f64,
    #[serde(default = "hundred")]
    pub opacity: f64,
}

// ------------------------------------------------------------------ hiệu ứng, chuyển động, keyframe

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Effect {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub amount: f64,
    #[serde(default)]
    pub timing: Option<Timing>,
    /// giây để hiệu ứng mạnh dần ở đầu và yếu dần ở cuối khoảng thời gian
    #[serde(default)]
    pub ramp: f64,
    /// engine tự tính từ `timing`, chỉ để đọc
    #[serde(default, rename = "_window", skip_serializing_if = "Option::is_none")]
    pub window: Option<(f64, f64)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keyframe {
    /// giây tính từ lúc lớp bắt đầu
    pub t: f64,
    /// số hoặc màu "#RRGGBB[AA]"
    pub value: Value,
    #[serde(default)]
    pub ease: Option<String>,
    /// Easing tùy chỉnh kiểu CSS cubic-bezier(x1, y1, x2, y2); có thì ưu tiên hơn `ease`
    #[serde(default)]
    pub bezier: Option<[f64; 4]>,
}

/// Chọn phần nào của lớp chịu animation (khi `unit` ≠ layer).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Select {
    /// [đầu, cuối) theo thứ tự đơn vị (chữ cái / từ / dòng)
    #[serde(default)]
    pub range: Option<[usize; 2]>,
    /// chỉ các đơn vị có chứa đoạn chữ này (không phân biệt hoa thường)
    #[serde(default, rename = "match")]
    pub matches: Option<String>,
    /// cứ mỗi n đơn vị lấy 1
    #[serde(default)]
    pub every: Option<usize>,
}

/// Một chuyển động: preset + khoảng thời gian áp dụng + đơn vị (cả lớp / dòng / từ / chữ cái) + phần được chọn.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Anim {
    pub preset: String,
    /// in | out | loop | emphasis — bỏ trống thì suy ra từ preset
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub timing: Option<Timing>,
    /// độ dài mặc định khi không có `timing` (giây)
    #[serde(default)]
    pub duration: Option<f64>,
    /// layer | line | word | char
    #[serde(default)]
    pub unit: Option<String>,
    /// độ trễ giữa các đơn vị (giây)
    #[serde(default)]
    pub stagger: Option<f64>,
    /// forward | backward | center | edges | random
    #[serde(default)]
    pub order: Option<String>,
    #[serde(default)]
    pub ease: Option<String>,
    #[serde(default)]
    pub select: Option<Select>,
    /// độ mạnh (1 = mặc định)
    #[serde(default = "one_f")]
    pub intensity: f64,
    /// chu kỳ (giây) cho loại lặp
    #[serde(default)]
    pub period: Option<f64>,
    /// các khoảng [đầu, cuối) tuyệt đối sau khi giải mốc (nhiều khoảng nếu có `repeat`) — engine tự tính, chỉ để đọc
    #[serde(default, rename = "_windows", skip_serializing_if = "Vec::is_empty")]
    pub windows: Vec<(f64, f64)>,
}

/// Bản dựng cũ: ba ô cố định (đổi sang `animations` khi `prepare`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnimPreset {
    pub preset: String,
    #[serde(default = "half")]
    pub duration: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LegacyAnimation {
    #[serde(default, rename = "in")]
    pub in_: Option<AnimPreset>,
    #[serde(default)]
    pub out: Option<AnimPreset>,
    #[serde(default, rename = "loop")]
    pub loop_: Option<AnimPreset>,
}

// ------------------------------------------------------------------ lớp

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layer {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub start: f64,
    #[serde(default = "five")]
    pub duration: f64,
    /// Thời gian đầu/cuối theo mốc (ưu tiên hơn start/duration)
    #[serde(default)]
    pub timing: Option<Timing>,
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
    pub animations: Vec<Anim>,
    /// dạng cũ — `prepare` đổi sang `animations`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animation: Option<LegacyAnimation>,
    /// keyframe theo đường dẫn thuộc tính bất kỳ: "x", "opacity", "style.size", "effects.0.amount", "strokes.1.color"…
    #[serde(default)]
    pub keyframes: BTreeMap<String, Vec<Keyframe>>,
    #[serde(default)]
    pub effects: Vec<Effect>,
    /// Viền nhiều lớp — dùng cho mọi loại lớp (chữ/hình: viền vector; ảnh/video: viền theo hình dạng điểm ảnh)
    #[serde(default)]
    pub strokes: Vec<Stroke>,
    /// Bóng / phát sáng nhiều lớp — dùng cho mọi loại lớp
    #[serde(default)]
    pub shadows: Vec<Shadow>,
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
    #[serde(default)]
    pub feather: f64,
    #[serde(default)]
    pub radius: f64,
    #[serde(default)]
    pub invert: bool,
}

impl Layer {
    pub fn end(&self) -> f64 {
        self.start + self.duration
    }
    pub fn active_at(&self, t: f64) -> bool {
        !self.hidden && t >= self.start && t < self.end()
    }
}

/// Một đoạn chữ có kiểu riêng (rich text): `style` là phần thay đổi so với kiểu chung (font, size, fill, strokes…),
/// tùy chọn chỉ áp trong `timing`. `start`/`end`: vị trí ký tự (đếm theo ký tự Unicode).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Span {
    pub start: usize,
    pub end: usize,
    #[serde(default)]
    pub style: Value,
    #[serde(default)]
    pub timing: Option<Timing>,
    /// engine tự tính từ `timing`, chỉ để đọc
    #[serde(default, rename = "_window", skip_serializing_if = "Option::is_none")]
    pub window: Option<(f64, f64)>,
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
        #[serde(default)]
        spans: Vec<Span>,
    },
    Shape {
        #[serde(default = "rect")]
        shape: String,
        #[serde(default = "point3")]
        w: f64,
        #[serde(default = "point2")]
        h: f64,
        #[serde(default = "blue_fill")]
        fill: Fill,
        /// dạng cũ — `prepare` đổi sang `layer.strokes`
        #[serde(default, skip_serializing_if = "Option::is_none")]
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
pub struct Warp {
    /// arc (uốn vòng cung) | wave (lượn sóng)
    #[serde(rename = "type")]
    pub kind: String,
    /// -100..100
    #[serde(default)]
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoxBg {
    #[serde(default = "black_half")]
    pub color: String,
    #[serde(default)]
    pub fill: Option<Fill>,
    #[serde(default = "point3")]
    pub padding: f64,
    #[serde(default)]
    pub radius: f64,
    /// box (một khung cho cả đoạn) | line (mỗi dòng một khung, kiểu phụ đề)
    #[serde(default)]
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Gradient {
    pub colors: Vec<String>,
    #[serde(default = "ninety")]
    pub angle: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Glow {
    pub color: String,
    #[serde(default = "twelve")]
    pub radius: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextStyle {
    #[serde(default = "noto")]
    pub font: String,
    #[serde(default = "seven_hundred")]
    pub weight: f64,
    /// cỡ chữ theo khung cao 1080
    #[serde(default = "ninety_six")]
    pub size: f64,
    #[serde(default)]
    pub fill: Option<Fill>,
    #[serde(default)]
    pub background: Option<BoxBg>,
    #[serde(default = "center_s")]
    pub align: String,
    #[serde(default)]
    pub letter_spacing: f64,
    #[serde(default)]
    pub word_spacing: f64,
    #[serde(default = "point9")]
    pub max_width: f64,
    /// khoảng cách dòng (bội số cỡ chữ); 0 = mặc định của font
    #[serde(default)]
    pub line_height: f64,
    #[serde(default)]
    pub italic: bool,
    #[serde(default)]
    pub underline: bool,
    #[serde(default)]
    pub strikethrough: bool,
    /// none | upper | lower | title
    #[serde(default)]
    pub case: Option<String>,
    #[serde(default)]
    pub warp: Option<Warp>,
    /// Chỉ dùng trong `spans[].style` để ghi đè viền của một đoạn; viền chung của chữ là `layer.strokes`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub strokes: Vec<Stroke>,
    // ---- dạng cũ (prepare đổi sang fill / layer.strokes / layer.shadows)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gradient: Option<Gradient>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<Stroke>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<Shadow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub glow: Option<Glow>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub uppercase: bool,
}

impl TextStyle {
    pub fn fill(&self) -> Fill {
        self.fill.clone().unwrap_or_else(|| Fill::Color("#FFFFFF".into()))
    }
}

fn one() -> u32 { 1 }
pub(crate) fn one_f() -> f64 { 1.0 }
fn thirty() -> f64 { 30.0 }
fn half() -> f64 { 0.5 }
fn five() -> f64 { 5.0 }
fn four() -> f64 { 4.0 }
fn center() -> f64 { 0.5 }
fn hundred() -> f64 { 100.0 }
fn ninety() -> f64 { 90.0 }
fn twelve() -> f64 { 12.0 }
fn point2() -> f64 { 0.2 }
fn point3() -> f64 { 0.3 }
fn point6() -> f64 { 0.6 }
fn point9() -> f64 { 0.9 }
fn seven_hundred() -> f64 { 700.0 }
fn ninety_six() -> f64 { 96.0 }
fn black() -> String { "#000000".into() }
fn black_half() -> String { "#00000099".into() }
fn shadow_color() -> String { "#000000AA".into() }
fn blue_fill() -> Fill { Fill::Color("#2F6FED".into()) }
fn noto() -> String { "Noto Sans".into() }
fn contain() -> String { "contain".into() }
fn rect() -> String { "rect".into() }
fn center_s() -> String { "center".into() }

impl Composition {
    pub fn end(&self) -> f64 {
        self.layers.iter().map(Layer::end).fold(self.duration.max(0.0), f64::max)
    }

    /// Đổi mọi `source` (nguồn của lớp, ảnh dùng để tô màu) theo hàm ánh xạ (ví dụ "asset:<id>" → đường dẫn file).
    pub fn resolve_sources(&mut self, mut f: impl FnMut(&str) -> Option<String>) -> Result<(), String> {
        for l in &mut self.layers {
            let name = l.name.clone();
            let mut srcs: Vec<&mut String> = Vec::new();
            match &mut l.kind {
                LayerKind::Video { source, .. } | LayerKind::Image { source, .. } | LayerKind::Audio { source, .. } => srcs.push(source),
                LayerKind::Text { style, .. } => {
                    if let Some(Fill::Spec(FillSpec::Image { source, .. })) = &mut style.fill {
                        srcs.push(source)
                    }
                }
                LayerKind::Shape { fill: Fill::Spec(FillSpec::Image { source, .. }), .. } => srcs.push(source),
                _ => {}
            }
            for s in &mut l.strokes {
                if let Some(Fill::Spec(FillSpec::Image { source, .. })) = &mut s.fill {
                    srcs.push(source)
                }
            }
            for src in srcs {
                match f(src) {
                    Some(p) => *src = p,
                    None => return Err(format!("Không tìm thấy nguồn '{src}' của lớp '{name}'")),
                }
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

pub fn format_color((r, g, b, a): (u8, u8, u8, u8)) -> String {
    if a == 255 { format!("#{r:02X}{g:02X}{b:02X}") } else { format!("#{r:02X}{g:02X}{b:02X}{a:02X}") }
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
              {"id":"b","type":"video","source":"asset:x","fit":"contain","trim_start":0,"volume":100,"muted":false,"start":0,"duration":3},
              {"id":"c","type":"shape","shape":"rect","fill":{"type":"linear","stops":["#f00",{"color":"#00f","pos":1}]},"start":0,"duration":2,
               "strokes":[{"color":"#fff","width":6},{"fill":{"type":"radial","stops":["#000","#333"]},"width":12}],
               "shadows":[{"kind":"long","color":"#000","x":1,"y":1,"length":40}]}
            ]}"##).unwrap();
        assert_eq!(c.layers.len(), 3);
        assert!(matches!(c.layers[1].kind, LayerKind::Video { .. }));
        assert!(matches!(&c.layers[2].kind, LayerKind::Shape { fill: Fill::Spec(FillSpec::Linear { .. }), .. }));
        assert_eq!(parse_color("#FF000080"), (255, 0, 0, 128));
        assert_eq!(format_color((255, 0, 0, 128)), "#FF000080");
    }
}

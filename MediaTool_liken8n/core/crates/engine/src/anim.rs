//! Chuyển động: MỘT bảng preset dùng chung cho cả lớp, từng dòng, từng từ, từng chữ cái.
//! Thuần dữ liệu, không đụng pixel — dùng chung cho xem trước và xuất video.
//!
//! - Preset loại `in` được mô tả bằng "trạng thái xuất phát" (lệch, phóng, xoay, mờ…) rồi nội suy về bình thường;
//!   loại `out` là chiều ngược lại của preset `in` đối xứng → không phải viết hai lần.
//! - `loop` chạy theo chu kỳ trong khoảng áp dụng; `emphasis` là nhấn một lần (nảy, đập, rung…).
//! - Khoảng áp dụng (`windows`) đã được `prepare` giải sẵn từ `timing` (kể cả lặp theo beat).

use crate::model::{Anim, Keyframe, Layer};
use serde_json::Value;
use std::f64::consts::PI;

/// Thay đổi do animation gây ra. Lệch `dx/dy` theo đơn vị tương đối (lớp: tỉ lệ khung; đơn vị chữ: × cỡ chữ × 10).
#[derive(Debug, Clone, Copy)]
pub struct Delta {
    pub dx: f64,
    pub dy: f64,
    pub scale: f64,
    pub sx: f64,
    pub sy: f64,
    pub rot: f64,
    pub opacity: f64,
    pub blur: f64,
    pub hue: f64,
    pub wipe: Option<(Wipe, f64)>,
}

impl Default for Delta {
    fn default() -> Self {
        Self { dx: 0.0, dy: 0.0, scale: 1.0, sx: 1.0, sy: 1.0, rot: 0.0, opacity: 1.0, blur: 0.0, hue: 0.0, wipe: None }
    }
}

impl Delta {
    pub fn add(&mut self, o: &Delta) {
        self.dx += o.dx;
        self.dy += o.dy;
        self.scale *= o.scale;
        self.sx *= o.sx;
        self.sy *= o.sy;
        self.rot += o.rot;
        self.opacity *= o.opacity;
        self.blur += o.blur;
        self.hue += o.hue;
        if o.wipe.is_some() {
            self.wipe = o.wipe;
        }
    }
    pub fn is_identity(&self) -> bool {
        self.dx == 0.0 && self.dy == 0.0 && self.scale == 1.0 && self.sx == 1.0 && self.sy == 1.0 && self.rot == 0.0
            && self.opacity == 1.0 && self.blur == 0.0 && self.hue == 0.0 && self.wipe.is_none()
    }
}

/// Trạng thái cuối của cả lớp tại thời điểm t.
#[derive(Debug, Clone, Copy)]
pub struct State {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub sx: f64,
    pub sy: f64,
    pub rotation: f64,
    /// 0..1
    pub opacity: f64,
    /// làm mờ thêm do animation (theo pixel khung 1080)
    pub blur: f64,
    /// xoay màu thêm (độ)
    pub hue: f64,
    pub wipe: Option<(Wipe, f64)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wipe {
    Left,
    Right,
    Up,
    Down,
    Circle,
}

impl Wipe {
    fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "wipe_left" => Wipe::Left,
            "wipe_right" => Wipe::Right,
            "wipe_up" => Wipe::Up,
            "wipe_down" => Wipe::Down,
            "circle_open" | "circle_close" => Wipe::Circle,
            _ => return None,
        })
    }
}

// ------------------------------------------------------------------ easing

/// Easing cubic-bezier kiểu CSS (bê từ OpenCut `animation/bezier.ts`, MIT): giải x bằng chia đôi rồi lấy y.
pub fn cubic_bezier(b: [f64; 4], p: f64) -> f64 {
    let point = |t: f64, p1: f64, p2: f64| {
        let mt = 1.0 - t;
        3.0 * mt * mt * t * p1 + 3.0 * mt * t * t * p2 + t * t * t
    };
    let (mut lo, mut hi) = (0.0, 1.0);
    for _ in 0..24 {
        let mid = (lo + hi) / 2.0;
        if point(mid, b[0], b[2]) < p { lo = mid } else { hi = mid }
    }
    point((lo + hi) / 2.0, b[1], b[3])
}

pub fn ease(name: Option<&str>, p: f64) -> f64 {
    let p = p.clamp(0.0, 1.0);
    match name.unwrap_or("ease_out") {
        "linear" => p,
        "ease_in" => p * p * p,
        "ease_out" => 1.0 - (1.0 - p).powi(3),
        "ease_in_out" => if p < 0.5 { 4.0 * p * p * p } else { 1.0 - (-2.0 * p + 2.0).powi(3) / 2.0 },
        "back" => {
            let (c1, c3) = (1.70158, 2.70158);
            1.0 + c3 * (p - 1.0).powi(3) + c1 * (p - 1.0).powi(2)
        }
        "elastic" => {
            if p == 0.0 || p == 1.0 { p } else { 2f64.powf(-10.0 * p) * ((p * 10.0 - 0.75) * (2.0 * PI / 3.0)).sin() + 1.0 }
        }
        "bounce" => bounce_out(p),
        "step" => if p > 0.0 { 1.0 } else { 0.0 },
        _ => 1.0 - (1.0 - p).powi(3),
    }
}

fn bounce_out(p: f64) -> f64 {
    let (n1, d1) = (7.5625, 2.75);
    if p < 1.0 / d1 {
        n1 * p * p
    } else if p < 2.0 / d1 {
        let p = p - 1.5 / d1;
        n1 * p * p + 0.75
    } else if p < 2.5 / d1 {
        let p = p - 2.25 / d1;
        n1 * p * p + 0.9375
    } else {
        let p = p - 2.625 / d1;
        n1 * p * p + 0.984375
    }
}

fn hash01(x: f64) -> f64 {
    let n = (x * 12.9898).sin() * 43758.5453;
    n.fract().abs()
}

// ------------------------------------------------------------------ bảng preset

/// Trạng thái xuất phát của preset `in` (rồi nội suy về bình thường).
struct From {
    dx: f64,
    dy: f64,
    scale: f64,
    sx: f64,
    sy: f64,
    rot: f64,
    op: f64,
    blur: f64,
    ease: &'static str,
    /// hiện rõ nhanh (trong 1/3 đầu) dù chuyển động còn tiếp
    fast_alpha: bool,
}

const F: From = From { dx: 0.0, dy: 0.0, scale: 1.0, sx: 1.0, sy: 1.0, rot: 0.0, op: 1.0, blur: 0.0, ease: "ease_out", fast_alpha: false };

fn in_preset(name: &str) -> Option<From> {
    Some(match name {
        "fade" => From { op: 0.0, ..F },
        "fade_up" => From { op: 0.0, dy: 0.05, ..F },
        "fade_down" => From { op: 0.0, dy: -0.05, ..F },
        "fade_left" => From { op: 0.0, dx: 0.05, ..F },
        "fade_right" => From { op: 0.0, dx: -0.05, ..F },
        "slide_left" => From { dx: 0.6, op: 0.4, ..F },
        "slide_right" => From { dx: -0.6, op: 0.4, ..F },
        "slide_up" => From { dy: 0.5, op: 0.4, ..F },
        "slide_down" => From { dy: -0.5, op: 0.4, ..F },
        "zoom_in" => From { scale: 0.3, op: 0.0, ..F },
        "zoom_out" => From { scale: 2.0, op: 0.0, ..F },
        "pop" => From { scale: 0.5, op: 0.0, ease: "back", fast_alpha: true, ..F },
        "pop_bounce" => From { scale: 0.0, op: 0.0, ease: "back", fast_alpha: true, ..F },
        "elastic_in" => From { scale: 0.0, op: 0.0, ease: "elastic", fast_alpha: true, ..F },
        "drop" => From { dy: -0.35, op: 0.0, ease: "bounce", fast_alpha: true, ..F },
        "rise" => From { dy: 0.12, op: 0.0, ease: "back", ..F },
        "blur_in" => From { blur: 30.0, op: 0.0, ..F },
        "spin_in" => From { rot: -180.0, scale: 0.01, ..F },
        "flip_in" => From { sx: 0.0, ease: "back", ..F },
        "flip_up" => From { sy: 0.0, ease: "back", ..F },
        "stretch_in" => From { sx: 1.6, sy: 0.2, op: 0.0, ease: "elastic", fast_alpha: true, ..F },
        "swing_in" => From { rot: -25.0, dy: -0.05, op: 0.0, ease: "back", ..F },
        "typewriter" => From { op: 0.0, ease: "step", ..F },
        _ => return None,
    })
}

/// Preset `out` = chiều ngược của preset `in` đối xứng.
fn out_mirror(name: &str) -> &str {
    match name {
        "slide_left" => "slide_right",
        "slide_right" => "slide_left",
        "slide_up" => "slide_down",
        "slide_down" => "slide_up",
        "fade_up" => "fade_down",
        "fade_down" => "fade_up",
        "fade_left" => "fade_right",
        "fade_right" => "fade_left",
        "zoom_in" => "zoom_out",
        "zoom_out" => "zoom_in",
        "drop_out" => "rise",
        "pop_out" => "pop",
        "blur_out" => "blur_in",
        "spin_out" => "spin_in",
        "flip_out" => "flip_in",
        "circle_close" => "circle_open",
        // "fade_out", "glitch_out"… → chiều ngược của "fade", "glitch"…
        other => match other.strip_suffix("_out") {
            Some(base) if in_preset(base).is_some() || Wipe::parse(base).is_some() => base,
            Some(base) if base == "glitch" => "glitch_in",
            _ => other,
        },
    }
}

const LOOPS: &[&str] = &["float", "pulse", "breathe", "shake", "swing", "rotate", "flicker", "blink", "wave", "jiggle", "heartbeat", "rainbow", "bounce_loop"];
const EMPHASIS: &[&str] = &["bounce", "jump", "punch", "flash", "rubber", "tada", "wobble", "headshake"];

/// Loại mặc định của preset khi `kind` để trống.
pub fn kind_of(preset: &str) -> &'static str {
    if LOOPS.contains(&preset) {
        "loop"
    } else if EMPHASIS.contains(&preset) {
        "emphasis"
    } else if preset.ends_with("_out") || preset == "circle_close" {
        "out"
    } else {
        "in"
    }
}

/// Đơn vị mặc định của preset (gõ chữ thì theo từng chữ cái, sóng thì theo từng chữ cái).
pub fn default_unit(preset: &str) -> Option<&'static str> {
    match preset {
        "typewriter" | "wave" => Some("char"),
        _ => None,
    }
}

/// Delta của một animation tại thời điểm `t` trong khoảng [a, b). `phase`: lệch pha (cho loop theo đơn vị).
fn eval(a: &Anim, kind: &str, wa: f64, wb: f64, t: f64, phase: f64, repeated: bool) -> Option<Delta> {
    let len = (wb - wa).max(1e-6);
    let inside = t >= wa && t < wb;
    let raw = ((t - wa) / len).clamp(0.0, 1.0);
    let k = a.intensity;
    let mut d = Delta::default();
    match kind {
        "in" | "out" => {
            let (p, active) = match kind {
                "in" => (if t < wa { 0.0 } else { raw }, t < wb && (inside || !repeated)),
                _ => (if t >= wb { 1.0 } else { raw }, t >= wa && (inside || !repeated)),
            };
            if !active {
                return None;
            }
            let name = if kind == "out" { out_mirror(&a.preset) } else { a.preset.as_str() };
            // q: tiến độ "hiện ra" (in: p; out: 1-p)
            let q = if kind == "out" { 1.0 - p } else { p };
            if let Some(w) = Wipe::parse(name) {
                d.wipe = Some((w, ease(a.ease.as_deref(), q)));
                return Some(d);
            }
            if name == "glitch_in" {
                if q < 1.0 {
                    let n = (t * 30.0).floor();
                    d.dx = (hash01(n) - 0.5) * 0.06 * (1.0 - q) * k;
                    d.opacity = if hash01(n + 7.0) < 0.25 + 0.75 * q { 1.0 } else { 0.2 };
                }
                return Some(d);
            }
            let f = in_preset(name)?;
            let e = ease(Some(a.ease.as_deref().unwrap_or(f.ease)), q);
            let ea = if f.fast_alpha { (q * 3.0).min(1.0) } else { e.clamp(0.0, 1.0) };
            let r = 1.0 - e; // phần còn lệch
            d.dx = f.dx * r * k;
            d.dy = f.dy * r * k;
            d.scale = (1.0 + (f.scale - 1.0) * r * k).max(0.0);
            d.sx = (1.0 + (f.sx - 1.0) * r * k).max(0.0);
            d.sy = (1.0 + (f.sy - 1.0) * r * k).max(0.0);
            d.rot = f.rot * r * k;
            d.blur = f.blur * r * k;
            d.opacity = f.op + (1.0 - f.op) * ea;
        }
        "loop" => {
            if !inside {
                return None;
            }
            let period = a.period.unwrap_or(match a.preset.as_str() {
                "breathe" => 3.0,
                "rotate" => 4.0,
                "rainbow" => 3.0,
                _ => 1.0,
            }).max(0.05);
            let ph = (t - wa) / period + phase;
            let s = (ph * 2.0 * PI).sin();
            match a.preset.as_str() {
                "float" => d.dy = 0.012 * s * k,
                "pulse" => d.scale = 1.0 + 0.05 * s * k,
                "breathe" => d.scale = 1.0 + 0.03 * s * k,
                "shake" => {
                    d.dx = 0.004 * (ph * 12.0 * PI).sin() * k;
                    d.dy = 0.003 * (ph * 14.0 * PI).cos() * k;
                }
                "swing" => d.rot = 8.0 * s * k,
                "rotate" => d.rot = 360.0 * ph.fract() * k,
                "flicker" => d.opacity = 0.55 + 0.45 * hash01(((t - wa) * 12.0).floor() + phase * 100.0),
                "blink" => d.opacity = if ph.fract() < 0.5 { 1.0 } else { 1.0 - 0.85 * k.min(1.0) },
                "wave" => d.dy = 0.02 * s * k,
                "jiggle" => {
                    d.rot = 4.0 * (ph * 6.0 * PI).sin() * k;
                    d.dx = 0.002 * (ph * 4.0 * PI).cos() * k;
                }
                "heartbeat" => {
                    let f = ph.fract();
                    let beat = (-(f - 0.1).powi(2) / 0.002).exp() + 0.6 * (-(f - 0.3).powi(2) / 0.002).exp();
                    d.scale = 1.0 + 0.08 * beat * k;
                }
                "rainbow" => d.hue = 360.0 * ph.fract() * k,
                "bounce_loop" => d.dy = -0.03 * (ph * PI).sin().abs() * k,
                _ => return None,
            }
        }
        "emphasis" => {
            if !inside {
                return None;
            }
            let p = raw;
            let decay = 1.0 - p;
            match a.preset.as_str() {
                "bounce" => d.dy = -0.06 * (p * PI).sin() * (p * 3.0 * PI).cos().abs() * k,
                "jump" => d.dy = -0.1 * 4.0 * p * (1.0 - p) * k,
                "punch" => d.scale = 1.0 + 0.25 * decay * decay * k,
                "flash" => d.opacity = 1.0 - 0.85 * (p * PI).sin() * k.min(1.0),
                "rubber" => {
                    let w = (p * 2.0 * PI).sin() * decay * 0.25 * k;
                    d.sx = 1.0 + w;
                    d.sy = 1.0 - w;
                }
                "tada" => {
                    d.scale = 1.0 + 0.12 * (p * PI).sin() * k;
                    d.rot = 8.0 * (p * 6.0 * PI).sin() * decay * k;
                }
                "wobble" => {
                    d.dx = 0.03 * (p * 4.0 * PI).sin() * decay * k;
                    d.rot = -5.0 * (p * 4.0 * PI).sin() * decay * k;
                }
                "headshake" => d.dx = 0.02 * (p * 6.0 * PI).sin() * decay * k,
                _ => return None,
            }
        }
        _ => return None,
    }
    Some(d)
}

/// Delta tổng của các animation `anims` cho một phần tử (thứ tự `r` trong `m` phần tử được chọn).
fn delta_of(anims: &[&Anim], t: f64, idx: Option<(usize, usize)>) -> Delta {
    let mut d = Delta::default();
    for a in anims {
        let kind = a.kind.as_deref().unwrap_or("in");
        let repeated = a.windows.len() > 1;
        for &(wa, wb) in &a.windows {
            let (mut ua, mut ub, mut phase) = (wa, wb, 0.0);
            if let Some((r, m)) = idx {
                let len = wb - wa;
                let typing = a.preset == "typewriter";
                let st = a.stagger.unwrap_or(if kind == "loop" {
                    0.08
                } else if typing {
                    len / m.max(1) as f64
                } else {
                    len * 0.5 / m.max(1) as f64
                });
                if kind == "loop" {
                    phase = -(r as f64) * st / a.period.unwrap_or(1.0).max(0.05);
                } else {
                    let ud = if typing { 1e-4 } else { (len - st * (m.saturating_sub(1)) as f64).max(0.05) };
                    ua = wa + r as f64 * st;
                    ub = ua + ud;
                }
            }
            if let Some(x) = eval(a, kind, ua, ub, t, phase, repeated) {
                d.add(&x);
            }
        }
    }
    d
}

// ------------------------------------------------------------------ keyframe

fn kf_value(v: &Value) -> Option<f64> {
    v.as_f64()
}

/// Giá trị keyframe số tại thời điểm cục bộ `lt`. Ease của keyframe đích quyết định đoạn chuyển.
fn keyframed(kfs: &[Keyframe], lt: f64, fallback: f64) -> f64 {
    match interp(kfs, lt) {
        Some((a, b, e)) => match (kf_value(&a.value), kf_value(&b.value)) {
            (Some(x), Some(y)) => x + (y - x) * e,
            _ => fallback,
        },
        None => fallback,
    }
}

/// Hai keyframe bao quanh `lt` + tiến độ đã ease (dùng chung cho số và màu).
pub fn interp(kfs: &[Keyframe], lt: f64) -> Option<(&Keyframe, &Keyframe, f64)> {
    if kfs.is_empty() {
        return None;
    }
    let mut ks: Vec<&Keyframe> = kfs.iter().collect();
    ks.sort_by(|a, b| a.t.total_cmp(&b.t));
    if lt <= ks[0].t {
        return Some((ks[0], ks[0], 0.0));
    }
    for w in ks.windows(2) {
        let (a, b) = (w[0], w[1]);
        if lt <= b.t {
            let p = ((lt - a.t) / (b.t - a.t).max(1e-9)).clamp(0.0, 1.0);
            let e = match b.bezier.or(a.bezier) {
                Some(bz) => cubic_bezier(bz, p),
                None => ease(b.ease.as_deref().or(a.ease.as_deref()), p),
            };
            return Some((a, b, e));
        }
    }
    let last = ks[ks.len() - 1];
    Some((last, last, 0.0))
}

/// Thuộc tính biến đổi được tính thẳng ở đây; mọi đường dẫn khác do `render` áp qua JSON.
pub const CORE_PROPS: &[&str] = &["x", "y", "scale", "rotation", "opacity"];

// ------------------------------------------------------------------ API

fn is_layer_unit(a: &Anim) -> bool {
    matches!(a.unit.as_deref(), None | Some("layer"))
}

pub fn state_at(l: &Layer, t: f64) -> State {
    let lt = t - l.start;
    let kf = |name: &str, fallback: f64| keyframed(l.keyframes.get(name).map(Vec::as_slice).unwrap_or(&[]), lt, fallback);
    let anims: Vec<&Anim> = l.animations.iter().filter(|a| is_layer_unit(a)).collect();
    let d = delta_of(&anims, t, None);
    State {
        x: kf("x", l.x) + d.dx,
        y: kf("y", l.y) + d.dy,
        scale: kf("scale", l.scale) * d.scale,
        sx: d.sx,
        sy: d.sy,
        rotation: kf("rotation", l.rotation) + d.rot,
        opacity: ((kf("opacity", l.opacity) / 100.0) * d.opacity).clamp(0.0, 1.0),
        blur: d.blur,
        hue: d.hue,
        wipe: d.wipe,
    }
}

/// Lớp có animation theo đơn vị này không (line / word / char).
pub fn has_unit(l: &Layer, unit: &str) -> bool {
    l.animations.iter().any(|a| a.unit.as_deref() == Some(unit))
}

/// Delta cho từng đơn vị (`texts`: chữ của từng đơn vị, theo thứ tự) do các animation có `unit` này gây ra.
pub fn unit_deltas(l: &Layer, unit: &str, texts: &[String], t: f64) -> Vec<Delta> {
    let mut out = vec![Delta::default(); texts.len()];
    for a in l.animations.iter().filter(|a| a.unit.as_deref() == Some(unit)) {
        let sel: Vec<usize> = (0..texts.len())
            .filter(|&k| match &a.select {
                None => true,
                Some(s) => {
                    s.range.is_none_or(|[x, y]| k >= x && k < y)
                        && s.every.is_none_or(|e| e <= 1 || k % e == 0)
                        && s.matches.as_ref().is_none_or(|m| texts[k].to_lowercase().contains(&m.to_lowercase()))
                }
            })
            .collect();
        let m = sel.len();
        for (j, &k) in sel.iter().enumerate() {
            let r = match a.order.as_deref() {
                Some("backward") => m - 1 - j,
                Some("center") => ((j as f64) - (m as f64 - 1.0) / 2.0).abs().round() as usize,
                Some("edges") => (((m as f64 - 1.0) / 2.0) - ((j as f64) - (m as f64 - 1.0) / 2.0).abs()).round().max(0.0) as usize,
                Some("random") => {
                    let mut idx: Vec<usize> = (0..m).collect();
                    idx.sort_by(|x, y| hash01(*x as f64 + 1.3).total_cmp(&hash01(*y as f64 + 1.3)));
                    idx.iter().position(|v| *v == j).unwrap_or(j)
                }
                _ => j,
            };
            out[k].add(&delta_of(&[a], t, Some((r, m))));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Composition;

    #[test]
    fn eases_are_bounded_at_ends() {
        for e in ["linear", "ease_in", "ease_out", "ease_in_out", "back", "elastic", "bounce"] {
            assert!((ease(Some(e), 0.0)).abs() < 1e-6, "{e}");
            assert!((ease(Some(e), 1.0) - 1.0).abs() < 1e-6, "{e}");
        }
    }

    #[test]
    fn bezier_linear_is_identity() {
        assert!((cubic_bezier([0.0, 0.0, 1.0, 1.0], 0.3) - 0.3).abs() < 1e-3);
        assert!(cubic_bezier([0.175, 0.885, 0.32, 1.275], 0.6) > 1.0);
    }

    #[test]
    fn keyframes_interpolate() {
        let k = vec![
            Keyframe { t: 0.0, value: 0.0.into(), ease: Some("linear".into()), bezier: None },
            Keyframe { t: 2.0, value: 1.0.into(), ease: Some("linear".into()), bezier: None },
        ];
        assert!((keyframed(&k, 1.0, 9.0) - 0.5).abs() < 1e-9);
        assert_eq!(keyframed(&k, 5.0, 9.0), 1.0);
    }

    fn layer(anims: &str) -> Layer {
        let c: Composition = serde_json::from_str(&format!(
            r#"{{"canvas":{{"width":100,"height":100}},"layers":[{{"id":"a","type":"text","text":"abc","style":{{}},"start":0,"duration":4,"animations":{anims}}}]}}"#
        ))
        .unwrap();
        c.prepare().layers.remove(0)
    }

    #[test]
    fn in_out_and_windows() {
        let l = layer(r#"[{"preset":"fade","duration":1},{"preset":"fade_out","duration":1},{"preset":"pulse","kind":"loop","timing":{"start":2,"end":3}}]"#);
        assert!(state_at(&l, 0.0).opacity < 0.01);
        assert!((state_at(&l, 1.5).opacity - 1.0).abs() < 1e-9);
        assert!(state_at(&l, 3.99).opacity < 0.05);
        assert_eq!(state_at(&l, 1.25).scale, 1.0); // pulse chỉ chạy trong 2..3
        assert!(state_at(&l, 2.25).scale > 1.0);
    }

    #[test]
    fn unit_stagger_and_select() {
        let l = layer(r#"[{"preset":"typewriter","duration":3}]"#);
        let texts: Vec<String> = ["a", "b", "c"].iter().map(|s| s.to_string()).collect();
        let d = unit_deltas(&l, "char", &texts, 1.5);
        assert_eq!(d.iter().map(|x| x.opacity).collect::<Vec<_>>(), vec![1.0, 1.0, 0.0]);
        let l = layer(r#"[{"preset":"jump","kind":"emphasis","unit":"word","select":{"match":"B"},"timing":{"start":0,"end":1}}]"#);
        let d = unit_deltas(&l, "word", &texts, 0.5);
        assert!(d[0].dy == 0.0 && d[1].dy < 0.0 && d[2].dy == 0.0);
    }
}

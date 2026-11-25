//! Tính trạng thái của lớp tại thời điểm t: keyframe (có easing) + animation có sẵn (in / out / loop).
//! Thuần dữ liệu, không đụng pixel — dùng chung cho xem trước và xuất video.

use crate::model::{Keyframe, Layer};
use std::f64::consts::PI;

#[derive(Debug, Clone, Copy)]
pub struct State {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub rotation: f64,
    /// 0..1
    pub opacity: f64,
    /// làm mờ thêm do animation (theo pixel khung 1080)
    pub blur: f64,
    /// 0..1: hiện dần chữ (typewriter)
    pub reveal: f64,
    /// Transition kiểu wipe: (kiểu, tiến độ 0..1 phần đã lộ ra)
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

/// Giá trị keyframe tại thời điểm cục bộ `lt` (giây từ lúc lớp bắt đầu). Ease của keyframe đích quyết định đoạn chuyển.
fn keyframed(kfs: &[Keyframe], lt: f64, fallback: f64) -> f64 {
    if kfs.is_empty() {
        return fallback;
    }
    let mut ks: Vec<&Keyframe> = kfs.iter().collect();
    ks.sort_by(|a, b| a.t.total_cmp(&b.t));
    if lt <= ks[0].t {
        return ks[0].value;
    }
    for w in ks.windows(2) {
        let (a, b) = (w[0], w[1]);
        if lt <= b.t {
            let p = ((lt - a.t) / (b.t - a.t).max(1e-9)).clamp(0.0, 1.0);
            let e = match b.bezier.or(a.bezier) {
                Some(bz) => cubic_bezier(bz, p),
                None => ease(b.ease.as_deref().or(a.ease.as_deref()), p),
            };
            return a.value + (b.value - a.value) * e;
        }
    }
    ks[ks.len() - 1].value
}

pub fn state_at(l: &Layer, t: f64) -> State {
    let lt = t - l.start;
    let kf = |name: &str, fallback: f64| keyframed(l.keyframes.get(name).map(Vec::as_slice).unwrap_or(&[]), lt, fallback);
    let mut s = State {
        x: kf("x", l.x),
        y: kf("y", l.y),
        scale: kf("scale", l.scale),
        rotation: kf("rotation", l.rotation),
        opacity: (kf("opacity", l.opacity) / 100.0).clamp(0.0, 1.0),
        blur: 0.0,
        reveal: 1.0,
        wipe: None,
    };
    let Some(anim) = &l.animation else { return s };

    if let Some(a) = &anim.in_ {
        if a.duration > 0.0 && lt < a.duration {
            let p = lt / a.duration;
            let e = ease(Some("ease_out"), p);
            let k = 1.0 - e;
            match a.preset.as_str() {
                "fade" => s.opacity *= e,
                "fade_up" => { s.opacity *= e; s.y += 0.05 * k; }
                "slide_left" => { s.x += 0.6 * k; s.opacity *= p.min(1.0) * 0.6 + 0.4; }
                "slide_right" => { s.x -= 0.6 * k; s.opacity *= p.min(1.0) * 0.6 + 0.4; }
                "slide_up" => { s.y += 0.5 * k; s.opacity *= p.min(1.0) * 0.6 + 0.4; }
                "zoom_in" => { s.scale *= 0.3 + 0.7 * e; s.opacity *= e; }
                "pop_bounce" => { s.scale *= ease(Some("back"), p).max(0.0); s.opacity *= (p * 3.0).min(1.0); }
                "drop" => { s.y -= 0.35 * (1.0 - bounce_out(p)); s.opacity *= (p * 4.0).min(1.0); }
                "blur_in" => { s.blur += 30.0 * k; s.opacity *= e; }
                "typewriter" => s.reveal = p,
                "spin_in" => { s.rotation -= 180.0 * k; s.scale *= e.max(0.01); }
                other => if let Some(w) = Wipe::parse(other) { s.wipe = Some((w, e)); },
            }
        }
    }
    if let Some(a) = &anim.out {
        let remain = l.duration - lt;
        if a.duration > 0.0 && remain < a.duration {
            let p = 1.0 - (remain / a.duration).clamp(0.0, 1.0); // 0 → 1 khi biến mất
            let e = ease(Some("ease_in"), p);
            match a.preset.as_str() {
                "fade" => s.opacity *= 1.0 - e,
                "fade_down" => { s.opacity *= 1.0 - e; s.y += 0.05 * e; }
                "slide_left" => s.x -= 0.6 * e,
                "slide_right" => s.x += 0.6 * e,
                "zoom_out" => { s.scale *= 1.0 - 0.7 * e; s.opacity *= 1.0 - e; }
                "blur_out" => { s.blur += 30.0 * e; s.opacity *= 1.0 - e; }
                "spin_out" => { s.rotation += 180.0 * e; s.scale *= (1.0 - e).max(0.01); }
                other => if let Some(w) = Wipe::parse(other) { s.wipe = Some((w, 1.0 - e)); },
            }
        }
    }
    if let Some(a) = &anim.loop_ {
        let period = a.duration.max(0.05);
        let ph = (lt / period).fract() * 2.0 * PI;
        match a.preset.as_str() {
            "float" => s.y += 0.012 * ph.sin(),
            "pulse" => s.scale *= 1.0 + 0.05 * ph.sin(),
            "shake" => { s.x += 0.004 * (ph * 6.0).sin(); s.y += 0.003 * (ph * 7.0).cos(); }
            "swing" => s.rotation += 8.0 * ph.sin(),
            "rotate" => s.rotation += 360.0 * (lt / period).fract(),
            "flicker" => {
                let n = ((lt * 12.0).floor() * 12.9898).sin() * 43758.5453;
                s.opacity *= 0.55 + 0.45 * n.fract().abs();
            }
            _ => {}
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(cubic_bezier([0.175, 0.885, 0.32, 1.275], 0.6) > 1.0); // "pop" vượt đích
    }

    #[test]
    fn keyframes_interpolate() {
        let k = vec![Keyframe { t: 0.0, value: 0.0, ease: Some("linear".into()), bezier: None }, Keyframe { t: 2.0, value: 1.0, ease: Some("linear".into()), bezier: None }];
        assert!((keyframed(&k, 1.0, 9.0) - 0.5).abs() < 1e-9);
        assert_eq!(keyframed(&k, 5.0, 9.0), 1.0);
    }
}

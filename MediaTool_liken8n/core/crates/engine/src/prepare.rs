//! Chuẩn bị bản dựng trước khi render — chạy MỘT lần, dùng chung cho xem trước, xuất video và mọi tool:
//! 1. Chuẩn hóa dạng cũ → dạng mới (animation in/out/loop → `animations`, style.color/gradient → `fill`,
//!    style.stroke/shape.stroke → `layer.strokes`, style.shadow/glow → `layer.shadows`).
//! 2. Giải mọi mốc thời gian (`Timing`/`TimeRef`) thành giây tuyệt đối: lớp, animation (kể cả lặp), effect, đoạn chữ.

use crate::anim::{default_unit, kind_of};
use crate::model::*;

/// Ngữ cảnh để giải mốc: thời điểm của "chính nó" + toàn bản dựng.
struct Ctx<'a> {
    comp: &'a Composition,
    self_start: f64,
    self_end: f64,
}

impl Ctx<'_> {
    fn resolve(&self, r: &TimeRef) -> Option<f64> {
        let (name, offset, n) = match r {
            TimeRef::Abs(v) => return Some(*v),
            TimeRef::Ref { r, offset, n } => (r.as_str(), *offset, *n),
        };
        let base = match name {
            "self.start" | "start" | "parent.start" => Some(self.self_start),
            "self.end" | "end" | "parent.end" => Some(self.self_end),
            "comp.start" => Some(0.0),
            "comp.end" => Some(self.comp.end()),
            _ => {
                if let Some(rest) = name.strip_prefix("layer:") {
                    let (id, edge) = split_edge(rest);
                    self.comp.layers.iter().find(|l| l.id == id).map(|l| if edge == "end" { l.end() } else { l.start })
                } else if let Some(rest) = name.strip_prefix("marker:") {
                    let (id, edge) = split_edge(rest);
                    self.comp.markers.iter().find(|m| m.id == id || m.label.as_deref() == Some(id)).map(|m| {
                        if edge == "end" { m.end.unwrap_or(m.start) } else { m.start }
                    })
                } else {
                    // beat / downbeat / kind:<loại>, có thể viết "beat:16"
                    let rest = name.strip_prefix("kind:").unwrap_or(name);
                    let (kind, idx): (&str, Option<u32>) = match rest.rsplit_once(':') {
                        Some((k, i)) if i.parse::<u32>().is_ok() => (k, i.parse().ok()),
                        _ => (rest, None),
                    };
                    let nth = n.or(idx).unwrap_or(1).max(1) as usize;
                    let mut ts = markers_of(self.comp, kind);
                    ts.sort_by(f64::total_cmp);
                    ts.get(nth - 1).copied()
                }
            }
        };
        base.map(|b| b + offset)
    }

    /// Khoảng [đầu, cuối) của một Timing; thiếu phần nào thì lấy mặc định.
    fn window(&self, t: &Timing, def_start: f64, def_end: f64) -> (f64, f64) {
        let a = t.start.as_ref().and_then(|r| self.resolve(r)).unwrap_or(def_start);
        let b = match (t.duration, &t.end) {
            (Some(d), _) => a + d.max(0.0),
            (None, Some(r)) => self.resolve(r).unwrap_or(def_end),
            (None, None) => def_end,
        };
        (a, b.max(a))
    }

    /// Các khoảng của Timing có `repeat` (mỗi `every` giây hoặc tại mỗi mốc), mỗi lần dài `each`.
    fn windows(&self, t: &Timing, def_start: f64, def_end: f64, each: f64) -> Vec<(f64, f64)> {
        let (a, b) = self.window(t, def_start, def_end);
        let Some(rep) = &t.repeat else { return vec![(a, b)] };
        let count = rep.count.map(|c| c as usize).unwrap_or(usize::MAX);
        let starts: Vec<f64> = match &rep.every {
            TimeRef::Abs(step) if *step > 0.01 => {
                let mut v = Vec::new();
                let mut x = a;
                while x < b - 1e-6 && v.len() < 10_000 {
                    v.push(x);
                    x += step;
                }
                v
            }
            TimeRef::Ref { r, offset, .. } => {
                let kind = r.strip_prefix("kind:").unwrap_or(r);
                let mut v: Vec<f64> = markers_of(self.comp, kind).into_iter().map(|m| m + offset).filter(|m| *m >= a - 1e-6 && *m < b).collect();
                v.sort_by(f64::total_cmp);
                v
            }
            _ => vec![a],
        };
        let len = rep.duration.unwrap_or(each).max(0.01);
        starts.into_iter().take(count).map(|s| (s, s + len)).collect()
    }
}

fn split_edge(s: &str) -> (&str, &str) {
    match s.rsplit_once('.') {
        Some((id, e)) if e == "start" || e == "end" => (id, e),
        _ => (s, "start"),
    }
}

fn markers_of(comp: &Composition, kind: &str) -> Vec<f64> {
    comp.markers.iter().filter(|m| m.kind.as_deref() == Some(kind)).map(|m| m.start).collect()
}

impl Composition {
    /// Bản đã chuẩn hóa + đã giải mốc thời gian. Gọi nhiều lần cũng không sao (idempotent).
    pub fn prepare(&self) -> Composition {
        let mut c = self.clone();
        for l in &mut c.layers {
            normalize_layer(l);
        }
        // Mốc của lớp có thể neo vào lớp khác → giải vài lượt cho tới khi ổn định
        for _ in 0..4 {
            let snapshot = c.clone();
            let mut changed = false;
            for l in &mut c.layers {
                if let Some(t) = &l.timing {
                    let ctx = Ctx { comp: &snapshot, self_start: l.start, self_end: l.end() };
                    let (a, b) = ctx.window(t, l.start, l.end());
                    if (a - l.start).abs() > 1e-9 || (b - a - l.duration).abs() > 1e-9 {
                        l.start = a;
                        l.duration = (b - a).max(0.01);
                        changed = true;
                    }
                }
            }
            if !changed {
                break;
            }
        }
        let snapshot = c.clone();
        for l in &mut c.layers {
            let (ls, le) = (l.start, l.end());
            let ctx = Ctx { comp: &snapshot, self_start: ls, self_end: le };
            for a in &mut l.animations {
                let kind = a.kind.clone().unwrap_or_else(|| kind_of(&a.preset).to_string());
                let dur = a.duration.unwrap_or(match kind.as_str() {
                    "loop" => le - ls,
                    "emphasis" => 0.6,
                    _ => 0.5,
                });
                let (ds, de) = match kind.as_str() {
                    "out" => (le - dur, le),
                    "loop" => (ls, le),
                    _ => (ls, ls + dur),
                };
                a.windows = match &a.timing {
                    Some(t) => ctx.windows(t, ds, de, dur),
                    None => vec![(ds, de.max(ds))],
                };
                a.kind = Some(kind);
            }
            for e in &mut l.effects {
                e.window = e.timing.as_ref().map(|t| ctx.window(t, ls, le));
            }
            if let LayerKind::Text { spans, .. } = &mut l.kind {
                for s in spans {
                    s.window = s.timing.as_ref().map(|t| ctx.window(t, ls, le));
                }
            }
        }
        c.prepared = true;
        c
    }
}

/// Dạng cũ → dạng mới (chỉ chuyển khi phần mới còn trống, để không ghi đè dữ liệu mới).
fn normalize_layer(l: &mut Layer) {
    if let Some(old) = l.animation.take() {
        let mut add = |p: Option<AnimPreset>, kind: &str| {
            if let Some(p) = p.filter(|p| p.preset != "none" && !p.preset.is_empty()) {
                l.animations.push(Anim {
                    preset: p.preset,
                    kind: Some(kind.into()),
                    timing: None,
                    duration: Some(p.duration),
                    unit: None,
                    stagger: None,
                    order: None,
                    ease: None,
                    select: None,
                    intensity: 1.0,
                    period: if kind == "loop" { Some(p.duration) } else { None },
                    windows: vec![],
                });
            }
        };
        add(old.in_, "in");
        add(old.out, "out");
        add(old.loop_, "loop");
    }
    let is_text = matches!(l.kind, LayerKind::Text { .. });
    match &mut l.kind {
        LayerKind::Text { style, .. } => {
            let k = style.size / 96.0;
            if style.fill.is_none() {
                style.fill = Some(match style.gradient.take().filter(|g| g.colors.len() >= 2) {
                    Some(g) => Fill::Spec(FillSpec::Linear { stops: g.colors.into_iter().map(Stop::Color).collect(), angle: g.angle }),
                    None => Fill::Color(style.color.clone().unwrap_or_else(|| "#FFFFFF".into())),
                });
            }
            style.color = None;
            style.gradient = None;
            if let Some(s) = style.stroke.take() {
                if l.strokes.is_empty() && s.width > 0.0 {
                    l.strokes.push(s);
                }
            }
            if l.shadows.is_empty() {
                if let Some(g) = style.glow.take() {
                    l.shadows.push(Shadow { color: g.color, x: 0.0, y: 0.0, blur: g.radius * k * 2.0, spread: 0.0, kind: Some("glow".into()), length: 0.0, opacity: 100.0 });
                }
                if let Some(mut s) = style.shadow.take() {
                    s.x *= k;
                    s.y *= k;
                    s.blur *= k;
                    l.shadows.push(s);
                }
            }
            style.glow = None;
            style.shadow = None;
            if std::mem::take(&mut style.uppercase) && style.case.is_none() {
                style.case = Some("upper".into());
            }
        }
        LayerKind::Shape { stroke, .. } => {
            if let Some(s) = stroke.take() {
                if l.strokes.is_empty() && s.width > 0.0 {
                    l.strokes.push(s);
                }
            }
        }
        _ => {}
    }
    // chọn theo chữ trên lớp chữ mà để unit = layer → hiểu là theo từ
    for a in &mut l.animations {
        if a.unit.is_none() {
            a.unit = default_unit(&a.preset).map(String::from);
        }
        if is_text && a.select.as_ref().is_some_and(|s| s.matches.is_some()) && matches!(a.unit.as_deref(), None | Some("layer")) {
            a.unit = Some("word".into());
        }
        if !is_text && !matches!(a.unit.as_deref(), None | Some("layer")) {
            a.unit = None; // ảnh/video/hình không chia đơn vị
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn comp(json: &str) -> Composition {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn legacy_is_converted() {
        let c = comp(r##"{"canvas":{"width":1920,"height":1080},"layers":[
            {"id":"t","type":"text","text":"Hi","start":1,"duration":4,
             "style":{"color":"#ff0000","stroke":{"color":"#000","width":3},"shadow":{"color":"#000","x":2,"y":2,"blur":4},"uppercase":true},
             "animation":{"in":{"preset":"fade","duration":0.5},"out":{"preset":"fade","duration":0.4},"loop":{"preset":"pulse","duration":1}}}]}"##)
        .prepare();
        let l = &c.layers[0];
        assert_eq!(l.animations.len(), 3);
        assert_eq!(l.animations[0].windows, vec![(1.0, 1.5)]);
        assert_eq!(l.animations[1].windows, vec![(4.6, 5.0)]);
        assert_eq!(l.animations[2].windows, vec![(1.0, 5.0)]);
        assert_eq!(l.strokes.len(), 1);
        assert_eq!(l.shadows.len(), 1);
        let LayerKind::Text { style, .. } = &l.kind else { panic!() };
        assert!(matches!(style.fill, Some(Fill::Color(ref c)) if c == "#ff0000"));
        assert_eq!(style.case.as_deref(), Some("upper"));
        // idempotent
        let again = c.prepare();
        assert_eq!(again.layers[0].animations.len(), 3);
        assert_eq!(again.layers[0].strokes.len(), 1);
    }

    #[test]
    fn anchors_resolve() {
        let c = comp(r##"{"canvas":{"width":1920,"height":1080},
          "markers":[{"id":"chorus","start":10,"end":20,"kind":"section"},
                     {"start":10,"kind":"beat"},{"start":10.5,"kind":"beat"},{"start":11,"kind":"beat"},{"start":25,"kind":"beat"}],
          "layers":[
            {"id":"logo","type":"shape","start":0,"duration":3},
            {"id":"title","type":"shape","timing":{"start":{"ref":"layer:logo.end","offset":1},"end":{"ref":"marker:chorus.end"}},
             "animations":[
               {"preset":"punch","timing":{"start":{"ref":"marker:chorus"},"end":{"ref":"marker:chorus.end"},"repeat":{"every":{"ref":"beat"}}},"duration":0.2},
               {"preset":"fade","kind":"in","timing":{"start":{"ref":"beat","n":2},"duration":0.3}}
             ],
             "effects":[{"type":"grayscale","amount":100,"timing":{"start":12,"duration":2}}]}
          ]}"##)
        .prepare();
        let t = &c.layers[1];
        assert_eq!((t.start, t.end()), (4.0, 20.0));
        assert_eq!(t.animations[0].windows, vec![(10.0, 10.2), (10.5, 10.7), (11.0, 11.2)]);
        assert_eq!(t.animations[1].windows, vec![(10.5, 10.8)]);
        assert_eq!(t.effects[0].window, Some((12.0, 14.0)));
    }
}

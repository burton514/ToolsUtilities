//! Thư viện gói hiệu ứng — hiệu ứng là DỮ LIỆU, không phải code Rust.
//!
//! Mỗi gói là một thư mục `library/effects/<id>/` gồm:
//! - `effect.toml`: tên, nhóm, mô tả, tham số (nhãn tiếng Việt, khoảng, mặc định);
//! - `effect.sksl`: shader SkSL (Skia RuntimeEffect) nhận nội dung lớp (`image`) và trả màu mới.
//!
//! Thêm hiệu ứng / bộ màu / chuyển cảnh = thêm một thư mục. Engine biên dịch shader một lần rồi giữ trong bộ nhớ;
//! cùng một gói dùng được cho mọi lớp, cho lớp điều chỉnh (áp lên mọi thứ bên dưới) và làm chuyển cảnh.
//!
//! Quy ước uniform (shader khai báo cái nào cần thì engine điền cái đó):
//! `uniform shader image;` nội dung · `uniform float4 u_rect;` khung nội dung (x, y, w, h) theo tọa độ vẽ ·
//! `uniform float u_px;` số đơn vị vẽ ứng với 1 px khung 1080 · `uniform float u_time;` giây từ đầu lớp ·
//! `uniform float u_progress;` 0..1 trong khoảng áp dụng · `uniform float u_amount;` độ mạnh 0..1 ·
//! mỗi tham số `float` → `uniform float <key>`, tham số `color` → `uniform float4 <key>` (RGBA 0..1).

use serde::{Deserialize, Serialize};
use skia_safe::runtime_effect::RuntimeShaderBuilder;
use skia_safe::{image_filters, ImageFilter, RuntimeEffect};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParamSpec {
    pub key: String,
    pub label: String,
    /// float | color
    #[serde(default = "float_s", rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub min: f64,
    #[serde(default = "one")]
    pub max: f64,
    #[serde(default)]
    pub step: Option<f64>,
    /// số, hoặc màu "#RRGGBB[AA]"
    #[serde(default)]
    pub default: serde_json::Value,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EffectMeta {
    pub id: String,
    pub name: String,
    /// look | film | light | stylize | distort | blur | key | glitch | transition | …
    #[serde(default)]
    pub category: String,
    /// effect | transition
    #[serde(default = "effect_s")]
    pub kind: String,
    #[serde(default)]
    pub description: String,
    /// khoảng cách lấy mẫu lân cận tối đa (px khung 1080) — hiệu ứng làm méo/mờ cần khai báo
    #[serde(default)]
    pub sample_radius: f64,
    /// thứ tự hiển thị trong nhóm
    #[serde(default)]
    pub order: i32,
}

#[derive(Debug, Deserialize)]
struct Manifest {
    effect: EffectMeta,
    #[serde(default, rename = "param")]
    params: Vec<ParamSpec>,
}

/// Mô tả một gói (trả cho editor/AI để tự sinh giao diện tham số).
#[derive(Debug, Clone, Serialize)]
pub struct EffectInfo {
    #[serde(flatten)]
    pub meta: EffectMeta,
    pub params: Vec<ParamSpec>,
}

pub struct Package {
    pub info: EffectInfo,
    effect: RuntimeEffect,
}

// RuntimeEffect của Skia là đối tượng bất biến, đếm tham chiếu, an toàn khi chia sẻ giữa luồng.
unsafe impl Send for Package {}
unsafe impl Sync for Package {}

#[derive(Default)]
pub struct Library {
    /// mã băm nội dung mọi gói — đổi gói nào thì khóa cache xuất video đổi theo
    pub fingerprint: u64,
    pub effects: BTreeMap<String, Package>,
    /// gói lỗi (không đọc được / shader không biên dịch được) — báo cho người viết gói
    pub problems: Vec<String>,
}

fn float_s() -> String {
    "float".into()
}
fn effect_s() -> String {
    "effect".into()
}
fn one() -> f64 {
    1.0
}

impl Library {
    pub fn load(dir: &Path) -> Library {
        let mut lib = Library::default();
        let Ok(rd) = std::fs::read_dir(dir.join("effects")) else { return lib };
        let mut dirs: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.is_dir()).collect();
        dirs.sort();
        for d in dirs {
            for f in ["effect.toml", "effect.sksl"] {
                if let Ok(b) = std::fs::read(d.join(f)) {
                    for x in b {
                        lib.fingerprint = (lib.fingerprint ^ x as u64).wrapping_mul(0x100000001b3);
                    }
                }
            }
            match load_package(&d) {
                Ok(p) => {
                    lib.effects.insert(p.info.meta.id.clone(), p);
                }
                Err(e) => lib.problems.push(format!("{}: {e}", d.display())),
            }
        }
        lib
    }

    pub fn list(&self) -> Vec<&EffectInfo> {
        let mut v: Vec<&EffectInfo> = self.effects.values().map(|p| &p.info).collect();
        v.sort_by(|a, b| (a.meta.category.as_str(), a.meta.order, a.meta.name.as_str()).cmp(&(b.meta.category.as_str(), b.meta.order, b.meta.name.as_str())));
        v
    }
}

fn load_package(dir: &Path) -> Result<Package, String> {
    let text = std::fs::read_to_string(dir.join("effect.toml")).map_err(|e| format!("thiếu effect.toml ({e})"))?;
    let m: Manifest = toml::from_str(&text).map_err(|e| format!("effect.toml sai: {e}"))?;
    let sksl = std::fs::read_to_string(dir.join("effect.sksl")).map_err(|e| format!("thiếu effect.sksl ({e})"))?;
    let effect = RuntimeEffect::make_for_shader(&sksl, None).map_err(|e| format!("shader lỗi: {e}"))?;
    if effect.find_child("image").is_none() {
        return Err("shader phải khai báo `uniform shader image;`".into());
    }
    Ok(Package { info: EffectInfo { meta: m.effect, params: m.params }, effect })
}

/// Giá trị đầu vào chung của mọi gói khi áp lên một lớp.
pub struct Inputs<'a> {
    pub rect: [f32; 4],
    pub px: f32,
    pub time: f32,
    pub progress: f32,
    pub amount: f32,
    pub params: &'a serde_json::Map<String, serde_json::Value>,
}

impl Package {
    /// Image filter của gói, nối sau `input` (None = nội dung gốc).
    pub fn filter(&self, i: &Inputs, input: Option<ImageFilter>) -> Option<ImageFilter> {
        let mut b = RuntimeShaderBuilder::new(self.effect.clone());
        let mut set = |name: &str, v: &[f32]| {
            if self.effect.find_uniform(name).is_some() {
                let _ = b.set_uniform_float(name, v);
            }
        };
        set("u_rect", &i.rect);
        set("u_px", &[i.px]);
        set("u_time", &[i.time]);
        set("u_progress", &[i.progress]);
        set("u_amount", &[i.amount]);
        for p in &self.info.params {
            let v = i.params.get(&p.key).unwrap_or(&p.default);
            if p.kind == "color" {
                let (r, g, bb, a) = crate::model::parse_color(v.as_str().unwrap_or("#FFFFFF"));
                set(&p.key, &[r as f32 / 255.0, g as f32 / 255.0, bb as f32 / 255.0, a as f32 / 255.0]);
            } else {
                set(&p.key, &[v.as_f64().unwrap_or(0.0) as f32]);
            }
        }
        let radius = (self.info.meta.sample_radius as f32 * i.px).max(0.0);
        image_filters::runtime_shader_with_options(&b, radius, "image", input, false)
    }
}

// ------------------------------------------------------------------ thư viện dùng chung toàn tiến trình

static LIB: RwLock<Option<Arc<Library>>> = RwLock::new(None);

/// Thư mục thư viện: biến môi trường `MEDIATOOL_LIBRARY`, mặc định `library/` cạnh thư mục chạy.
pub fn dir() -> PathBuf {
    std::env::var_os("MEDIATOOL_LIBRARY").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("library"))
}

/// Thư viện hiện tại (nạp lần đầu khi cần).
pub fn get() -> Arc<Library> {
    if let Some(l) = LIB.read().ok().and_then(|g| g.clone()) {
        return l;
    }
    reload()
}

/// Đọc lại thư viện từ đĩa (sau khi thêm/sửa gói).
pub fn reload() -> Arc<Library> {
    let lib = Arc::new(Library::load(&dir()));
    if let Ok(mut g) = LIB.write() {
        *g = Some(lib.clone());
    }
    lib
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_packages_compile() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../library");
        let lib = Library::load(&root);
        assert!(lib.problems.is_empty(), "gói lỗi: {:#?}", lib.problems);
        assert!(lib.effects.len() >= 20, "chỉ có {} gói", lib.effects.len());
    }
}

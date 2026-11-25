//! Registry: tự phát hiện tool và mini app. Core không bao giờ biết tên một tool cụ thể;
//! mọi thông tin đến từ manifest và lệnh `describe` của worker.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

// ------------------------------------------------------------------ manifest

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Manifest {
    pub tool: ToolSection,
    #[serde(default)]
    pub runtime: RuntimeSection,
    #[serde(default)]
    pub dependencies: Dependencies,
    #[serde(default)]
    pub models: Vec<ModelSpec>,
    #[serde(default)]
    pub mcp: McpSection,
    #[serde(default)]
    pub examples: Vec<Example>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ToolSection {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub sdk: String,
    pub entry: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub owners: Vec<String>,
    #[serde(default)]
    pub license: String,
    #[serde(default = "default_status")]
    pub status: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RuntimeSection {
    #[serde(default = "default_profile")]
    pub profile: String,
    #[serde(default)]
    pub isolated: bool,
    #[serde(default = "default_ram")]
    pub ram_mb: u64,
    #[serde(default = "default_gpu")]
    pub gpu: String,
    #[serde(default)]
    pub heavy: bool,
    #[serde(default)]
    pub warm: bool,
    #[serde(default = "default_timeout")]
    pub timeout_s: u64,
}

impl Default for RuntimeSection {
    fn default() -> Self {
        Self {
            profile: default_profile(),
            isolated: false,
            ram_mb: default_ram(),
            gpu: default_gpu(),
            heavy: false,
            warm: false,
            timeout_s: default_timeout(),
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Dependencies {
    #[serde(default)]
    pub binaries: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModelSpec {
    pub id: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub sha256: String,
    #[serde(default)]
    pub size_mb: f64,
    #[serde(default)]
    pub license: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct McpSection {
    #[serde(default = "default_true")]
    pub expose: bool,
    #[serde(default)]
    pub hint: String,
}

impl Default for McpSection {
    fn default() -> Self {
        Self { expose: true, hint: String::new() }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Example {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub inputs: BTreeMap<String, Value>,
    #[serde(default)]
    pub params: serde_json::Map<String, Value>,
}

fn default_status() -> String {
    "experimental".into()
}
fn default_profile() -> String {
    "base".into()
}
fn default_ram() -> u64 {
    300
}
fn default_gpu() -> String {
    "none".into()
}
fn default_timeout() -> u64 {
    1800
}
fn default_true() -> bool {
    true
}

// ------------------------------------------------------------------ describe

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FieldSpec {
    pub name: String,
    pub format: Option<String>,
    pub required: bool,
    #[serde(default)]
    pub multiple: bool,
    #[serde(default)]
    pub description: String,
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub value_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Describe {
    pub inputs: Vec<FieldSpec>,
    pub outputs: Vec<FieldSpec>,
    pub params_schema: Value,
    #[serde(default)]
    pub check_error: Option<String>,
}

// ------------------------------------------------------------------ entries

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Status {
    Available,
    Unavailable { reason: String },
}

impl Status {
    pub fn is_available(&self) -> bool {
        matches!(self, Status::Available)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolEntry {
    pub id: String,
    pub category: String,
    #[serde(skip)]
    pub dir: PathBuf,
    pub manifest: Option<Manifest>,
    pub describe: Option<Describe>,
    pub status: Status,
    pub has_docs: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct MiniAppEntry {
    pub name: String,
    #[serde(skip)]
    pub dir: PathBuf,
    pub manifest: Value,
    pub status: Status,
}

#[derive(Debug, Clone)]
pub struct RegistryConfig {
    pub tools_root: PathBuf,
    pub miniapps_root: PathBuf,
    pub python: String,
    /// Tool bị admin tắt (config/tools.toml: disabled = [...])
    pub disabled: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Registry {
    pub tools: BTreeMap<String, ToolEntry>,
    pub miniapps: BTreeMap<String, MiniAppEntry>,
}

impl Registry {
    pub fn scan(cfg: &RegistryConfig) -> Registry {
        let mut found: Vec<(String, String, PathBuf)> = Vec::new();
        for cat in visible_dirs(&cfg.tools_root) {
            let cat_name = file_name(&cat);
            for tool_dir in visible_dirs(&cat) {
                if tool_dir.join("manifest.toml").is_file() {
                    found.push((cat_name.clone(), file_name(&tool_dir), tool_dir));
                }
            }
        }

        // describe chạy song song (mỗi tool một process python)
        let entries: Vec<ToolEntry> = std::thread::scope(|s| {
            let handles: Vec<_> = found
                .iter()
                .map(|(cat, name, dir)| s.spawn(move || load_tool(cfg, cat, name, dir)))
                .collect();
            handles.into_iter().filter_map(|h| h.join().ok()).collect()
        });

        let mut tools = BTreeMap::new();
        for e in entries {
            match &e.status {
                Status::Available => tracing::info!(tool = %e.id, "tool sẵn sàng"),
                Status::Unavailable { reason } => tracing::warn!(tool = %e.id, %reason, "tool không dùng được"),
            }
            tools.insert(e.id.clone(), e);
        }

        let mut miniapps = BTreeMap::new();
        for dir in visible_dirs(&cfg.miniapps_root) {
            let mf = dir.join("manifest.json");
            if !mf.is_file() {
                continue;
            }
            let name = file_name(&dir);
            let (manifest, status) = match std::fs::read_to_string(&mf)
                .map_err(|e| e.to_string())
                .and_then(|t| serde_json::from_str::<Value>(&t).map_err(|e| e.to_string()))
            {
                Ok(v) => {
                    let missing: Vec<String> = v["tools"]
                        .as_array()
                        .map(|a| {
                            a.iter()
                                .filter_map(|t| t.as_str())
                                .filter(|t| !tools.get(*t).map(|e: &ToolEntry| e.status.is_available()).unwrap_or(false))
                                .map(String::from)
                                .collect()
                        })
                        .unwrap_or_default();
                    let st = if missing.is_empty() {
                        Status::Available
                    } else {
                        Status::Unavailable { reason: format!("Thiếu tool: {}", missing.join(", ")) }
                    };
                    (v, st)
                }
                Err(e) => (Value::Null, Status::Unavailable { reason: format!("manifest.json lỗi: {e}") }),
            };
            miniapps.insert(name.clone(), MiniAppEntry { name, dir, manifest, status });
        }

        Registry { tools, miniapps }
    }

    pub fn tool(&self, id: &str) -> Option<&ToolEntry> {
        self.tools.get(id)
    }
}

fn load_tool(cfg: &RegistryConfig, cat: &str, name: &str, dir: &Path) -> ToolEntry {
    let expected = format!("{cat}_{name}");
    let has_docs = dir.join("README.md").is_file();
    let mut entry = ToolEntry {
        id: expected.clone(),
        category: cat.to_string(),
        dir: dir.to_path_buf(),
        manifest: None,
        describe: None,
        status: Status::Available,
        has_docs,
    };
    let unavailable = |mut e: ToolEntry, reason: String| {
        e.status = Status::Unavailable { reason };
        e
    };

    let text = match std::fs::read_to_string(dir.join("manifest.toml")) {
        Ok(t) => t,
        Err(e) => return unavailable(entry, format!("Không đọc được manifest.toml: {e}")),
    };
    let manifest: Manifest = match toml::from_str(&text) {
        Ok(m) => m,
        Err(e) => return unavailable(entry, format!("manifest.toml sai: {e}")),
    };
    if manifest.tool.id != expected {
        let id = manifest.tool.id.clone();
        entry.manifest = Some(manifest);
        return unavailable(entry, format!("id '{id}' không khớp đường dẫn (cần '{expected}')"));
    }
    entry.manifest = Some(manifest);
    if cfg.disabled.iter().any(|d| d == &expected) {
        return unavailable(entry, "Bị tắt trong config/tools.toml".into());
    }

    let out = Command::new(&cfg.python)
        .args(["-m", "mediatool_worker", "describe", "--tool-dir"])
        .arg(dir)
        .env("PYTHONIOENCODING", "utf-8")
        .output();
    match out {
        Err(e) => unavailable(entry, format!("Không chạy được worker ({}): {e}", cfg.python)),
        Ok(o) if !o.status.success() => {
            let err = String::from_utf8_lossy(&o.stderr);
            let tail: Vec<&str> = err.lines().rev().take(3).collect();
            unavailable(entry, format!("Nạp tool lỗi: {}", tail.into_iter().rev().collect::<Vec<_>>().join(" | ")))
        }
        Ok(o) => match serde_json::from_slice::<Describe>(&o.stdout) {
            Err(e) => unavailable(entry, format!("describe trả dữ liệu sai: {e}")),
            Ok(d) => {
                let check = d.check_error.clone();
                entry.describe = Some(d);
                match check {
                    Some(reason) => unavailable(entry, reason),
                    None => entry,
                }
            }
        },
    }
}

fn visible_dirs(root: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(root)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .filter(|p| {
                    let n = file_name(p);
                    !n.starts_with('_') && !n.starts_with('.')
                })
                .collect()
        })
        .unwrap_or_default();
    dirs.sort();
    dirs
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Input khai báo `expected` có nhận asset `actual` không (giống mediatool_sdk.assets.accepts).
pub fn format_accepts(expected: &str, actual: &str) -> bool {
    if expected == "file" || expected == actual {
        return true;
    }
    match expected {
        "media" => matches!(actual, "video" | "audio"),
        "json" => matches!(
            actual,
            "transcript" | "timed_lyrics" | "beat_grid" | "scene_list" | "time_ranges" | "composition" | "text_style"
        ),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compat() {
        assert!(format_accepts("media", "video"));
        assert!(format_accepts("file", "audio"));
        assert!(!format_accepts("video", "audio"));
    }

    #[test]
    fn manifest_parses() {
        let m: Manifest = toml::from_str(
            r#"
            [tool]
            id = "media_probe"
            name = "x"
            version = "0.1.0"
            entry = "tool:X"
            [[examples]]
            title = "a"
            inputs = { file = "samples/a.mp4" }
            params = { n = 1 }
            "#,
        )
        .unwrap();
        assert_eq!(m.runtime.ram_mb, 300);
        assert_eq!(m.examples[0].params["n"], 1);
    }
}

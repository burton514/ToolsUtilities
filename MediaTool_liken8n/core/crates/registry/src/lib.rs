//! Registry: tự phát hiện tool và mini app. Core không bao giờ biết tên một tool cụ thể;
//! mọi thông tin đến từ manifest và lệnh `describe` của worker.
//!
//! **Chuỗi là tool:** manifest có `entry = "chain:chain.json"` là một chuỗi đã lưu. Registry đọc file chuỗi để biết
//! input/tham số/output (không cần Python), nên chuỗi xuất hiện ở mọi nơi như tool thường (danh mục, Tool Runner,
//! màn chuỗi, MCP) và lồng được vào chuỗi khác. Core chạy từng bước thành job con (xem `mediatool-jobs`).

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
    /// Lấy thêm [[models]] từ danh mục dùng chung `tools/_models/<tên>.toml` (nhiều tool cùng một bộ model)
    #[serde(default)]
    pub models_from: Vec<String>,
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
    /// Nguồn của tool (repo model / thư viện / engine) — hiện cạnh tên tool ở mọi nơi. Chuỗi không khai: core gom từ các bước.
    #[serde(default)]
    pub sources: Vec<SourceRef>,
}

/// Một nguồn: tên ngắn dạng repo (vd. "pcunwa/BS-Roformer-Leap") + link.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct SourceRef {
    pub name: String,
    #[serde(default)]
    pub url: String,
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
    /// model một file: url + sha256 (+ tên file `file`, mặc định lấy từ url)
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub sha256: String,
    #[serde(default)]
    pub file: String,
    /// model nhiều file (ví dụ CTranslate2): mỗi file một url + sha256; tool nhận đường dẫn THƯ MỤC
    #[serde(default)]
    pub files: Vec<ModelFile>,
    #[serde(default)]
    pub size_mb: f64,
    #[serde(default)]
    pub license: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModelFile {
    pub path: String,
    pub url: String,
    pub sha256: String,
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

// ------------------------------------------------------------------ chuỗi

/// Input/output khai báo của chuỗi.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChainIo {
    pub name: String,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_true")]
    pub required: bool,
    #[serde(default)]
    pub multiple: bool,
}

/// Một bước: chạy tool `tool`. Giá trị input là tham chiếu `"$input.<tên>"` hoặc `"$<bước>.<output>"`
/// (hoặc mảng tham chiếu); giá trị params là hằng số hoặc `"$param.<tên>"` (thay bằng tham số của chuỗi).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChainStep {
    pub id: String,
    pub tool: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub inputs: BTreeMap<String, Value>,
    #[serde(default)]
    pub params: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChainOutput {
    /// tham chiếu `"$<bước>.<output>"`
    pub from: String,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChainDef {
    #[serde(default)]
    pub inputs: Vec<ChainIo>,
    /// JSON Schema tham số của chuỗi (giống tool); bỏ trống = không có tham số
    #[serde(default)]
    pub params: Option<Value>,
    pub steps: Vec<ChainStep>,
    #[serde(default)]
    pub outputs: BTreeMap<String, ChainOutput>,
}

impl ChainDef {
    /// Describe giống tool để mọi nơi (API, UI, MCP, validate job) dùng chung.
    pub fn describe(&self) -> Describe {
        let io = |n: &str, f: &Option<String>, d: &str, req: bool, mul: bool| FieldSpec {
            name: n.to_string(), format: f.clone(), required: req, multiple: mul, description: d.to_string(), value_type: None,
        };
        Describe {
            inputs: self.inputs.iter().map(|i| io(&i.name, &i.format, &i.description, i.required, i.multiple)).collect(),
            outputs: self.outputs.iter().map(|(k, o)| io(k, &o.format, &o.description, true, false)).collect(),
            params_schema: self.params.clone().unwrap_or_else(|| serde_json::json!({"type": "object", "properties": {}})),
            check_error: None,
        }
    }
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
    /// "tool" | "chain"
    pub kind: String,
    #[serde(skip)]
    pub chain: Option<ChainDef>,
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
    /// Thư mục chuỗi người dùng lưu (`<data>/chains/<nhóm>/<tên>/`) — quét như tools_root
    pub chains_root: Option<PathBuf>,
}

#[derive(Debug, Clone, Default)]
pub struct Registry {
    pub tools: BTreeMap<String, ToolEntry>,
    pub miniapps: BTreeMap<String, MiniAppEntry>,
}

impl Registry {
    pub fn scan(cfg: &RegistryConfig) -> Registry {
        let mut found: Vec<(String, String, PathBuf)> = Vec::new();
        for root in std::iter::once(&cfg.tools_root).chain(cfg.chains_root.iter()) {
            for cat in visible_dirs(root) {
                let cat_name = file_name(&cat);
                for tool_dir in visible_dirs(&cat) {
                    if tool_dir.join("manifest.toml").is_file() {
                        found.push((cat_name.clone(), file_name(&tool_dir), tool_dir));
                    }
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
        check_chains(&mut tools);

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

    /// Nguồn của tool; chuỗi không tự khai thì gom (không trùng, theo thứ tự bước) từ các tool trong các bước, kể cả chuỗi lồng nhau.
    pub fn sources_of(&self, id: &str) -> Vec<SourceRef> {
        fn walk(reg: &Registry, id: &str, depth: usize, out: &mut Vec<SourceRef>) {
            let Some(e) = reg.tools.get(id) else { return };
            let own = e.manifest.as_ref().map(|m| m.tool.sources.as_slice()).unwrap_or(&[]);
            if !own.is_empty() || e.chain.is_none() {
                for s in own {
                    if !out.iter().any(|o| o.name == s.name) {
                        out.push(s.clone());
                    }
                }
                return;
            }
            if depth > 8 {
                return;
            }
            for st in &e.chain.as_ref().unwrap().steps {
                walk(reg, &st.tool, depth + 1, out);
            }
        }
        let mut out = Vec::new();
        walk(self, id, 0, &mut out);
        out
    }

    /// Nạp (lại) đúng một thư mục tool / chuỗi `<root>/<nhóm>/<tên>` rồi kiểm lại các chuỗi — dùng khi người dùng lưu chuỗi,
    /// không phải quét lại cả kho (mỗi tool Python tốn một process). Trả id.
    pub fn load_one(&mut self, cfg: &RegistryConfig, dir: &Path) -> String {
        let cat = dir.parent().map(file_name).unwrap_or_default();
        let entry = load_tool(cfg, &cat, &file_name(dir), dir);
        let id = entry.id.clone();
        self.tools.insert(id.clone(), entry);
        check_chains(&mut self.tools);
        id
    }

    /// Gỡ một tool / chuỗi khỏi danh sách rồi kiểm lại các chuỗi (chuỗi khác dùng nó sẽ thành "không dùng được").
    pub fn remove(&mut self, id: &str) -> bool {
        let had = self.tools.remove(id).is_some();
        check_chains(&mut self.tools);
        had
    }

    /// Tool này có phải chuỗi của người dùng (nằm trong `chains_root`, được sửa / xóa) không.
    pub fn is_user_chain(&self, cfg: &RegistryConfig, id: &str) -> bool {
        match (self.tools.get(id), &cfg.chains_root) {
            (Some(e), Some(root)) => e.kind == "chain" && e.dir.starts_with(root),
            _ => false,
        }
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
        kind: "tool".into(),
        chain: None,
    };
    let unavailable = |mut e: ToolEntry, reason: String| {
        e.status = Status::Unavailable { reason };
        e
    };

    let text = match std::fs::read_to_string(dir.join("manifest.toml")) {
        Ok(t) => t,
        Err(e) => return unavailable(entry, format!("Không đọc được manifest.toml: {e}")),
    };
    let mut manifest: Manifest = match toml::from_str(&text) {
        Ok(m) => m,
        Err(e) => return unavailable(entry, format!("manifest.toml sai: {e}")),
    };
    // dir = <tools>/<cat>/<name> → danh mục model dùng chung ở <tools>/_models
    if let Err(e) = merge_shared_models(&mut manifest, &dir.join("../../_models")) {
        return unavailable(entry, e);
    }
    if manifest.tool.id != expected {
        let id = manifest.tool.id.clone();
        entry.manifest = Some(manifest);
        return unavailable(entry, format!("id '{id}' không khớp đường dẫn (cần '{expected}')"));
    }
    entry.manifest = Some(manifest);
    if cfg.disabled.iter().any(|d| d == &expected) {
        return unavailable(entry, "Bị tắt trong config/tools.toml".into());
    }

    // chuỗi: đọc file chuỗi, không cần worker Python
    if let Some(file) = manifest_entry_chain(&entry) {
        entry.kind = "chain".into();
        return match std::fs::read_to_string(dir.join(&file))
            .map_err(|e| e.to_string())
            .and_then(|t| serde_json::from_str::<ChainDef>(&t).map_err(|e| e.to_string()))
        {
            Ok(c) if c.steps.is_empty() => unavailable(entry, "Chuỗi không có bước nào".into()),
            Ok(c) => {
                entry.describe = Some(c.describe());
                entry.chain = Some(c);
                entry
            }
            Err(e) => unavailable(entry, format!("{file} sai: {e}")),
        };
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

fn manifest_entry_chain(e: &ToolEntry) -> Option<String> {
    e.manifest.as_ref().and_then(|m| m.tool.entry.strip_prefix("chain:").map(|s| s.trim().to_string()))
}

/// Chuỗi chỉ dùng được khi mọi tool trong các bước có mặt và dùng được (kể cả chuỗi lồng nhau, không vòng lặp).
fn check_chains(tools: &mut BTreeMap<String, ToolEntry>) {
    fn ok(tools: &BTreeMap<String, ToolEntry>, id: &str, seen: &mut Vec<String>) -> Result<(), String> {
        if seen.iter().any(|s| s == id) {
            return Err(format!("chuỗi lồng vòng lặp: {} → {id}", seen.join(" → ")));
        }
        let Some(e) = tools.get(id) else { return Err(format!("thiếu tool '{id}'")) };
        if let Status::Unavailable { reason } = &e.status {
            return Err(format!("tool '{id}' không dùng được: {reason}"));
        }
        if let Some(c) = &e.chain {
            seen.push(id.to_string());
            for s in &c.steps {
                ok(tools, &s.tool, seen)?;
            }
            seen.pop();
        }
        Ok(())
    }
    let ids: Vec<String> = tools.iter().filter(|(_, e)| e.chain.is_some() && e.status.is_available()).map(|(k, _)| k.clone()).collect();
    for id in ids {
        let res = ok(tools, &id, &mut Vec::new()).and_then(|_| resolve_chain_params(tools, &id));
        if let Err(reason) = res {
            if let Some(e) = tools.get_mut(&id) {
                tracing::warn!(chain = %id, %reason, "chuỗi không dùng được");
                e.status = Status::Unavailable { reason };
            }
        }
    }
}

/// Tham số chuỗi khai báo `{"$from": "<tool_id>.<tham số>"}` lấy nguyên schema tham số đó của tool (enum, nhãn, giới hạn),
/// các khóa khác cạnh `$from` (default, description…) ghi đè — chuỗi không phải chép lại danh sách giọng, hiệu ứng…
/// Ghi vào cả `chain.params` (để điền mặc định khi chạy) lẫn `describe` (để UI / kiểm tham số).
fn resolve_chain_params(tools: &mut BTreeMap<String, ToolEntry>, id: &str) -> Result<(), String> {
    let Some(params) = tools.get(id).and_then(|e| e.chain.as_ref()).and_then(|c| c.params.clone()) else { return Ok(()) };
    let Some(props) = params.get("properties").and_then(Value::as_object) else { return Ok(()) };
    if !props.values().any(|p| p.get("$from").is_some()) {
        return Ok(());
    }
    let mut out = serde_json::Map::new();
    for (name, p) in props {
        let Some(from) = p.get("$from").and_then(Value::as_str) else {
            out.insert(name.clone(), p.clone());
            continue;
        };
        let (tid, param) = from.rsplit_once('.').ok_or_else(|| format!("$from sai: '{from}' (cần <tool>.<tham số>)"))?;
        let src = tools
            .get(tid)
            .and_then(|e| e.describe.as_ref())
            .and_then(|d| d.params_schema.get("properties"))
            .and_then(|ps| ps.get(param))
            .cloned()
            .ok_or_else(|| format!("$from: tool '{tid}' không có tham số '{param}'"))?;
        let mut merged = src.as_object().cloned().unwrap_or_default();
        for (k, v) in p.as_object().into_iter().flatten() {
            if k != "$from" {
                merged.insert(k.clone(), v.clone());
            }
        }
        out.insert(name.clone(), Value::Object(merged));
    }
    let mut resolved = params.clone();
    resolved["properties"] = Value::Object(out);
    let e = tools.get_mut(id).expect("chuỗi có mặt");
    if let Some(c) = e.chain.as_mut() {
        c.params = Some(resolved.clone());
    }
    if let Some(d) = e.describe.as_mut() {
        d.params_schema = resolved;
    }
    Ok(())
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
/// Gộp `[[models]]` của các danh mục `models_from` vào manifest (id trùng thì khai báo của tool thắng).
fn merge_shared_models(m: &mut Manifest, shared_dir: &Path) -> Result<(), String> {
    #[derive(Deserialize)]
    struct Catalog {
        #[serde(default)]
        models: Vec<ModelSpec>,
    }
    for name in m.models_from.clone() {
        if name.is_empty() || name.contains(['/', '\\', '.']) {
            return Err(format!("models_from: tên danh mục không hợp lệ '{name}'"));
        }
        let path = shared_dir.join(format!("{name}.toml"));
        let text = std::fs::read_to_string(&path).map_err(|e| format!("Không đọc được danh mục model {}: {e}", path.display()))?;
        let cat: Catalog = toml::from_str(&text).map_err(|e| format!("Danh mục model {name}.toml sai: {e}"))?;
        for spec in cat.models {
            if !m.models.iter().any(|x| x.id == spec.id) {
                m.models.push(spec);
            }
        }
    }
    Ok(())
}

pub fn format_accepts(expected: &str, actual: &str) -> bool {
    if expected == "file" || expected == actual {
        return true;
    }
    match expected {
        "media" => matches!(actual, "video" | "audio"),
        "json" => is_json_kind(actual),
        // JSON chưa gắn loại (file .json người dùng tải lên) cắm được vào ô thuộc họ JSON; tool tự kiểm nội dung
        e if is_json_kind(e) => actual == "json",
        _ => false,
    }
}

/// Các loại dữ liệu lưu dạng file JSON (cùng danh sách FORMAT_COMPAT["json"] của SDK và UI).
fn is_json_kind(f: &str) -> bool {
    matches!(f, "transcript" | "timed_lyrics" | "beat_grid" | "scene_list" | "time_ranges" | "composition" | "text_style" | "voice")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compat() {
        assert!(format_accepts("media", "video"));
        assert!(format_accepts("file", "audio"));
        assert!(!format_accepts("video", "audio"));
        // JSON chưa gắn loại vào ô họ JSON được; ngược lại loại khác thì không
        assert!(format_accepts("voice", "json") && format_accepts("composition", "json"));
        assert!(!format_accepts("voice", "composition") && !format_accepts("video", "json"));
    }

    fn entry(id: &str, describe: Option<Describe>, chain: Option<ChainDef>) -> ToolEntry {
        ToolEntry {
            id: id.into(), category: "x".into(), dir: PathBuf::new(), manifest: None, describe, status: Status::Available,
            has_docs: false, kind: if chain.is_some() { "chain".into() } else { "tool".into() }, chain,
        }
    }

    #[test]
    fn chain_params_from_tool() {
        let tool = Describe {
            inputs: vec![], outputs: vec![], check_error: None,
            params_schema: serde_json::json!({"properties": {"voice": {"type": "string", "enum": ["A", "B"], "default": "A", "x-labels": {"A": "a"}}}}),
        };
        let chain: ChainDef = serde_json::from_value(serde_json::json!({
            "params": {"type": "object", "properties": {"v": {"$from": "speech_synthesize.voice", "default": "B"}, "n": {"type": "integer"}}},
            "steps": [{"id": "s", "tool": "speech_synthesize", "params": {"voice": "$param.v"}}]
        }))
        .unwrap();
        let mut tools = BTreeMap::new();
        tools.insert("speech_synthesize".to_string(), entry("speech_synthesize", Some(tool), None));
        let d = chain.describe();
        tools.insert("c".to_string(), entry("c", Some(d), Some(chain)));
        check_chains(&mut tools);
        let c = &tools["c"];
        assert!(c.status.is_available());
        let v = &c.describe.as_ref().unwrap().params_schema["properties"]["v"];
        assert_eq!(v["enum"], serde_json::json!(["A", "B"]));
        assert_eq!(v["default"], "B", "khóa đặt cạnh $from ghi đè");
        assert!(v.get("$from").is_none());
        assert_eq!(c.chain.as_ref().unwrap().params.as_ref().unwrap()["properties"]["v"]["default"], "B");
    }

    #[test]
    fn shared_models_merge() {
        let dir = std::env::temp_dir().join(format!("mt_models_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("grp.toml"), "[[models]]\nid = \"m1\"\nlicense = \"MIT\"\n[[models]]\nid = \"own\"\nlicense = \"X\"\n").unwrap();
        let mut m: Manifest = toml::from_str(
            "models_from = [\"grp\"]\n[tool]\nid = \"a_b\"\nname = \"x\"\nversion = \"0.1.0\"\nentry = \"tool:X\"\n[[models]]\nid = \"own\"\nlicense = \"MIT\"\n",
        )
        .unwrap();
        merge_shared_models(&mut m, &dir).unwrap();
        let ids: Vec<_> = m.models.iter().map(|x| (x.id.as_str(), x.license.as_str())).collect();
        assert_eq!(ids, vec![("own", "MIT"), ("m1", "MIT")], "id trùng: khai báo của tool thắng");
        m.models_from = vec!["../x".into()];
        assert!(merge_shared_models(&mut m, &dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
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

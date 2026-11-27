//! Chuỗi của người dùng + yêu thích.
//!
//! - Chuỗi người dùng lưu đúng định dạng của chuỗi dựng sẵn: `<data>/chains/user/<tên>/{manifest.toml, chain.json, graph.json}`
//!   → registry nạp như mọi tool (chạy độc lập, lồng vào chuỗi khác, gọi qua MCP). `graph.json` là bố cục trên trình nối chuỗi.
//!   Chỉ chuỗi trong `<data>/chains` được sửa / đổi tên / xóa; chuỗi dựng sẵn (thư mục tools) chỉ đọc — mở ra để sao chép.
//! - Yêu thích: danh sách id tool / chuỗi trong `<data>/prefs.json`, lưu trên máy chủ (không mất khi đổi trình duyệt / thiết bị).

use crate::{ApiError, ApiResult, AppState};
use axum::{
    extract::{Path as AxPath, State},
    http::StatusCode,
    Json,
};
use mediatool_registry::ChainDef;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const USER_CAT: &str = "user";

// ------------------------------------------------------------------ yêu thích

fn prefs_path(s: &AppState) -> PathBuf {
    s.cfg.data_dir.join("prefs.json")
}

pub(crate) fn favorites(s: &AppState) -> Vec<String> {
    std::fs::read_to_string(prefs_path(s))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v["favorites"].as_array().cloned())
        .map(|a| a.into_iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

fn save_favorites(s: &AppState, favs: &[String]) -> ApiResult<()> {
    let p = prefs_path(s);
    let mut v: Value = std::fs::read_to_string(&p).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_else(|| json!({}));
    v["favorites"] = json!(favs);
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&v).unwrap()).map_err(|e| anyhow::anyhow!(e))?;
    std::fs::rename(&tmp, &p).map_err(|e| anyhow::anyhow!(e))?;
    Ok(())
}

pub async fn list_favorites(State(s): State<AppState>) -> Json<Value> {
    Json(json!({ "favorites": favorites(&s) }))
}

/// PUT = đánh sao, DELETE = bỏ sao. Thứ tự đánh sao được giữ (mới nhất ở cuối).
pub async fn add_favorite(State(s): State<AppState>, AxPath(id): AxPath<String>) -> ApiResult<Json<Value>> {
    if s.registry.read().unwrap().tool(&id).is_none() {
        return Err(ApiError::not_found(&format!("tool '{id}'")));
    }
    let mut f = favorites(&s);
    if !f.contains(&id) {
        f.push(id);
        save_favorites(&s, &f)?;
    }
    Ok(Json(json!({ "favorites": f })))
}

pub async fn remove_favorite(State(s): State<AppState>, AxPath(id): AxPath<String>) -> ApiResult<Json<Value>> {
    let mut f = favorites(&s);
    f.retain(|x| x != &id);
    save_favorites(&s, &f)?;
    Ok(Json(json!({ "favorites": f })))
}

// ------------------------------------------------------------------ chuỗi của người dùng

#[derive(Deserialize)]
pub struct ChainBody {
    name: Option<String>,
    #[serde(default)]
    summary: Option<String>,
    chain: Option<Value>,
    #[serde(default)]
    graph: Option<Value>,
}

fn bad(code: &str, msg: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, code, msg)
}

/// Tên hiển thị → tên thư mục: bỏ dấu tiếng Việt, chỉ a-z 0-9 _, tối đa 40 ký tự.
fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.to_lowercase().chars() {
        let base = match c {
            'à' | 'á' | 'ả' | 'ã' | 'ạ' | 'ă' | 'ằ' | 'ắ' | 'ẳ' | 'ẵ' | 'ặ' | 'â' | 'ầ' | 'ấ' | 'ẩ' | 'ẫ' | 'ậ' => 'a',
            'è' | 'é' | 'ẻ' | 'ẽ' | 'ẹ' | 'ê' | 'ề' | 'ế' | 'ể' | 'ễ' | 'ệ' => 'e',
            'ì' | 'í' | 'ỉ' | 'ĩ' | 'ị' => 'i',
            'ò' | 'ó' | 'ỏ' | 'õ' | 'ọ' | 'ô' | 'ồ' | 'ố' | 'ổ' | 'ỗ' | 'ộ' | 'ơ' | 'ờ' | 'ớ' | 'ở' | 'ỡ' | 'ợ' => 'o',
            'ù' | 'ú' | 'ủ' | 'ũ' | 'ụ' | 'ư' | 'ừ' | 'ứ' | 'ử' | 'ữ' | 'ự' => 'u',
            'ỳ' | 'ý' | 'ỷ' | 'ỹ' | 'ỵ' => 'y',
            'đ' => 'd',
            c if c.is_ascii_alphanumeric() => c,
            _ => '_',
        };
        if base != '_' || !out.ends_with('_') {
            out.push(base);
        }
    }
    let s: String = out.trim_matches('_').chars().take(40).collect();
    let s = s.trim_end_matches('_').to_string();
    if s.is_empty() || !s.chars().next().unwrap().is_ascii_alphabetic() {
        format!("c_{s}").trim_end_matches('_').to_string()
    } else {
        s
    }
}

fn toml_str(s: &str) -> String {
    toml::Value::String(s.to_string()).to_string()
}

fn manifest_text(id: &str, name: &str, summary: &str) -> String {
    format!(
        "# Chuỗi của người dùng (lưu từ trình nối chuỗi). Core đọc chain.json và chạy từng bước thành job con.\n\
         [tool]\nid          = {id}\nname        = {name}\nversion     = \"0.1.0\"\nsdk         = \">=0.1,<0.2\"\n\
         entry       = \"chain:chain.json\"\nsummary     = {summary}\ntags        = [\"chain\", \"user\"]\n\
         owners      = [\"user\"]\nlicense     = \"MIT\"\nstatus      = \"beta\"\n\n\
         [runtime]\nprofile     = \"base\"\nram_mb      = 50\ngpu         = \"none\"\nheavy       = false\ntimeout_s   = 14400\n\n\
         [mcp]\nexpose      = true\nhint        = {summary}\n",
        id = toml_str(id),
        name = toml_str(name),
        summary = toml_str(summary),
    )
}

/// Kiểm chuỗi trước khi ghi: đúng định dạng, có bước, mọi tool trong các bước có mặt và dùng được, không gọi chính nó.
fn check_chain(s: &AppState, chain: &Value, self_id: Option<&str>) -> ApiResult<()> {
    let def: ChainDef = serde_json::from_value(chain.clone()).map_err(|e| bad("BAD_CHAIN", format!("Chuỗi sai định dạng: {e}")))?;
    if def.steps.is_empty() {
        return Err(bad("BAD_CHAIN", "Chuỗi chưa có bước nào"));
    }
    let reg = s.registry.read().unwrap();
    for st in &def.steps {
        if Some(st.tool.as_str()) == self_id {
            return Err(bad("BAD_CHAIN", "Chuỗi không được gọi chính nó"));
        }
        match reg.tool(&st.tool) {
            None => return Err(bad("BAD_CHAIN", format!("Bước '{}': không có tool '{}'", st.id, st.tool))),
            Some(e) if !e.status.is_available() => return Err(bad("BAD_CHAIN", format!("Bước '{}': tool '{}' đang không dùng được", st.id, st.tool))),
            _ => {}
        }
    }
    if def.outputs.is_empty() {
        return Err(bad("BAD_CHAIN", "Chuỗi chưa có kết quả nào (nối ít nhất một output vào ô Xem kết quả)"));
    }
    Ok(())
}

fn write_files(dir: &Path, id: &str, name: &str, summary: &str, chain: Option<&Value>, graph: Option<&Value>) -> ApiResult<()> {
    std::fs::create_dir_all(dir).map_err(|e| anyhow::anyhow!(e))?;
    let w = |f: &str, data: String| -> ApiResult<()> {
        let tmp = dir.join(format!("{f}.tmp"));
        std::fs::write(&tmp, data).map_err(|e| anyhow::anyhow!(e))?;
        std::fs::rename(&tmp, dir.join(f)).map_err(|e| anyhow::anyhow!(e))?;
        Ok(())
    };
    w("manifest.toml", manifest_text(id, name, summary))?;
    if let Some(c) = chain {
        w("chain.json", serde_json::to_string_pretty(c).unwrap())?;
    }
    if let Some(g) = graph {
        w("graph.json", serde_json::to_string(g).unwrap())?;
    }
    Ok(())
}

fn user_root(s: &AppState) -> ApiResult<PathBuf> {
    s.reg_cfg.chains_root.as_ref().map(|r| r.join(USER_CAT)).ok_or_else(|| bad("NO_CHAINS_ROOT", "Máy chủ chưa bật lưu chuỗi"))
}

/// Chuỗi (dựng sẵn hoặc của người dùng): tên, mô tả, chain.json gốc (chưa giải `$from`), bố cục trình nối nếu có, sửa được không.
pub async fn get_chain(State(s): State<AppState>, AxPath(id): AxPath<String>) -> ApiResult<Json<Value>> {
    let reg = s.registry.read().unwrap();
    let e = reg.tool(&id).filter(|e| e.kind == "chain").ok_or_else(|| ApiError::not_found(&format!("chuỗi '{id}'")))?;
    let m = e.manifest.as_ref();
    let file = m.and_then(|m| m.tool.entry.strip_prefix("chain:")).unwrap_or("chain.json").trim().to_string();
    let read = |f: &str| std::fs::read_to_string(e.dir.join(f)).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
    Ok(Json(json!({
        "id": id,
        "name": m.map(|m| m.tool.name.clone()),
        "summary": m.map(|m| m.tool.summary.clone()),
        "chain": read(&file),
        "graph": read("graph.json"),
        "editable": reg.is_user_chain(&s.reg_cfg, &id),
        "status": e.status,
    })))
}

pub async fn create_chain(State(s): State<AppState>, Json(b): Json<ChainBody>) -> ApiResult<(StatusCode, Json<Value>)> {
    let name = b.name.as_deref().map(str::trim).filter(|n| !n.is_empty()).ok_or_else(|| bad("BAD_NAME", "Hãy đặt tên cho chuỗi"))?;
    if name.chars().count() > 80 {
        return Err(bad("BAD_NAME", "Tên chuỗi tối đa 80 ký tự"));
    }
    let chain = b.chain.as_ref().ok_or_else(|| bad("BAD_CHAIN", "Thiếu nội dung chuỗi"))?;
    check_chain(&s, chain, None)?;
    let root = user_root(&s)?;
    let base = slug(name);
    let mut n = 1;
    let (dir, id) = loop {
        let nm = if n == 1 { base.clone() } else { format!("{base}_{n}") };
        let id = format!("{USER_CAT}_{nm}");
        let dir = root.join(&nm);
        if !dir.exists() && s.registry.read().unwrap().tool(&id).is_none() {
            break (dir, id);
        }
        n += 1;
    };
    let summary = b.summary.clone().unwrap_or_default();
    write_files(&dir, &id, name, &summary, Some(chain), b.graph.as_ref())?;
    let rc = (*s.reg_cfg).clone();
    let reg = s.registry.clone();
    let d2 = dir.clone();
    tokio::task::spawn_blocking(move || reg.write().unwrap().load_one(&rc, &d2)).await.map_err(|e| anyhow::anyhow!(e))?;
    let st = s.registry.read().unwrap().tool(&id).map(|e| json!(e.status));
    Ok((StatusCode::CREATED, Json(json!({ "id": id, "name": name, "status": st }))))
}

pub async fn update_chain(State(s): State<AppState>, AxPath(id): AxPath<String>, Json(b): Json<ChainBody>) -> ApiResult<Json<Value>> {
    let (dir, old_name, old_summary) = {
        let reg = s.registry.read().unwrap();
        if !reg.is_user_chain(&s.reg_cfg, &id) {
            return Err(ApiError::new(StatusCode::FORBIDDEN, "READ_ONLY", "Chuỗi dựng sẵn không sửa được — hãy lưu thành chuỗi mới"));
        }
        let e = reg.tool(&id).unwrap();
        let m = e.manifest.as_ref();
        (e.dir.clone(), m.map(|m| m.tool.name.clone()).unwrap_or_default(), m.map(|m| m.tool.summary.clone()).unwrap_or_default())
    };
    let name = b.name.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(String::from).unwrap_or(old_name);
    let summary = b.summary.clone().unwrap_or(old_summary);
    if let Some(c) = &b.chain {
        check_chain(&s, c, Some(&id))?;
    }
    write_files(&dir, &id, &name, &summary, b.chain.as_ref(), b.graph.as_ref())?;
    let rc = (*s.reg_cfg).clone();
    let reg = s.registry.clone();
    tokio::task::spawn_blocking(move || reg.write().unwrap().load_one(&rc, &dir)).await.map_err(|e| anyhow::anyhow!(e))?;
    let st = s.registry.read().unwrap().tool(&id).map(|e| json!(e.status));
    Ok(Json(json!({ "id": id, "name": name, "status": st })))
}

pub async fn delete_chain(State(s): State<AppState>, AxPath(id): AxPath<String>) -> ApiResult<Json<Value>> {
    let dir = {
        let reg = s.registry.read().unwrap();
        if !reg.is_user_chain(&s.reg_cfg, &id) {
            return Err(ApiError::new(StatusCode::FORBIDDEN, "READ_ONLY", "Chỉ xóa được chuỗi của bạn"));
        }
        reg.tool(&id).unwrap().dir.clone()
    };
    std::fs::remove_dir_all(&dir).map_err(|e| anyhow::anyhow!(e))?;
    s.registry.write().unwrap().remove(&id);
    let mut f = favorites(&s);
    if f.iter().any(|x| x == &id) {
        f.retain(|x| x != &id);
        save_favorites(&s, &f)?;
    }
    Ok(Json(json!({ "deleted": id })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_vietnamese() {
        assert_eq!(slug("Karaoke từ video bài hát"), "karaoke_tu_video_bai_hat");
        assert_eq!(slug("  Đổi giọng!! 2 lần "), "doi_giong_2_lan");
        assert_eq!(slug("123 phụ đề"), "c_123_phu_de");
        assert_eq!(slug("***"), "c");
    }

    #[test]
    fn manifest_escapes_and_parses() {
        let t = manifest_text("user_a", "Tên \"lạ\"\nxuống dòng", "Mô tả");
        let m: mediatool_registry::Manifest = toml::from_str(&t).unwrap();
        assert_eq!(m.tool.name, "Tên \"lạ\"\nxuống dòng");
        assert_eq!(m.tool.entry, "chain:chain.json");
    }
}

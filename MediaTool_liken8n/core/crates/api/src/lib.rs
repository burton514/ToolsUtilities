//! HTTP API /v1. Mọi client (desktop, web, mobile, sandbox, MCP) chỉ đi qua đây.

mod preview;

use axum::{
    extract::{DefaultBodyLimit, Multipart, Path as AxPath, Query, Request, State},
    http::{header, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use futures_util::stream::{self, BoxStream, StreamExt};
use mediatool_jobs::{JobManager, JobsConfig, SubmitError};
use mediatool_registry::{Registry, RegistryConfig, ToolEntry};
use mediatool_storage::{guess_format, new_id, Store};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio_stream::wrappers::BroadcastStream;
use tower::ServiceExt;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

// ------------------------------------------------------------------ config

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub tools_root: PathBuf,
    pub miniapps_root: PathBuf,
    pub data_dir: PathBuf,
    pub config_dir: PathBuf,
    pub python: String,
    pub ram_budget_mb: u64,
    pub token: Option<String>,
    /// Cho phép đăng ký file theo đường dẫn local (chế độ desktop).
    pub allow_local_paths: bool,
    /// Thư mục web tĩnh (ví dụ bản build của sandbox) phục vụ tại "/".
    pub static_dir: Option<PathBuf>,
}

impl ServerConfig {
    pub fn from_env() -> Self {
        let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.to_string());
        Self {
            host: env("MEDIATOOL_HOST", "127.0.0.1"),
            port: env("MEDIATOOL_PORT", "8787").parse().unwrap_or(8787),
            tools_root: env("MEDIATOOL_TOOLS", "tools").into(),
            miniapps_root: env("MEDIATOOL_MINIAPPS", "miniapps").into(),
            data_dir: env("MEDIATOOL_DATA", "data").into(),
            config_dir: env("MEDIATOOL_CONFIG", "config").into(),
            python: env("MEDIATOOL_PYTHON", if cfg!(windows) { "python" } else { "python3" }),
            ram_budget_mb: env("MEDIATOOL_RAM_BUDGET_MB", "5500").parse().unwrap_or(5500),
            token: std::env::var("MEDIATOOL_TOKEN").ok().filter(|t| !t.is_empty()),
            allow_local_paths: env("MEDIATOOL_ALLOW_LOCAL_PATHS", "0") == "1",
            static_dir: std::env::var("MEDIATOOL_STATIC").ok().map(PathBuf::from),
        }
    }

    fn disabled_tools(&self) -> Vec<String> {
        #[derive(Deserialize, Default)]
        struct ToolsToml {
            #[serde(default)]
            disabled: Vec<String>,
        }
        std::fs::read_to_string(self.config_dir.join("tools.toml"))
            .ok()
            .and_then(|t| toml::from_str::<ToolsToml>(&t).ok())
            .unwrap_or_default()
            .disabled
    }
}

#[derive(Clone)]
pub struct AppState {
    store: Arc<Store>,
    registry: Arc<RwLock<Registry>>,
    jobs: Arc<JobManager>,
    cfg: Arc<ServerConfig>,
    reg_cfg: Arc<RegistryConfig>,
    preview: preview::PreviewService,
}

/// Khởi động toàn bộ core và phục vụ HTTP cho tới khi tiến trình dừng.
pub async fn serve(cfg: ServerConfig) -> anyhow::Result<()> {
    let state = build_state(cfg.clone()).await?;
    let app = router(state);
    let listener = tokio::net::TcpListener::bind((cfg.host.as_str(), cfg.port)).await?;
    tracing::info!("MediaTool core đang chạy tại http://{}:{}", cfg.host, cfg.port);
    axum::serve(listener, app).await?;
    Ok(())
}

pub async fn build_state(cfg: ServerConfig) -> anyhow::Result<AppState> {
    let store = Arc::new(Store::open(&cfg.data_dir)?);
    let reg_cfg = RegistryConfig {
        tools_root: cfg.tools_root.canonicalize().unwrap_or_else(|_| cfg.tools_root.clone()),
        miniapps_root: cfg.miniapps_root.canonicalize().unwrap_or_else(|_| cfg.miniapps_root.clone()),
        python: cfg.python.clone(),
        disabled: cfg.disabled_tools(),
    };
    let rc = reg_cfg.clone();
    let registry = tokio::task::spawn_blocking(move || Registry::scan(&rc)).await?;
    tracing::info!("Registry: {} tool, {} mini app", registry.tools.len(), registry.miniapps.len());
    let registry = Arc::new(RwLock::new(registry));
    let jobs = JobManager::new(
        store.clone(),
        registry.clone(),
        JobsConfig { python: cfg.python.clone(), ram_budget_mb: cfg.ram_budget_mb, cancel_grace: Duration::from_secs(5) },
    );
    Ok(AppState { store, registry, jobs, cfg: Arc::new(cfg), reg_cfg: Arc::new(reg_cfg), preview: preview::PreviewService::start() })
}

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/tools", get(list_tools))
        .route("/tools/:id", get(get_tool))
        .route("/tools/:id/docs", get(tool_docs))
        .route("/tools/:id/jobs", post(submit_job))
        .route("/tools/:id/examples/:index/jobs", post(run_example))
        .route("/miniapps", get(list_miniapps))
        .route("/miniapps/:name", get(get_miniapp))
        .route("/assets", get(list_assets).post(upload_asset).layer(DefaultBodyLimit::disable()))
        .route("/assets/register", post(register_local))
        .route("/assets/:id", get(get_asset))
        .route("/assets/:id/content", get(asset_content))
        .route("/assets/:id/filmstrip", get(asset_filmstrip))
        .route("/assets/:id/peaks", get(asset_peaks))
        .route("/jobs", get(list_jobs))
        .route("/jobs/:id", get(get_job))
        .route("/jobs/:id/events", get(job_events))
        .route("/jobs/:id/cancel", post(cancel_job))
        .route("/preview/frame", post(preview_frame))
        .route("/system", get(system))
        .route("/registry/reload", post(reload_registry))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth));

    let static_dir = state.cfg.static_dir.clone();
    let app = Router::new()
        .route("/health", get(|| async { Json(json!({"ok": true, "version": env!("CARGO_PKG_VERSION")})) }))
        .nest("/v1", api)
        .layer(CorsLayer::permissive())
        .with_state(state);
    match static_dir {
        Some(dir) => app.fallback_service(ServeDir::new(&dir).fallback(ServeFile::new(dir.join("index.html")))),
        None => app,
    }
}

// ------------------------------------------------------------------ errors

pub struct ApiError {
    status: StatusCode,
    code: String,
    message: String,
    details: Vec<Value>,
}

impl ApiError {
    fn new(status: StatusCode, code: &str, message: impl Into<String>) -> Self {
        Self { status, code: code.into(), message: message.into(), details: vec![] }
    }
    fn not_found(what: &str) -> Self {
        Self::new(StatusCode::NOT_FOUND, "NOT_FOUND", format!("Không tìm thấy {what}"))
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = json!({"error": {"code": self.code, "message": self.message, "details": self.details}});
        (self.status, Json(body)).into_response()
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL", e.to_string())
    }
}

impl From<SubmitError> for ApiError {
    fn from(e: SubmitError) -> Self {
        Self {
            status: StatusCode::from_u16(e.status).unwrap_or(StatusCode::BAD_REQUEST),
            code: e.code,
            message: e.message,
            details: e.details,
        }
    }
}

type ApiResult<T> = Result<T, ApiError>;

async fn auth(State(s): State<AppState>, req: Request, next: Next) -> Response {
    if let Some(token) = &s.cfg.token {
        let bearer = req
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(|v| v == token)
            .unwrap_or(false);
        // EventSource không gửi được header → cho phép ?token=
        let query = req
            .uri()
            .query()
            .map(|q| q.split('&').any(|kv| kv == format!("token={token}")))
            .unwrap_or(false);
        if !bearer && !query {
            return ApiError::new(StatusCode::UNAUTHORIZED, "UNAUTHORIZED", "Thiếu hoặc sai token").into_response();
        }
    }
    next.run(req).await
}

// ------------------------------------------------------------------ tools

fn tool_summary(e: &ToolEntry) -> Value {
    let m = e.manifest.as_ref();
    let d = e.describe.as_ref();
    json!({
        "id": e.id,
        "category": e.category,
        "name": m.map(|m| m.tool.name.clone()).unwrap_or_else(|| e.id.clone()),
        "summary": m.map(|m| m.tool.summary.clone()).unwrap_or_default(),
        "version": m.map(|m| m.tool.version.clone()),
        "tool_status": m.map(|m| m.tool.status.clone()),
        "tags": m.map(|m| m.tool.tags.clone()).unwrap_or_default(),
        "status": e.status,
        "runtime": m.map(|m| &m.runtime),
        "inputs": d.map(|d| &d.inputs),
        "outputs": d.map(|d| &d.outputs),
        "has_docs": e.has_docs,
        "example_count": m.map(|m| m.examples.len()).unwrap_or(0),
    })
}

async fn list_tools(State(s): State<AppState>) -> Json<Value> {
    let reg = s.registry.read().unwrap();
    Json(json!({"tools": reg.tools.values().map(tool_summary).collect::<Vec<_>>()}))
}

async fn get_tool(State(s): State<AppState>, AxPath(id): AxPath<String>) -> ApiResult<Json<Value>> {
    let reg = s.registry.read().unwrap();
    let e = reg.tool(&id).ok_or_else(|| ApiError::not_found(&format!("tool '{id}'")))?;
    let mut v = tool_summary(e);
    v["manifest"] = serde_json::to_value(&e.manifest).unwrap_or(Value::Null);
    v["params_schema"] = e.describe.as_ref().map(|d| d.params_schema.clone()).unwrap_or(Value::Null);
    Ok(Json(v))
}

async fn tool_docs(State(s): State<AppState>, AxPath(id): AxPath<String>) -> ApiResult<Response> {
    let dir = {
        let reg = s.registry.read().unwrap();
        reg.tool(&id).ok_or_else(|| ApiError::not_found(&format!("tool '{id}'")))?.dir.clone()
    };
    let text = tokio::fs::read_to_string(dir.join("README.md"))
        .await
        .map_err(|_| ApiError::not_found("README.md của tool"))?;
    Ok(([(header::CONTENT_TYPE, "text/markdown; charset=utf-8")], text).into_response())
}

#[derive(Deserialize, Default)]
struct SubmitBody {
    #[serde(default)]
    inputs: Value,
    #[serde(default)]
    params: Value,
}

async fn submit_job(
    State(s): State<AppState>,
    AxPath(id): AxPath<String>,
    Json(body): Json<SubmitBody>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let job = s.jobs.submit(&id, &body.inputs, &body.params)?;
    Ok((StatusCode::ACCEPTED, Json(serde_json::to_value(job).unwrap_or_default())))
}

/// Chạy [[examples]] số `index` (bắt đầu từ 1): file mẫu trong thư mục tool được đăng ký thành asset.
async fn run_example(
    State(s): State<AppState>,
    AxPath((id, index)): AxPath<(String, usize)>,
    body: Option<Json<SubmitBody>>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let (dir, example, input_formats) = {
        let reg = s.registry.read().unwrap();
        let e = reg.tool(&id).ok_or_else(|| ApiError::not_found(&format!("tool '{id}'")))?;
        let ex = e
            .manifest
            .as_ref()
            .and_then(|m| m.examples.get(index.wrapping_sub(1)).cloned())
            .ok_or_else(|| ApiError::not_found(&format!("ví dụ số {index}")))?;
        let formats: HashMap<String, String> = e
            .describe
            .as_ref()
            .map(|d| d.inputs.iter().filter_map(|f| Some((f.name.clone(), f.format.clone()?))).collect())
            .unwrap_or_default();
        (e.dir.clone(), ex, formats)
    };
    let tool_dir = dir.canonicalize().map_err(|e| anyhow::anyhow!(e))?;
    let mut inputs = Map::new();
    for (name, v) in &example.inputs {
        let declared = input_formats.get(name).cloned();
        let register = |rel: &str| -> ApiResult<Value> {
            let p = tool_dir
                .join(rel)
                .canonicalize()
                .map_err(|_| ApiError::not_found(&format!("file mẫu '{rel}'")))?;
            if !p.starts_with(&tool_dir) {
                return Err(ApiError::new(StatusCode::FORBIDDEN, "FORBIDDEN", "File mẫu phải nằm trong thư mục tool"));
            }
            let mut fmt = guess_format(&p.to_string_lossy()).to_string();
            // file .json của ví dụ mang đúng loại mà input khai báo (composition, timed_lyrics…)
            if fmt == "json" {
                if let Some(d) = declared.as_deref().filter(|d| mediatool_registry::format_accepts("json", d)) {
                    fmt = d.to_string();
                }
            }
            let a = s.store.insert_asset(&fmt, &p, None, json!({"sample": true}))?;
            Ok(Value::String(a.id))
        };
        let value = match v {
            Value::String(rel) => register(rel)?,
            Value::Array(items) => Value::Array(
                items.iter().filter_map(|x| x.as_str()).map(register).collect::<ApiResult<Vec<_>>>()?,
            ),
            _ => continue,
        };
        inputs.insert(name.clone(), value);
    }
    let mut params = Value::Object(example.params.clone());
    if let Some(Json(b)) = body {
        if let (Some(p), Some(over)) = (params.as_object_mut(), b.params.as_object()) {
            for (k, v) in over {
                p.insert(k.clone(), v.clone());
            }
        }
    }
    let job = s.jobs.submit(&id, &Value::Object(inputs), &params)?;
    Ok((StatusCode::ACCEPTED, Json(serde_json::to_value(job).unwrap_or_default())))
}

// ------------------------------------------------------------------ mini apps

async fn list_miniapps(State(s): State<AppState>) -> Json<Value> {
    let reg = s.registry.read().unwrap();
    Json(json!({"miniapps": reg.miniapps.values().collect::<Vec<_>>()}))
}

async fn get_miniapp(State(s): State<AppState>, AxPath(name): AxPath<String>) -> ApiResult<Json<Value>> {
    let reg = s.registry.read().unwrap();
    let m = reg.miniapps.get(&name).ok_or_else(|| ApiError::not_found(&format!("mini app '{name}'")))?;
    Ok(Json(serde_json::to_value(m).unwrap_or_default()))
}

// ------------------------------------------------------------------ assets

fn safe_filename(name: &str) -> String {
    let base = Path::new(name).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_control() || "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').to_string();
    if cleaned.is_empty() { "upload.bin".into() } else { cleaned }
}

async fn upload_asset(State(s): State<AppState>, mut multipart: Multipart) -> ApiResult<(StatusCode, Json<Value>)> {
    let mut saved: Option<PathBuf> = None;
    let mut format_override: Option<String> = None;
    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::new(StatusCode::BAD_REQUEST, "BAD_UPLOAD", e.to_string()))?
    {
        match field.name() {
            Some("format") => format_override = field.text().await.ok().filter(|t| !t.is_empty()),
            Some("file") => {
                let filename = safe_filename(field.file_name().unwrap_or("upload.bin"));
                let dir = s.store.assets_dir().join(new_id("u"));
                tokio::fs::create_dir_all(&dir).await.map_err(|e| anyhow::anyhow!(e))?;
                let path = dir.join(&filename);
                let mut f = tokio::fs::File::create(&path).await.map_err(|e| anyhow::anyhow!(e))?;
                while let Some(chunk) = field
                    .chunk()
                    .await
                    .map_err(|e| ApiError::new(StatusCode::BAD_REQUEST, "BAD_UPLOAD", e.to_string()))?
                {
                    f.write_all(&chunk).await.map_err(|e| anyhow::anyhow!(e))?;
                }
                f.flush().await.map_err(|e| anyhow::anyhow!(e))?;
                saved = Some(path);
            }
            _ => {}
        }
    }
    let path = saved.ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "BAD_UPLOAD", "Thiếu trường 'file'"))?;
    let fmt = format_override.unwrap_or_else(|| guess_format(&path.to_string_lossy()).to_string());
    let a = s.store.insert_asset(&fmt, &path, None, json!({}))?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(a).unwrap_or_default())))
}

#[derive(Deserialize)]
struct RegisterBody {
    path: String,
    #[serde(default)]
    format: Option<String>,
}

async fn register_local(State(s): State<AppState>, Json(b): Json<RegisterBody>) -> ApiResult<(StatusCode, Json<Value>)> {
    if !s.cfg.allow_local_paths {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "FORBIDDEN", "Chỉ dùng được ở chế độ desktop (MEDIATOOL_ALLOW_LOCAL_PATHS=1)"));
    }
    let p = PathBuf::from(&b.path).canonicalize().map_err(|_| ApiError::not_found(&format!("file '{}'", b.path)))?;
    if !p.is_file() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "NOT_A_FILE", "Đường dẫn không phải là file"));
    }
    let fmt = b.format.unwrap_or_else(|| guess_format(&p.to_string_lossy()).to_string());
    let a = s.store.insert_asset(&fmt, &p, None, json!({"local": true}))?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(a).unwrap_or_default())))
}

async fn list_assets(State(s): State<AppState>) -> ApiResult<Json<Value>> {
    Ok(Json(json!({"assets": s.store.list_assets(200)?})))
}

async fn get_asset(State(s): State<AppState>, AxPath(id): AxPath<String>) -> ApiResult<Json<Value>> {
    let a = s.store.get_asset(&id)?.ok_or_else(|| ApiError::not_found(&format!("asset '{id}'")))?;
    Ok(Json(serde_json::to_value(a).unwrap_or_default()))
}

async fn asset_content(
    State(s): State<AppState>,
    AxPath(id): AxPath<String>,
    Query(q): Query<HashMap<String, String>>,
    req: Request,
) -> ApiResult<Response> {
    let a = s.store.get_asset(&id)?.ok_or_else(|| ApiError::not_found(&format!("asset '{id}'")))?;
    let mut res = match ServeFile::new(&a.path).oneshot(req).await {
        Ok(r) => r.into_response(),
        Err(never) => match never {},
    };
    if q.get("download").map(|v| v == "1").unwrap_or(false) {
        let value = format!("attachment; filename*=UTF-8''{}", percent_encode(&a.filename));
        if let Ok(h) = HeaderValue::from_str(&value) {
            res.headers_mut().insert(header::CONTENT_DISPOSITION, h);
        }
    }
    Ok(res)
}

/// Dải ảnh thu nhỏ cho timeline (engine native: FFmpeg decode + Skia ghép), cache trong data/cache.
async fn asset_filmstrip(
    State(s): State<AppState>,
    AxPath(id): AxPath<String>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Response> {
    let a = s.store.get_asset(&id)?.ok_or_else(|| ApiError::not_found(&format!("asset '{id}'")))?;
    if a.format != "video" {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "NOT_VIDEO", "Chỉ video mới có filmstrip"));
    }
    let count: u32 = q.get("count").and_then(|v| v.parse().ok()).unwrap_or(10).clamp(1, 60);
    let height: u32 = q.get("height").and_then(|v| v.parse().ok()).unwrap_or(64).clamp(16, 360);
    let cache = s.store.data_dir().join("cache").join(format!("{id}_film_{count}_{height}.jpg"));
    let bytes = match tokio::fs::read(&cache).await {
        Ok(b) => b,
        Err(_) => {
            let path = a.path.to_string_lossy().into_owned();
            let b = tokio::task::spawn_blocking(move || mediatool_engine::media::filmstrip(&path, count, height))
                .await
                .map_err(|e| anyhow::anyhow!(e))?
                .map_err(|e| ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "FILMSTRIP_FAILED", format!("{e:#}")))?;
            let _ = tokio::fs::create_dir_all(cache.parent().unwrap()).await;
            let _ = tokio::fs::write(&cache, &b).await;
            b
        }
    };
    Ok(([(header::CONTENT_TYPE, "image/jpeg"), (header::CACHE_CONTROL, "max-age=86400")], bytes).into_response())
}

/// Đỉnh sóng âm (0..1) cho timeline, cache trong data/cache.
async fn asset_peaks(
    State(s): State<AppState>,
    AxPath(id): AxPath<String>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let a = s.store.get_asset(&id)?.ok_or_else(|| ApiError::not_found(&format!("asset '{id}'")))?;
    let buckets: usize = q.get("buckets").and_then(|v| v.parse().ok()).unwrap_or(400).clamp(8, 8000);
    let cache = s.store.data_dir().join("cache").join(format!("{id}_peaks_{buckets}.json"));
    if let Ok(text) = tokio::fs::read_to_string(&cache).await {
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            return Ok(Json(v));
        }
    }
    let path = a.path.to_string_lossy().into_owned();
    let ffmpeg = std::env::var("MEDIATOOL_FFMPEG").unwrap_or_else(|_| "ffmpeg".into());
    let peaks = tokio::task::spawn_blocking(move || mediatool_engine::media::peaks(&ffmpeg, &path, buckets))
        .await
        .map_err(|e| anyhow::anyhow!(e))?
        .map_err(|e| ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "PEAKS_FAILED", format!("{e:#}")))?;
    let v = json!({ "buckets": buckets, "peaks": peaks });
    let _ = tokio::fs::create_dir_all(cache.parent().unwrap()).await;
    let _ = tokio::fs::write(&cache, v.to_string()).await;
    Ok(Json(v))
}

fn percent_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

// ------------------------------------------------------------------ jobs

async fn list_jobs(State(s): State<AppState>) -> ApiResult<Json<Value>> {
    Ok(Json(json!({"jobs": s.store.list_jobs(100)?})))
}

async fn get_job(State(s): State<AppState>, AxPath(id): AxPath<String>) -> ApiResult<Json<Value>> {
    let j = s.store.get_job(&id)?.ok_or_else(|| ApiError::not_found(&format!("job '{id}'")))?;
    Ok(Json(serde_json::to_value(j).unwrap_or_default()))
}

async fn job_events(
    State(s): State<AppState>,
    AxPath(id): AxPath<String>,
) -> ApiResult<Sse<BoxStream<'static, Result<Event, Infallible>>>> {
    // subscribe trước rồi mới đọc snapshot → không lỡ sự kiện nào
    let rx = s.jobs.subscribe(&id);
    let job = s.store.get_job(&id)?.ok_or_else(|| ApiError::not_found(&format!("job '{id}'")))?;
    let snapshot = Event::default()
        .event("snapshot")
        .data(serde_json::to_string(&job).unwrap_or_default());
    let head = stream::once(async move { Ok::<Event, Infallible>(snapshot) });
    let tail: BoxStream<'static, Result<Event, Infallible>> = match rx {
        Some(rx) => BroadcastStream::new(rx)
            .filter_map(|m| async move {
                let v = m.ok()?;
                let name = v["event"].as_str().unwrap_or("message").to_string();
                Some(Ok::<Event, Infallible>(Event::default().event(name).data(v.to_string())))
            })
            .boxed(),
        None => stream::empty().boxed(),
    };
    Ok(Sse::new(head.chain(tail).boxed()).keep_alive(KeepAlive::default()))
}

async fn cancel_job(State(s): State<AppState>, AxPath(id): AxPath<String>) -> Json<Value> {
    Json(json!({"cancelled": s.jobs.cancel(&id)}))
}

// ------------------------------------------------------------------ preview (engine native)

#[derive(Deserialize)]
struct PreviewBody {
    composition: Value,
    #[serde(default)]
    time: f64,
    #[serde(default = "default_preview_width")]
    width: u32,
}

fn default_preview_width() -> u32 {
    960
}

async fn preview_frame(State(s): State<AppState>, Json(b): Json<PreviewBody>) -> ApiResult<Json<Value>> {
    let mut comp: mediatool_engine::Composition = serde_json::from_value(b.composition)
        .map_err(|e| ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "BAD_COMPOSITION", e.to_string()))?;
    let allow_local = s.cfg.allow_local_paths;
    comp.resolve_sources(|src| match src.strip_prefix("asset:") {
        Some(id) => s.store.get_asset(id).ok().flatten().map(|a| a.path.to_string_lossy().into_owned()),
        None if allow_local => Some(src.to_string()),
        None => None,
    })
    .map_err(|e| ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "BAD_SOURCE", e))?;
    let frame = s
        .preview
        .render(comp, b.time.max(0.0), b.width.clamp(64, 3840))
        .await
        .map_err(|e| ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "RENDER_FAILED", e))?;
    Ok(Json(frame))
}

// ------------------------------------------------------------------ system

async fn system(State(s): State<AppState>) -> Json<Value> {
    let reg = s.registry.read().unwrap();
    let available = reg.tools.values().filter(|t| t.status.is_available()).count();
    Json(json!({
        "version": env!("CARGO_PKG_VERSION"),
        "protocol": mediatool_jobs::PROTOCOL,
        "tools": reg.tools.len(),
        "tools_available": available,
        "miniapps": reg.miniapps.len(),
        "jobs": s.jobs.stats(),
        "local_paths": s.cfg.allow_local_paths,
    }))
}

async fn reload_registry(State(s): State<AppState>) -> ApiResult<Json<Value>> {
    let rc = (*s.reg_cfg).clone();
    let fresh = tokio::task::spawn_blocking(move || Registry::scan(&rc))
        .await
        .map_err(|e| anyhow::anyhow!(e))?;
    let (t, m) = (fresh.tools.len(), fresh.miniapps.len());
    *s.registry.write().unwrap() = fresh;
    Ok(Json(json!({"tools": t, "miniapps": m})))
}

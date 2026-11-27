//! Jobs: validate nghiêm input/params, xếp hàng theo ngân sách RAM, chạy mỗi job trong một
//! subprocess worker (giao thức JSON-lines), đăng ký output thành asset có lineage.

use mediatool_registry::{format_accepts, ChainDef, Registry};
use mediatool_storage::{Job, Store};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{broadcast, mpsc};
use tokio::time::Instant;

pub mod models;

pub const PROTOCOL: u32 = 1;

#[derive(Debug, Clone)]
pub struct JobsConfig {
    pub python: String,
    pub ram_budget_mb: u64,
    pub cancel_grace: Duration,
    /// Thiết bị cho tool khai `runtime.gpu = "optional" | "required"`: "cuda" khi máy chủ chạy bản GPU, ngược lại "cpu".
    /// Tool `gpu = "none"` luôn nhận "cpu". Một lựa chọn duy nhất cho cả máy (MEDIATOOL_DEVICE).
    pub device: String,
}

#[derive(Debug)]
pub struct SubmitError {
    pub status: u16,
    pub code: String,
    pub message: String,
    pub details: Vec<Value>,
}

impl SubmitError {
    fn new(status: u16, code: &str, message: impl Into<String>) -> Self {
        Self { status, code: code.into(), message: message.into(), details: vec![] }
    }
}

struct Pending {
    job_id: String,
    tool_id: String,
    tool_version: String,
    dir: PathBuf,
    ram_mb: u64,
    gpu: String,
    heavy: bool,
    timeout_s: u64,
    inputs: Value,
    input_ids: Vec<String>,
    params: Value,
    /// tool là chuỗi: chạy từng bước thành job con
    chain: Option<ChainDef>,
}

#[derive(Default)]
struct Sched {
    queue: VecDeque<Pending>,
    used_ram: u64,
    heavy_running: HashSet<String>,
    running: usize,
}

type Outcome = (String, Option<Value>, Option<Value>);

pub struct JobManager {
    store: Arc<Store>,
    registry: Arc<RwLock<Registry>>,
    cfg: JobsConfig,
    sched: Mutex<Sched>,
    channels: Mutex<HashMap<String, broadcast::Sender<Value>>>,
    cancels: Mutex<HashMap<String, mpsc::UnboundedSender<()>>>,
}

fn detail(field: &str, message: impl Into<String>) -> Value {
    json!({ "field": field, "message": message.into() })
}

impl JobManager {
    pub fn new(store: Arc<Store>, registry: Arc<RwLock<Registry>>, cfg: JobsConfig) -> Arc<Self> {
        Arc::new(Self {
            store,
            registry,
            cfg,
            sched: Mutex::new(Sched::default()),
            channels: Mutex::new(HashMap::new()),
            cancels: Mutex::new(HashMap::new()),
        })
    }

    pub fn stats(&self) -> Value {
        let s = self.sched.lock().unwrap();
        json!({
            "ram_budget_mb": self.cfg.ram_budget_mb,
            "used_ram_mb": s.used_ram,
            "running": s.running,
            "queued": s.queue.len(),
        })
    }

    /// Validate và xếp hàng một job. `inputs`: { tên: asset_id | [asset_id] }.
    pub fn submit(self: &Arc<Self>, tool_id: &str, inputs: &Value, params: &Value) -> Result<Job, SubmitError> {
        let (dir, manifest, describe, chain) = {
            let reg = self.registry.read().unwrap();
            let entry = reg
                .tool(tool_id)
                .ok_or_else(|| SubmitError::new(404, "TOOL_NOT_FOUND", format!("Không có tool '{tool_id}'")))?;
            if let mediatool_registry::Status::Unavailable { reason } = &entry.status {
                return Err(SubmitError::new(409, "TOOL_UNAVAILABLE", reason.clone()));
            }
            match (&entry.manifest, &entry.describe) {
                (Some(m), Some(d)) => (entry.dir.clone(), m.clone(), d.clone(), entry.chain.clone()),
                _ => return Err(SubmitError::new(409, "TOOL_UNAVAILABLE", "Tool chưa sẵn sàng")),
            }
        };

        let mut details = Vec::new();
        let empty = Map::new();
        let given = match inputs {
            Value::Null => &empty,
            Value::Object(o) => o,
            _ => return Err(SubmitError::new(422, "VALIDATION_FAILED", "inputs phải là object")),
        };
        for k in given.keys() {
            if !describe.inputs.iter().any(|f| &f.name == k) {
                details.push(detail(k, format!("Input không tồn tại: '{k}'")));
            }
        }

        let mut resolved = Map::new();
        let mut ids = Vec::new();
        for f in &describe.inputs {
            let v = match given.get(&f.name) {
                None | Some(Value::Null) => {
                    if f.required {
                        details.push(detail(&f.name, format!("Thiếu input bắt buộc '{}'", f.name)));
                    }
                    continue;
                }
                Some(v) => v,
            };
            let items: Vec<&Value> = match (f.multiple, v.as_array()) {
                (true, Some(a)) => a.iter().collect(),
                (false, Some(_)) => {
                    details.push(detail(&f.name, "Input này chỉ nhận một file"));
                    continue;
                }
                _ => vec![v],
            };
            let mut out = Vec::new();
            for item in items {
                let id = item.as_str().or_else(|| item.get("asset_id").and_then(|x| x.as_str()));
                let Some(id) = id else {
                    details.push(detail(&f.name, "Giá trị phải là asset id"));
                    continue;
                };
                match self.store.get_asset(id) {
                    Ok(Some(a)) => {
                        if let Some(fmt) = &f.format {
                            if !format_accepts(fmt, &a.format) {
                                details.push(detail(
                                    &f.name,
                                    format!("Cần loại '{fmt}', asset {} là '{}'", a.id, a.format),
                                ));
                                continue;
                            }
                        }
                        ids.push(a.id.clone());
                        out.push(json!({
                            "asset_id": a.id, "format": a.format,
                            "path": a.path.to_string_lossy(), "meta": a.meta,
                        }));
                    }
                    _ => details.push(detail(&f.name, format!("Không tìm thấy asset '{id}'"))),
                }
            }
            let value = if f.multiple { Value::Array(out) } else { out.into_iter().next().unwrap_or(Value::Null) };
            resolved.insert(f.name.clone(), value);
        }

        let params = if params.is_null() { json!({}) } else { params.clone() };
        if !params.is_object() {
            details.push(detail("params", "params phải là object"));
        } else {
            match jsonschema::JSONSchema::compile(&describe.params_schema) {
                Ok(schema) => {
                    if let Err(errors) = schema.validate(&params) {
                        for e in errors {
                            let path = e.instance_path.to_string();
                            let field = path.trim_start_matches('/').to_string();
                            details.push(detail(if field.is_empty() { "params" } else { field.as_str() }, e.to_string()));
                        }
                    }
                }
                Err(e) => tracing::warn!(tool = tool_id, "params_schema không compile được: {e}"),
            }
        }

        if !details.is_empty() {
            let mut err = SubmitError::new(422, "VALIDATION_FAILED", "Input hoặc tham số không hợp lệ");
            err.details = details;
            return Err(err);
        }

        let job = self
            .store
            .insert_job(tool_id, inputs, &params)
            .map_err(|e| SubmitError::new(500, "STORAGE_ERROR", e.to_string()))?;
        let (tx, _) = broadcast::channel(512);
        self.channels.lock().unwrap().insert(job.id.clone(), tx);
        self.sched.lock().unwrap().queue.push_back(Pending {
            job_id: job.id.clone(),
            tool_id: tool_id.to_string(),
            tool_version: manifest.tool.version.clone(),
            dir,
            ram_mb: manifest.runtime.ram_mb,
            gpu: manifest.runtime.gpu.clone(),
            heavy: manifest.runtime.heavy,
            timeout_s: manifest.runtime.timeout_s,
            inputs: Value::Object(resolved),
            input_ids: ids,
            params,
            chain,
        });
        self.pump();
        Ok(job)
    }

    pub fn subscribe(&self, job_id: &str) -> Option<broadcast::Receiver<Value>> {
        self.channels.lock().unwrap().get(job_id).map(|tx| tx.subscribe())
    }

    /// true nếu đã gửi lệnh hủy (hoặc đã hủy khi job còn trong hàng đợi).
    pub fn cancel(&self, job_id: &str) -> bool {
        let queued = {
            let mut s = self.sched.lock().unwrap();
            s.queue.iter().position(|p| p.job_id == job_id).and_then(|i| s.queue.remove(i))
        };
        if queued.is_some() {
            let err = json!({"kind": "cancelled", "code": "CANCELLED", "message": "Đã hủy khi đang chờ"});
            let _ = self.store.finish(job_id, "cancelled", None, Some(&err));
            self.send(job_id, json!({"event": "status", "status": "cancelled", "error": err}));
            self.channels.lock().unwrap().remove(job_id);
            return true;
        }
        match self.cancels.lock().unwrap().get(job_id) {
            Some(tx) => tx.send(()).is_ok(),
            None => false,
        }
    }

    fn send(&self, job_id: &str, ev: Value) {
        if let Some(tx) = self.channels.lock().unwrap().get(job_id) {
            let _ = tx.send(ev);
        }
    }

    fn pump(self: &Arc<Self>) {
        let mut start = Vec::new();
        {
            let mut s = self.sched.lock().unwrap();
            let mut i = 0;
            while i < s.queue.len() {
                let (ram, heavy, tool) = {
                    let p = &s.queue[i];
                    (p.ram_mb, p.heavy, p.tool_id.clone())
                };
                let fits = s.used_ram + ram <= self.cfg.ram_budget_mb || s.running == 0;
                let heavy_ok = !heavy || !s.heavy_running.contains(&tool);
                if fits && heavy_ok {
                    let p = s.queue.remove(i).expect("index hợp lệ");
                    s.used_ram += ram;
                    s.running += 1;
                    if heavy {
                        s.heavy_running.insert(tool);
                    }
                    start.push(p);
                } else {
                    i += 1;
                }
            }
        }
        for p in start {
            let me = Arc::clone(self);
            tokio::spawn(async move { me.run(p).await });
        }
    }

    async fn run(self: Arc<Self>, p: Pending) {
        let (status, result, error) = match &p.chain {
            Some(c) => self.execute_chain(&p, c).await,
            None => self.execute(&p).await,
        };
        {
            let mut s = self.sched.lock().unwrap();
            s.used_ram = s.used_ram.saturating_sub(p.ram_mb);
            s.running = s.running.saturating_sub(1);
            if p.heavy {
                s.heavy_running.remove(&p.tool_id);
            }
        }
        self.cancels.lock().unwrap().remove(&p.job_id);
        if let Err(e) = self.store.finish(&p.job_id, &status, result.as_ref(), error.as_ref()) {
            tracing::error!(job = %p.job_id, "không lưu được kết quả: {e}");
        }
        tracing::info!(job = %p.job_id, tool = %p.tool_id, %status, "job kết thúc");
        self.send(&p.job_id, json!({"event": "status", "status": status, "result": result, "error": error}));
        self.channels.lock().unwrap().remove(&p.job_id); // đóng các stream SSE
        self.pump();
    }

    async fn execute(&self, p: &Pending) -> Outcome {
        let crash = |code: &str, msg: String| -> Outcome {
            ("failed".into(), None, Some(json!({"kind": "crash", "code": code, "message": msg})))
        };
        let _ = self.store.mark_running(&p.job_id);
        self.send(&p.job_id, json!({"event": "status", "status": "running"}));

        let workdir = self.store.jobs_dir().join(&p.job_id);
        if let Err(e) = std::fs::create_dir_all(&workdir) {
            return crash("WORKDIR_FAILED", e.to_string());
        }
        let device = if self.cfg.device == "cuda" && p.gpu != "none" { "cuda" } else { "cpu" };
        let spec = json!({
            "protocol": PROTOCOL, "job_id": &p.job_id, "tool_dir": p.dir.to_string_lossy(),
            "workdir": workdir.to_string_lossy(), "inputs": &p.inputs, "params": &p.params,
            "limits": {"ram_mb": p.ram_mb}, "device": device,
        });

        let mut child = match Command::new(&self.cfg.python)
            .args(["-m", "mediatool_worker", "run"])
            .current_dir(&workdir)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUNBUFFERED", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
        {
            Ok(c) => c,
            Err(e) => return crash("WORKER_SPAWN_FAILED", format!("{}: {e}", self.cfg.python)),
        };

        let mut stdin = child.stdin.take().expect("stdin piped");
        if let Err(e) = stdin.write_all(format!("{spec}\n").as_bytes()).await {
            return crash("WORKER_IO", e.to_string());
        }
        let mut stdout = BufReader::new(child.stdout.take().expect("stdout piped")).lines();
        let stderr = child.stderr.take().expect("stderr piped");

        let log_tx = self.channels.lock().unwrap().get(&p.job_id).cloned();
        let log_path = workdir.join("worker.log");
        let stderr_task = tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            let mut file = tokio::fs::File::create(log_path).await.ok();
            let mut tail: VecDeque<String> = VecDeque::new();
            while let Ok(Some(l)) = lines.next_line().await {
                if let Some(f) = file.as_mut() {
                    let _ = f.write_all(format!("{l}\n").as_bytes()).await;
                }
                if let Some(tx) = &log_tx {
                    let _ = tx.send(json!({"event": "log", "level": "debug", "message": &l}));
                }
                tail.push_back(l);
                if tail.len() > 20 {
                    tail.pop_front();
                }
            }
            tail.into_iter().collect::<Vec<_>>().join("\n")
        });

        let (cancel_tx, mut cancel_rx) = mpsc::unbounded_channel::<()>();
        self.cancels.lock().unwrap().insert(p.job_id.clone(), cancel_tx);

        let deadline = tokio::time::sleep(Duration::from_secs(p.timeout_s.max(1)));
        tokio::pin!(deadline);
        let mut outcome: Option<Outcome> = None;
        let mut cancel_requested = false;
        let mut kill_at: Option<Instant> = None;

        loop {
            let grace = async move {
                match kill_at {
                    Some(t) => tokio::time::sleep_until(t).await,
                    None => std::future::pending::<()>().await,
                }
            };
            tokio::select! {
                line = stdout.next_line() => match line {
                    Ok(Some(l)) => {
                        if let Some(o) = self.handle_event(p, &workdir, &l, &mut stdin).await {
                            outcome = Some(o);
                        }
                    }
                    _ => break,
                },
                Some(()) = cancel_rx.recv(), if !cancel_requested => {
                    cancel_requested = true;
                    let _ = stdin.write_all(b"{\"cmd\":\"cancel\"}\n").await;
                    kill_at = Some(Instant::now() + self.cfg.cancel_grace);
                }
                _ = &mut deadline => {
                    let _ = child.start_kill();
                    outcome = Some(("failed".into(), None, Some(json!({
                        "kind": "timeout", "code": "TIMEOUT",
                        "message": format!("Quá thời gian cho phép ({} giây)", p.timeout_s),
                    }))));
                    break;
                }
                _ = grace => {
                    let _ = child.start_kill();
                    outcome = Some(("cancelled".into(), None, Some(json!({
                        "kind": "cancelled", "code": "CANCELLED", "message": "Đã hủy (dừng cưỡng bức)",
                    }))));
                    break;
                }
            }
        }

        drop(stdin);
        let _ = tokio::time::timeout(Duration::from_secs(10), child.wait()).await;
        let _ = child.start_kill();
        let tail = stderr_task.await.unwrap_or_default();
        outcome.unwrap_or_else(|| {
            crash("WORKER_CRASHED", if tail.is_empty() { "Worker dừng mà không trả kết quả".into() } else { tail })
        })
    }

    /// Chạy một chuỗi: mỗi bước là một job con (qua đúng `submit` → validate, xếp hàng theo RAM, worker riêng).
    /// Output của bước trước nối vào input bước sau; tiến độ và lệnh hủy của chuỗi truyền xuống bước đang chạy.
    async fn execute_chain(self: &Arc<Self>, p: &Pending, chain: &ChainDef) -> Outcome {
        let fail = |code: &str, msg: String| -> Outcome { ("failed".into(), None, Some(json!({"kind": "tool", "code": code, "message": msg}))) };
        let _ = self.store.mark_running(&p.job_id);
        self.send(&p.job_id, json!({"event": "status", "status": "running"}));
        let (cancel_tx, mut cancel_rx) = mpsc::unbounded_channel::<()>();
        self.cancels.lock().unwrap().insert(p.job_id.clone(), cancel_tx);

        // giá trị đã có: "$input.<tên>" và "$<bước>.<output>" → asset ref (hoặc mảng)
        let mut values: HashMap<String, Value> = HashMap::new();
        if let Some(o) = p.inputs.as_object() {
            for (k, v) in o {
                values.insert(format!("$input.{k}"), v.clone());
            }
        }
        let chain_params = with_defaults(chain.params.as_ref(), &p.params);
        let n = chain.steps.len();
        let mut steps_done = Vec::new();
        let mut last_summary = Value::Null;
        let mut warnings: Vec<Value> = Vec::new();
        for (i, step) in chain.steps.iter().enumerate() {
            let label = if step.title.is_empty() { step.tool.clone() } else { step.title.clone() };
            // input: tham chiếu → asset id
            let mut inputs = Map::new();
            for (k, v) in &step.inputs {
                let refs: Vec<&Value> = match v.as_array() {
                    Some(a) => a.iter().collect(),
                    None => vec![v],
                };
                let mut ids = Vec::new();
                for r in refs {
                    let key = r.as_str().unwrap_or("");
                    match values.get(key) {
                        Some(Value::Array(a)) => ids.extend(a.iter().filter_map(|x| x["asset_id"].as_str().map(String::from))),
                        Some(x) => ids.extend(x["asset_id"].as_str().map(String::from)),
                        None if key.starts_with('$') => {}
                        None => ids.push(key.to_string()), // asset id cố định
                    }
                }
                let val = if v.is_array() { json!(ids) } else { ids.into_iter().next().map(Value::String).unwrap_or(Value::Null) };
                if !val.is_null() {
                    inputs.insert(k.clone(), val);
                }
            }
            let params = subst_params(&Value::Object(step.params.clone()), &chain_params);
            let sub = match self.submit(&step.tool, &Value::Object(inputs), &params) {
                Ok(j) => j,
                Err(e) => {
                    let why = if e.details.is_empty() { e.message } else { format!("{} ({})", e.message, e.details.iter().filter_map(|d| d["message"].as_str()).collect::<Vec<_>>().join("; ")) };
                    return fail("CHAIN_STEP_REJECTED", format!("Bước {}/{n} \"{label}\": {why}", i + 1));
                }
            };
            // chờ job con, chuyển tiếp tiến độ và lệnh hủy
            let job = loop {
                tokio::time::sleep(Duration::from_millis(300)).await;
                if cancel_rx.try_recv().is_ok() {
                    self.cancel(&sub.id);
                }
                let Ok(Some(j)) = self.store.get_job(&sub.id) else { continue };
                let frac = (i as f64 + j.progress.clamp(0.0, 1.0)) / n as f64;
                let msg = format!("Bước {}/{n}: {label}{}", i + 1, if j.message.is_empty() { String::new() } else { format!(" — {}", j.message) });
                let _ = self.store.update_progress(&p.job_id, frac, &msg);
                self.send(&p.job_id, json!({"event": "progress", "value": frac, "message": msg}));
                if matches!(j.status.as_str(), "succeeded" | "failed" | "cancelled") {
                    break j;
                }
            };
            match job.status.as_str() {
                "succeeded" => {
                    let result = job.result.unwrap_or(Value::Null);
                    if let Some(o) = result["outputs"].as_object() {
                        for (k, v) in o {
                            values.insert(format!("${}.{k}", step.id), v.clone());
                        }
                    }
                    if let Some(w) = result["warnings"].as_array() {
                        warnings.extend(w.iter().cloned());
                    }
                    last_summary = result["summary"].clone();
                    steps_done.push(json!({"step": &step.id, "tool": &step.tool, "job_id": &sub.id, "summary": result["summary"]}));
                }
                "cancelled" => return ("cancelled".into(), None, Some(json!({"kind": "cancelled", "code": "CANCELLED", "message": format!("Đã hủy ở bước {}/{n}", i + 1)}))),
                _ => {
                    let why = job.error.as_ref().and_then(|e| e["message"].as_str()).unwrap_or("lỗi không rõ").to_string();
                    return fail("CHAIN_STEP_FAILED", format!("Bước {}/{n} \"{label}\" lỗi: {why}", i + 1));
                }
            }
        }
        let mut outputs = Map::new();
        for (name, o) in &chain.outputs {
            match values.get(&o.from) {
                Some(v) => {
                    outputs.insert(name.clone(), v.clone());
                }
                None => return fail("CHAIN_BAD_OUTPUT", format!("Output '{name}' trỏ tới '{}' nhưng bước đó không trả", o.from)),
            }
        }
        let summary = if last_summary.is_null() { json!(format!("Hoàn tất {n} bước")) } else { last_summary };
        ("succeeded".into(), Some(json!({"summary": summary, "warnings": warnings, "outputs": outputs, "steps": steps_done})), None)
    }

    async fn handle_event(&self, p: &Pending, workdir: &Path, line: &str, stdin: &mut ChildStdin) -> Option<Outcome> {
        let Ok(ev) = serde_json::from_str::<Value>(line) else {
            tracing::debug!(job = %p.job_id, "dòng không phải JSON: {line}");
            return None;
        };
        match ev["event"].as_str() {
            Some("progress") => {
                let v = ev["value"].as_f64().unwrap_or(0.0);
                let _ = self.store.update_progress(&p.job_id, v, ev["message"].as_str().unwrap_or(""));
                self.send(&p.job_id, ev);
                None
            }
            Some("log") => {
                self.send(&p.job_id, ev);
                None
            }
            Some("model_request") => {
                // model khai báo trong [[models]] của tool: tải (lần đầu) + kiểm sha256, rồi trả đường dẫn
                let id = ev["id"].as_str().unwrap_or("").to_string();
                let spec = {
                    let reg = self.registry.read().unwrap();
                    reg.tool(&p.tool_id).and_then(|e| e.manifest.as_ref()).and_then(|m| m.models.iter().find(|m| m.id == id).cloned())
                };
                let reply = match spec {
                    None => json!({ "error": format!("Tool không khai báo model '{id}' trong [[models]]") }),
                    Some(spec) => {
                        let dir = self.store.models_dir();
                        let (job_id, store) = (p.job_id.clone(), self.store.clone());
                        let tx = self.channels.lock().unwrap().get(&p.job_id).cloned();
                        let res = tokio::task::spawn_blocking(move || {
                            models::ensure(&dir, &spec, |frac, msg| {
                                let _ = store.update_progress(&job_id, 0.0, msg);
                                if let Some(tx) = &tx {
                                    let _ = tx.send(json!({"event": "progress", "value": 0.0, "message": msg, "download": frac}));
                                }
                            })
                        })
                        .await
                        .unwrap_or_else(|e| Err(e.to_string()));
                        match res {
                            Ok(path) => json!({ "model_path": path }),
                            Err(e) => json!({ "error": e }),
                        }
                    }
                };
                let _ = stdin.write_all(format!("{reply}\n").as_bytes()).await;
                None
            }
            Some("result") => match self.register_outputs(p, workdir, &ev["outputs"]) {
                Ok(outputs) => Some((
                    "succeeded".into(),
                    Some(json!({
                        "summary": ev["summary"], "warnings": ev["warnings"],
                        "outputs": outputs, "peak_ram_mb": ev["peak_ram_mb"],
                    })),
                    None,
                )),
                Err(e) => Some(("failed".into(), None, Some(json!({"kind": "tool", "code": "BAD_OUTPUTS", "message": e})))),
            },
            Some("error") => {
                let status = if ev["kind"] == "cancelled" { "cancelled" } else { "failed" };
                let mut err = ev.clone();
                if let Some(o) = err.as_object_mut() {
                    o.remove("event");
                }
                Some((status.into(), None, Some(err)))
            }
            _ => None,
        }
    }

    fn register_outputs(&self, p: &Pending, workdir: &Path, outputs: &Value) -> Result<Value, String> {
        let _ = &p.chain;
        let wd = workdir.canonicalize().map_err(|e| e.to_string())?;
        let lineage = json!({
            "tool_id": &p.tool_id, "tool_version": &p.tool_version, "job_id": &p.job_id,
            "params": &p.params, "inputs": &p.input_ids,
        });
        let obj = outputs.as_object().ok_or("outputs không hợp lệ")?;
        let mut out = Map::new();
        for (name, v) in obj {
            out.insert(name.clone(), self.register_one(v, &wd, &lineage)?);
        }
        Ok(Value::Object(out))
    }

    fn register_one(&self, v: &Value, wd: &Path, lineage: &Value) -> Result<Value, String> {
        if let Some(arr) = v.as_array() {
            return arr
                .iter()
                .map(|x| self.register_one(x, wd, lineage))
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Array);
        }
        if let (Some(fmt), Some(path)) = (v["format"].as_str(), v["path"].as_str()) {
            let pb = PathBuf::from(path).canonicalize().map_err(|e| format!("output {path}: {e}"))?;
            if !pb.starts_with(wd) {
                return Err(format!("output nằm ngoài workdir của job: {path}"));
            }
            let a = self
                .store
                .insert_asset(fmt, &pb, Some(lineage.clone()), json!({}))
                .map_err(|e| e.to_string())?;
            return Ok(json!({"asset_id": a.id, "format": a.format, "filename": a.filename, "size_bytes": a.size_bytes}));
        }
        Ok(v.clone())
    }
}

/// Tham số của chuỗi + giá trị `default` trong schema cho tham số người dùng không đặt.
fn with_defaults(schema: Option<&Value>, params: &Value) -> Value {
    let mut out = params.as_object().cloned().unwrap_or_default();
    if let Some(props) = schema.and_then(|s| s["properties"].as_object()) {
        for (k, prop) in props {
            if let (false, Some(d)) = (out.contains_key(k), prop.get("default")) {
                out.insert(k.clone(), d.clone());
            }
        }
    }
    Value::Object(out)
}

/// Thay `"$param.<tên>"` trong tham số của bước bằng tham số của chuỗi (đệ quy trong object/mảng).
fn subst_params(v: &Value, chain_params: &Value) -> Value {
    match v {
        Value::String(s) if s.starts_with("$param.") => chain_params.get(&s["$param.".len()..]).cloned().unwrap_or(Value::Null),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| (k.clone(), subst_params(x, chain_params)))
                .filter(|(_, x)| !x.is_null())
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(|x| subst_params(x, chain_params)).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
mod chain_tests {
    use super::*;

    #[test]
    fn params_substitute() {
        let step = json!({"style": "$param.style", "fixed": 3, "nested": {"a": "$param.missing", "b": ["$param.style"]}});
        let out = subst_params(&step, &json!({"style": "tiktok"}));
        assert_eq!(out, json!({"style": "tiktok", "fixed": 3, "nested": {"b": ["tiktok"]}}));
    }

    #[test]
    fn schema_defaults_fill_missing_params() {
        let schema = json!({"properties": {"max_chars": {"type": "integer", "default": 18}, "style": {"default": "tiktok"}}});
        let p = with_defaults(Some(&schema), &json!({"style": "karaoke"}));
        assert_eq!(p, json!({"style": "karaoke", "max_chars": 18}));
    }
}

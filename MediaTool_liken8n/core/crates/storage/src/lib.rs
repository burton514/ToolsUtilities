//! Lưu asset (kèm lineage) và job trong SQLite. File thật nằm trong thư mục data.
//! Sau này thay bằng Postgres/S3 qua cùng API này.

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
pub struct Asset {
    pub id: String,
    pub format: String,
    pub filename: String,
    #[serde(skip)]
    pub path: PathBuf,
    pub size_bytes: u64,
    pub created_at: String,
    pub lineage: Option<Value>,
    pub meta: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct Job {
    pub id: String,
    pub tool_id: String,
    pub status: String,
    pub inputs: Value,
    pub params: Value,
    pub progress: f64,
    pub message: String,
    pub result: Option<Value>,
    pub error: Option<Value>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

pub struct Store {
    conn: Mutex<Connection>,
    data_dir: PathBuf,
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn new_id(prefix: &str) -> String {
    let u = uuid::Uuid::new_v4().simple().to_string();
    format!("{prefix}_{}", &u[..16])
}

impl Store {
    pub fn open(data_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(data_dir)?;
        let data_dir = data_dir.canonicalize()?;
        for sub in ["assets", "jobs", "models"] {
            std::fs::create_dir_all(data_dir.join(sub))?;
        }
        let conn = Connection::open(data_dir.join("mediatool.db")).context("mở SQLite")?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY, format TEXT NOT NULL, filename TEXT NOT NULL, path TEXT NOT NULL,
                size_bytes INTEGER NOT NULL, created_at TEXT NOT NULL, lineage TEXT, meta TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY, tool_id TEXT NOT NULL, status TEXT NOT NULL, inputs TEXT NOT NULL,
                params TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '',
                result TEXT, error TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
            );
            CREATE INDEX IF NOT EXISTS jobs_created ON jobs(created_at);
            "#,
        )?;
        // job đang chạy dở khi core tắt → đánh dấu thất bại
        conn.execute(
            "UPDATE jobs SET status='failed', error=?1, finished_at=?2 WHERE status IN ('queued','running')",
            params![r#"{"kind":"crash","code":"CORE_RESTARTED","message":"Core khởi động lại khi job chưa xong"}"#, now()],
        )?;
        Ok(Self { conn: Mutex::new(conn), data_dir })
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }
    pub fn assets_dir(&self) -> PathBuf {
        self.data_dir.join("assets")
    }
    pub fn jobs_dir(&self) -> PathBuf {
        self.data_dir.join("jobs")
    }
    pub fn models_dir(&self) -> PathBuf {
        self.data_dir.join("models")
    }

    // ---------------------------------------------------------------- assets

    pub fn insert_asset(&self, format: &str, path: &Path, lineage: Option<Value>, meta: Value) -> Result<Asset> {
        let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let asset = Asset {
            id: new_id("a"),
            format: format.to_string(),
            filename: path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
            path: path.to_path_buf(),
            size_bytes: size,
            created_at: now(),
            lineage,
            meta,
        };
        self.conn.lock().unwrap().execute(
            "INSERT INTO assets (id, format, filename, path, size_bytes, created_at, lineage, meta)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                asset.id,
                asset.format,
                asset.filename,
                asset.path.to_string_lossy(),
                asset.size_bytes as i64,
                asset.created_at,
                asset.lineage.as_ref().map(|v| v.to_string()),
                asset.meta.to_string()
            ],
        )?;
        Ok(asset)
    }

    pub fn get_asset(&self, id: &str) -> Result<Option<Asset>> {
        let conn = self.conn.lock().unwrap();
        Ok(conn
            .query_row("SELECT * FROM assets WHERE id = ?1", params![id], row_asset)
            .optional()?)
    }

    pub fn list_assets(&self, limit: usize) -> Result<Vec<Asset>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare("SELECT * FROM assets ORDER BY created_at DESC LIMIT ?1")?;
        let rows = st.query_map(params![limit as i64], row_asset)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    // ---------------------------------------------------------------- jobs

    pub fn insert_job(&self, tool_id: &str, inputs: &Value, params_v: &Value) -> Result<Job> {
        let job = Job {
            id: new_id("j"),
            tool_id: tool_id.to_string(),
            status: "queued".into(),
            inputs: inputs.clone(),
            params: params_v.clone(),
            progress: 0.0,
            message: String::new(),
            result: None,
            error: None,
            created_at: now(),
            started_at: None,
            finished_at: None,
        };
        self.conn.lock().unwrap().execute(
            "INSERT INTO jobs (id, tool_id, status, inputs, params, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![job.id, job.tool_id, job.status, job.inputs.to_string(), job.params.to_string(), job.created_at],
        )?;
        Ok(job)
    }

    pub fn mark_running(&self, id: &str) -> Result<()> {
        self.conn
            .lock()
            .unwrap()
            .execute("UPDATE jobs SET status='running', started_at=?2 WHERE id=?1", params![id, now()])?;
        Ok(())
    }

    pub fn update_progress(&self, id: &str, progress: f64, message: &str) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE jobs SET progress=?2, message=CASE WHEN ?3 = '' THEN message ELSE ?3 END WHERE id=?1",
            params![id, progress, message],
        )?;
        Ok(())
    }

    pub fn finish(&self, id: &str, status: &str, result: Option<&Value>, error: Option<&Value>) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE jobs SET status=?2, result=?3, error=?4, finished_at=?5,
                    progress = CASE WHEN ?2 = 'succeeded' THEN 1.0 ELSE progress END WHERE id=?1",
            params![id, status, result.map(|v| v.to_string()), error.map(|v| v.to_string()), now()],
        )?;
        Ok(())
    }

    pub fn get_job(&self, id: &str) -> Result<Option<Job>> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row("SELECT * FROM jobs WHERE id = ?1", params![id], row_job).optional()?)
    }

    pub fn list_jobs(&self, limit: usize) -> Result<Vec<Job>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?1")?;
        let rows = st.query_map(params![limit as i64], row_job)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }
}

fn json_col(row: &Row, name: &str) -> rusqlite::Result<Option<Value>> {
    let s: Option<String> = row.get(name)?;
    Ok(s.and_then(|s| serde_json::from_str(&s).ok()))
}

fn row_asset(row: &Row) -> rusqlite::Result<Asset> {
    let path: String = row.get("path")?;
    Ok(Asset {
        id: row.get("id")?,
        format: row.get("format")?,
        filename: row.get("filename")?,
        path: PathBuf::from(path),
        size_bytes: row.get::<_, i64>("size_bytes")? as u64,
        created_at: row.get("created_at")?,
        lineage: json_col(row, "lineage")?,
        meta: json_col(row, "meta")?.unwrap_or(Value::Null),
    })
}

fn row_job(row: &Row) -> rusqlite::Result<Job> {
    Ok(Job {
        id: row.get("id")?,
        tool_id: row.get("tool_id")?,
        status: row.get("status")?,
        inputs: json_col(row, "inputs")?.unwrap_or(Value::Null),
        params: json_col(row, "params")?.unwrap_or(Value::Null),
        progress: row.get("progress")?,
        message: row.get("message")?,
        result: json_col(row, "result")?,
        error: json_col(row, "error")?,
        created_at: row.get("created_at")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
    })
}

/// Đoán format từ đuôi file (giống mediatool_sdk.assets.guess_format).
pub fn guess_format(filename: &str) -> &'static str {
    let ext = Path::new(filename)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "mp4" | "mkv" | "mov" | "webm" | "avi" | "m4v" | "flv" | "3gp" | "ts" => "video",
        "mp3" | "wav" | "m4a" | "aac" | "flac" | "ogg" | "opus" | "wma" | "aiff" => "audio",
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" => "image",
        "srt" | "ass" | "ssa" | "vtt" | "lrc" => "subtitle",
        "txt" | "md" => "text",
        "ttf" | "otf" | "woff" | "woff2" => "font",
        "cube" => "lut",
        "json" => "json",
        _ => "file",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let dir = std::env::temp_dir().join(new_id("mtstore"));
        let s = Store::open(&dir).unwrap();
        let f = dir.join("x.wav");
        std::fs::write(&f, b"abc").unwrap();
        let a = s.insert_asset("audio", &f, None, serde_json::json!({})).unwrap();
        assert_eq!(s.get_asset(&a.id).unwrap().unwrap().size_bytes, 3);
        let j = s.insert_job("media_probe", &serde_json::json!({}), &serde_json::json!({})).unwrap();
        s.finish(&j.id, "succeeded", Some(&serde_json::json!({"ok":true})), None).unwrap();
        assert_eq!(s.get_job(&j.id).unwrap().unwrap().status, "succeeded");
        assert_eq!(guess_format("A.MP4"), "video");
    }
}

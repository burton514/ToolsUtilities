//! Tải model AI theo `[[models]]` trong manifest của tool — một nơi duy nhất cho mọi tool.
//!
//! - Model một file (`url`, `sha256`) hoặc nhiều file (`files = [{ path, url, sha256 }]`, ví dụ model CTranslate2).
//! - **Mọi file phải có sha256**; tải xong kiểm tra mã băm, sai thì xóa và báo lỗi (không bao giờ dùng file chưa kiểm).
//! - Lưu ở `<data>/models/<id>/`, tải vào `.part` rồi đổi tên; đánh dấu `.verified` khi đủ file đã kiểm.
//! - Hai job cần cùng một model thì job sau chờ job trước tải xong, không tải trùng.

use mediatool_registry::ModelSpec;
use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

static DOWNLOADING: Mutex<Option<HashSet<String>>> = Mutex::new(None);

struct Busy(String);
impl Drop for Busy {
    fn drop(&mut self) {
        if let Some(s) = DOWNLOADING.lock().unwrap().as_mut() {
            s.remove(&self.0);
        }
    }
}

/// Danh sách (tên file, url, sha256) của model.
fn files(spec: &ModelSpec) -> Vec<(String, String, String)> {
    if !spec.files.is_empty() {
        return spec.files.iter().map(|f| (f.path.clone(), f.url.clone(), f.sha256.clone())).collect();
    }
    let name = if spec.file.is_empty() {
        spec.url.rsplit('/').next().unwrap_or("model.bin").split('?').next().unwrap_or("model.bin").to_string()
    } else {
        spec.file.clone()
    };
    vec![(name, spec.url.clone(), spec.sha256.clone())]
}

/// Model đã tải đủ + kiểm sha256 chưa (chỉ đọc đĩa, không tải) — cho trang sức khỏe hệ thống.
pub fn is_ready(models_dir: &Path, spec: &ModelSpec) -> bool {
    let dir = models_dir.join(&spec.id);
    dir.join(".verified").is_file() && files(spec).iter().all(|(p, _, _)| dir.join(p).is_file())
}

/// Đường dẫn model đã sẵn sàng (file với model một file, thư mục với model nhiều file); tải nếu chưa có.
/// `progress(phần đã xong 0..1, thông báo)`.
pub fn ensure(models_dir: &Path, spec: &ModelSpec, mut progress: impl FnMut(f64, &str)) -> Result<PathBuf, String> {
    let id = spec.id.as_str();
    if id.is_empty() || id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err(format!("id model không hợp lệ: '{id}'"));
    }
    let dir = models_dir.join(id);
    let list = files(spec);
    let target = if spec.files.is_empty() { dir.join(&list[0].0) } else { dir.clone() };
    let marker = dir.join(".verified");
    if marker.is_file() && list.iter().all(|(p, _, _)| dir.join(p).is_file()) {
        return Ok(target);
    }
    // chờ nếu job khác đang tải đúng model này
    loop {
        let mut g = DOWNLOADING.lock().unwrap();
        let set = g.get_or_insert_with(HashSet::new);
        if !set.contains(id) {
            set.insert(id.to_string());
            break;
        }
        drop(g);
        progress(0.0, &format!("Đang chờ tải xong model {id}"));
        std::thread::sleep(Duration::from_millis(500));
        if marker.is_file() {
            return Ok(target);
        }
    }
    let _busy = Busy(id.to_string());
    std::fs::create_dir_all(&dir).map_err(|e| format!("Không tạo được {}: {e}", dir.display()))?;
    for (p, url, sha) in &list {
        // file có thể nằm trong thư mục con (onnx/x.onnx) nhưng không được thoát ra ngoài thư mục model
        let bad = p.is_empty() || p.starts_with('/') || p.contains('\\') || p.split('/').any(|s| s.is_empty() || s == "." || s == "..");
        if bad {
            return Err(format!("Model '{id}': đường dẫn file không hợp lệ '{p}'"));
        }
        if url.is_empty() || sha.len() != 64 {
            return Err(format!("Model '{id}' khai báo thiếu url hoặc sha256 cho '{p}' — không tải file chưa kiểm được"));
        }
    }
    let total_mb = if spec.size_mb > 0.0 { spec.size_mb } else { 0.0 };
    let n = list.len();
    for (i, (p, url, sha)) in list.iter().enumerate() {
        let dest = dir.join(p);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        if dest.is_file() && sha256_file(&dest).as_deref() == Ok(sha.as_str()) {
            continue;
        }
        download(url, &dest, sha, |done, size| {
            let frac = if size > 0 { done as f64 / size as f64 } else { 0.0 };
            let mb = done as f64 / 1_048_576.0;
            let of = if size > 0 { format!(" / {:.0} MB", size as f64 / 1_048_576.0) } else if total_mb > 0.0 { format!(" / ~{total_mb:.0} MB") } else { String::new() };
            progress((i as f64 + frac) / n as f64, &format!("Đang tải model {id} (lần đầu): {mb:.0} MB{of}"));
        })
        .map_err(|e| format!("Tải model '{id}' ({p}) lỗi: {e}"))?;
    }
    std::fs::write(&marker, b"ok").map_err(|e| e.to_string())?;
    progress(1.0, &format!("Đã có model {id}"));
    Ok(target)
}

fn sha256_file(p: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut f = std::fs::File::open(p).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex(&h.finalize()))
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn download(url: &str, dest: &Path, sha: &str, mut progress: impl FnMut(u64, u64)) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(20)).timeout_read(Duration::from_secs(60)).build();
    let resp = agent.get(url).call().map_err(|e| e.to_string())?;
    let size: u64 = resp.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut part = dest.as_os_str().to_owned();
    part.push(".part"); // a.onnx → a.onnx.part (không đụng file cùng tên khác đuôi)
    let part = std::path::PathBuf::from(part);
    let mut out = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut reader = resp.into_reader();
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    let (mut done, mut last) = (0u64, Instant::now());
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        h.update(&buf[..n]);
        done += n as u64;
        if last.elapsed() > Duration::from_millis(400) {
            progress(done, size);
            last = Instant::now();
        }
    }
    out.flush().map_err(|e| e.to_string())?;
    drop(out);
    let got = hex(&h.finalize());
    if got != sha {
        let _ = std::fs::remove_file(&part);
        return Err(format!("sai mã băm (sha256 {got}, cần {sha}) — file tải về không đúng, đã xóa"));
    }
    std::fs::rename(&part, dest).map_err(|e| e.to_string())?;
    progress(done, size);
    Ok(())
}

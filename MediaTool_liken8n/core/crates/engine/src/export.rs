//! Xuất video song song theo đoạn.
//!
//! 1. Chia video thành các đoạn ngắn (vài giây). Nhiều luồng làm cùng lúc: mỗi luồng giữ một `Renderer` riêng
//!    (decoder FFmpeg + cache chữ + surface Skia), render tuần tự trong đoạn (giải mã liền mạch, không seek) và
//!    đẩy khung BGRA vào một tiến trình FFmpeg mã hóa riêng cho đoạn đó.
//! 2. Mỗi đoạn là một file trong cache, khóa bằng mã băm của mọi thứ ảnh hưởng tới đoạn (các lớp đè lên đoạn, file
//!    nguồn, thư viện hiệu ứng, kích thước, chất lượng, bộ mã hóa). Xuất lại sau khi sửa chỉ render những đoạn đổi;
//!    xuất bị dừng giữa chừng thì lần sau làm tiếp các đoạn còn thiếu.
//! 3. Ghép các đoạn bằng FFmpeg concat **không mã hóa lại** (copy luồng), rồi trộn tiếng như trước
//!    (atrim/adelay/volume/amix — FFmpeg native).
//!
//! Bộ mã hóa: tự dò bộ mã hóa phần cứng có thật trên máy (NVENC → QSV → AMF → VideoToolbox), không có thì libx264.

use crate::media::has_audio;
use crate::model::{Composition, LayerKind};
use crate::render::Renderer;
use anyhow::{anyhow, Context, Result};
use std::collections::VecDeque;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Quality {
    Draft,
    Standard,
    High,
}

impl Quality {
    pub fn parse(s: &str) -> Self {
        match s {
            "draft" => Quality::Draft,
            "high" => Quality::High,
            _ => Quality::Standard,
        }
    }
    fn idx(self) -> usize {
        match self {
            Quality::Draft => 0,
            Quality::Standard => 1,
            Quality::High => 2,
        }
    }
}

/// atempo của FFmpeg chỉ nhận 0.5..2 mỗi tầng ở bản cũ → tách thành nhiều tầng.
pub fn atempo_chain(speed: f64) -> Vec<String> {
    let mut out = Vec::new();
    let mut s = speed;
    if (s - 1.0).abs() < 1e-3 {
        return out;
    }
    while s > 2.0 {
        out.push("atempo=2.0".into());
        s /= 2.0;
    }
    while s < 0.5 {
        out.push("atempo=0.5".into());
        s /= 0.5;
    }
    out.push(format!("atempo={s:.4}"));
    out
}

pub struct ExportOptions {
    pub quality: Quality,
    pub ffmpeg: String,
    /// số luồng render (None = tự tính theo số lõi và RAM; biến môi trường `MEDIATOOL_RENDER_THREADS`)
    pub threads: Option<usize>,
    /// thư mục cache đoạn (None = `MEDIATOOL_CACHE_DIR` hoặc `$MEDIATOOL_DATA/cache/export`; không có thì thư mục tạm)
    pub cache_dir: Option<PathBuf>,
    /// bộ mã hóa: None/"auto" = tự dò; hoặc tên cụ thể (libx264, h264_nvenc…); biến môi trường `MEDIATOOL_ENCODER`
    pub encoder: Option<String>,
}

impl ExportOptions {
    pub fn new(quality: Quality, ffmpeg: impl Into<String>) -> Self {
        Self { quality, ffmpeg: ffmpeg.into(), threads: None, cache_dir: None, encoder: None }
    }
}

// ------------------------------------------------------------------ bộ mã hóa

#[derive(Debug, Clone)]
pub struct Encoder {
    pub name: String,
    hardware: bool,
}

impl Encoder {
    /// Tham số chất lượng theo bộ mã hóa (nháp / chuẩn / cao) + số luồng x264 cho mỗi đoạn.
    fn args(&self, q: Quality, x264_threads: usize) -> Vec<String> {
        let i = q.idx();
        let v = |a: [&str; 3]| a[i].to_string();
        let s = |x: &str| x.to_string();
        match self.name.as_str() {
            "h264_nvenc" => vec![s("-preset"), v(["p1", "p4", "p6"]), s("-rc"), s("vbr"), s("-cq"), v(["30", "23", "19"]), s("-b:v"), s("0"), s("-pix_fmt"), s("yuv420p")],
            "h264_qsv" => vec![s("-preset"), v(["veryfast", "medium", "slow"]), s("-global_quality"), v(["30", "23", "19"]), s("-pix_fmt"), s("nv12")],
            "h264_amf" => vec![s("-quality"), v(["speed", "balanced", "quality"]), s("-rc"), s("cqp"), s("-qp_i"), v(["30", "22", "18"]), s("-qp_p"), v(["32", "24", "20"]), s("-pix_fmt"), s("yuv420p")],
            "h264_videotoolbox" => vec![s("-q:v"), v(["45", "62", "75"]), s("-pix_fmt"), s("yuv420p")],
            _ => vec![
                s("-preset"), v(["ultrafast", "veryfast", "slow"]), s("-crf"), v(["28", "21", "17"]),
                s("-threads"), x264_threads.to_string(), s("-pix_fmt"), s("yuv420p"),
            ],
        }
    }
}

/// Dò bộ mã hóa một lần cho cả tiến trình: thử mã hóa 0,1 giây bằng từng bộ phần cứng, bộ nào chạy được thì dùng.
pub fn pick_encoder(ffmpeg: &str, wanted: Option<&str>) -> Encoder {
    static AUTO: OnceLock<Encoder> = OnceLock::new();
    let env = std::env::var("MEDIATOOL_ENCODER").ok();
    match wanted.map(str::to_string).or(env).as_deref() {
        Some(name) if name != "auto" && !name.is_empty() => {
            return Encoder { name: name.to_string(), hardware: name != "libx264" && name != "libopenh264" };
        }
        _ => {}
    }
    AUTO.get_or_init(|| {
        for name in ["h264_nvenc", "h264_qsv", "h264_amf", "h264_videotoolbox"] {
            let ok = Command::new(ffmpeg)
                .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=black:s=256x256:d=0.1", "-c:v", name, "-f", "null", "-"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|s| s.success());
            if ok {
                return Encoder { name: name.into(), hardware: true };
            }
        }
        Encoder { name: "libx264".into(), hardware: false }
    })
    .clone()
}

// ------------------------------------------------------------------ chia việc

fn cores() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4)
}

/// Số luồng render: theo số lõi (chừa chỗ cho FFmpeg mã hóa) và ngân sách RAM (~300 MB mỗi luồng).
fn worker_count(opts: &ExportOptions, enc: &Encoder) -> usize {
    if let Some(n) = opts.threads.or_else(|| std::env::var("MEDIATOOL_RENDER_THREADS").ok().and_then(|v| v.parse().ok())) {
        return n.max(1);
    }
    let ram_mb: usize = std::env::var("MEDIATOOL_EXPORT_RAM_MB").ok().and_then(|v| v.parse().ok()).unwrap_or(2400);
    let mut n = (cores() * 2 / 3).clamp(1, 8).min((ram_mb / 300).max(1));
    if enc.hardware {
        n = n.min(3); // bộ mã hóa phần cứng có giới hạn số phiên cùng lúc
    }
    n
}

/// FNV-1a 64 bit — ổn định giữa các lần chạy/phiên bản (khác DefaultHasher), dùng làm khóa cache.
struct Fnv(u64);
impl Fnv {
    fn new() -> Self {
        Fnv(0xcbf29ce484222325)
    }
    fn add(&mut self, bytes: &[u8]) -> &mut Self {
        for b in bytes {
            self.0 ^= *b as u64;
            self.0 = self.0.wrapping_mul(0x100000001b3);
        }
        self
    }
}

fn cache_dir(opts: &ExportOptions) -> (PathBuf, bool) {
    if let Some(d) = &opts.cache_dir {
        return (d.clone(), true);
    }
    if let Some(d) = std::env::var_os("MEDIATOOL_CACHE_DIR") {
        return (PathBuf::from(d).join("export"), true);
    }
    if let Some(d) = std::env::var_os("MEDIATOOL_DATA") {
        return (PathBuf::from(d).join("cache").join("export"), true);
    }
    (std::env::temp_dir().join(format!("mediatool-export-{}", std::process::id())), false)
}

/// Dọn cache đoạn: bỏ file quá 7 ngày, và bỏ file cũ nhất khi tổng vượt 4 GB.
fn prune(dir: &Path) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let now = SystemTime::now();
    let mut files: Vec<(SystemTime, u64, PathBuf)> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            Some((m.modified().unwrap_or(now), m.len(), e.path()))
        })
        .collect();
    files.retain(|(t, _, p)| {
        let old = now.duration_since(*t).unwrap_or_default() > Duration::from_secs(7 * 86400);
        if old {
            let _ = std::fs::remove_file(p);
        }
        !old
    });
    files.sort_by_key(|f| f.0);
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    for (_, len, p) in files {
        if total <= 4 << 30 {
            break;
        }
        let _ = std::fs::remove_file(&p);
        total -= len;
    }
}

struct Chunk {
    idx: usize,
    from: u64,
    to: u64,
    path: PathBuf,
    cached: bool,
}

/// Khóa của một đoạn: mọi thứ có thể làm điểm ảnh trong đoạn khác đi.
fn chunk_key(comp: &Composition, t0: f64, t1: f64, head: &[u8], lib_fp: u64) -> u64 {
    let mut h = Fnv::new();
    h.add(head).add(&lib_fp.to_le_bytes()).add(comp.canvas.background.as_bytes());
    for l in comp.layers.iter().filter(|l| !l.hidden && l.start < t1 && l.end() > t0 && !matches!(l.kind, LayerKind::Audio { .. })) {
        h.add(serde_json::to_string(l).unwrap_or_default().as_bytes());
        if let LayerKind::Video { source, .. } | LayerKind::Image { source, .. } = &l.kind {
            if let Ok(m) = std::fs::metadata(source) {
                h.add(&m.len().to_le_bytes());
                if let Ok(t) = m.modified().and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).map_err(std::io::Error::other)) {
                    h.add(&t.as_nanos().to_le_bytes());
                }
            }
        }
    }
    h.0
}

// ------------------------------------------------------------------ xuất

pub fn export(
    comp: &Composition,
    out: &Path,
    opts: &ExportOptions,
    mut progress: impl FnMut(f64, &str),
    cancel: &AtomicBool,
) -> Result<()> {
    // giải mốc thời gian / chuẩn hóa một lần cho cả video (dùng chung với xem trước)
    let prepared = comp.prepare();
    let comp = &prepared;
    let duration = comp.end();
    if duration <= 0.0 {
        return Err(anyhow!("Bản dựng trống"));
    }
    let fps = comp.canvas.fps.clamp(1.0, 120.0);
    // nháp: cạnh ngắn tối đa 540 px — không bao giờ phóng to video vốn đã nhỏ hơn
    let width = match opts.quality {
        Quality::Draft => (comp.canvas.width as f64 * (540.0 / comp.canvas.height.min(comp.canvas.width) as f64).min(1.0)) as u32,
        _ => comp.canvas.width,
    } & !1;
    let height = ((width as f64 * comp.canvas.height as f64 / comp.canvas.width as f64).round() as u32) & !1;

    let enc = pick_encoder(&opts.ffmpeg, opts.encoder.as_deref());
    let workers = worker_count(opts, &enc);
    let x264_threads = (cores() / workers).clamp(1, 4);
    // giải mã: chia lõi cho các luồng render để không tranh nhau
    crate::media::set_decode_threads((cores() / workers).clamp(1, 4));

    let total = (duration * fps).ceil() as u64;
    let per = ((total as f64 / (workers as f64 * 3.0)).ceil() as u64).clamp(fps as u64, (fps * 4.0) as u64).max(1);
    let (dir, persistent) = cache_dir(opts);
    std::fs::create_dir_all(&dir).with_context(|| format!("Không tạo được thư mục cache {}", dir.display()))?;
    if persistent {
        prune(&dir);
    }
    let enc_args = enc.args(opts.quality, x264_threads);
    let head = format!("v2|{width}x{height}|{fps}|{}|{}", enc.name, enc_args.join(" "));
    let lib_fp = crate::library::get().fingerprint;
    let mut chunks = Vec::new();
    let mut from = 0;
    while from < total {
        let to = (from + per).min(total);
        let key = chunk_key(comp, from as f64 / fps, to as f64 / fps, format!("{head}|{from}-{to}").as_bytes(), lib_fp);
        let path = dir.join(format!("{key:016x}.mp4"));
        let cached = persistent && std::fs::metadata(&path).is_ok_and(|m| m.len() > 0);
        chunks.push(Chunk { idx: chunks.len(), from, to, path, cached });
        from = to;
    }
    let reused: u64 = chunks.iter().filter(|c| c.cached).map(|c| c.to - c.from).sum();
    progress(0.0, &format!("Đang dựng: {workers} luồng, mã hóa {}{}", enc.name, if reused > 0 { format!(", dùng lại {reused} khung đã dựng") } else { String::new() }));

    // ---- render song song
    let queue: Mutex<VecDeque<&Chunk>> = Mutex::new(chunks.iter().filter(|c| !c.cached).collect());
    let done = AtomicUsize::new(reused as usize);
    let failed: Mutex<Option<anyhow::Error>> = Mutex::new(None);
    let stop = AtomicBool::new(false);
    let running = AtomicUsize::new(workers);
    std::thread::scope(|s| {
        for _ in 0..workers {
            s.spawn(|| {
                let mut renderer = Renderer::new();
                let mut buf = Vec::new();
                loop {
                    if stop.load(Ordering::Relaxed) || cancel.load(Ordering::Relaxed) {
                        break;
                    }
                    let Some(c) = queue.lock().unwrap().pop_front() else { break };
                    if let Err(e) = render_chunk(&mut renderer, &mut buf, comp, c, fps, width, height, &enc, &enc_args, &opts.ffmpeg, cancel, &stop, &done) {
                        stop.store(true, Ordering::Relaxed);
                        failed.lock().unwrap().get_or_insert(e);
                        break;
                    }
                }
                running.fetch_sub(1, Ordering::Relaxed);
            });
        }
        while running.load(Ordering::Relaxed) > 0 {
            std::thread::sleep(Duration::from_millis(250));
            progress((done.load(Ordering::Relaxed) as f64 / total as f64) * 0.97, "Đang dựng khung hình");
        }
    });
    if cancel.load(Ordering::Relaxed) {
        return Err(anyhow!("Đã hủy"));
    }
    if let Some(e) = failed.into_inner().unwrap() {
        return Err(e);
    }

    // ---- ghép đoạn (không mã hóa lại) + trộn tiếng
    progress(0.97, "Đang ghép đoạn và trộn tiếng");
    let list = dir.join(format!("list-{}-{}.txt", std::process::id(), SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_nanos()));
    let body: String = chunks.iter().map(|c| format!("file '{}'\n", c.path.to_string_lossy().replace('\'', "'\\''"))).collect();
    std::fs::write(&list, body)?;
    let res = mux(comp, out, &list, duration, &opts.ffmpeg);
    let _ = std::fs::remove_file(&list);
    if !persistent {
        let _ = std::fs::remove_dir_all(&dir);
    }
    res?;
    progress(1.0, "Xong");
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn render_chunk(
    renderer: &mut Renderer,
    buf: &mut Vec<u8>,
    comp: &Composition,
    c: &Chunk,
    fps: f64,
    width: u32,
    height: u32,
    enc: &Encoder,
    enc_args: &[String],
    ffmpeg: &str,
    cancel: &AtomicBool,
    stop: &AtomicBool,
    done: &AtomicUsize,
) -> Result<()> {
    let tmp = c.path.with_extension(format!("part{}.mp4", c.idx));
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "error", "-y"]);
    cmd.args(["-f", "rawvideo", "-pix_fmt", "bgra", "-s", &format!("{width}x{height}"), "-framerate", &format!("{fps}"), "-i", "-"]);
    cmd.args(["-an", "-c:v", &enc.name]).args(enc_args);
    cmd.args(["-frames:v", &(c.to - c.from).to_string(), "-f", "mp4"]).arg(&tmp);
    cmd.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped());
    let mut child = cmd.spawn().with_context(|| format!("Không chạy được '{ffmpeg}'"))?;
    let mut stdin = child.stdin.take().expect("stdin piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let err_thread = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = std::io::Read::read_to_string(&mut std::io::BufReader::new(stderr), &mut s);
        s
    });
    for i in c.from..c.to {
        if cancel.load(Ordering::Relaxed) || stop.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = std::fs::remove_file(&tmp);
            return Ok(());
        }
        let mut frame = renderer.render(comp, i as f64 / fps, width)?;
        frame.bgra(buf)?;
        if stdin.write_all(buf).is_err() {
            break; // FFmpeg đã dừng: lấy lỗi ở dưới
        }
        done.fetch_add(1, Ordering::Relaxed);
    }
    drop(stdin);
    let status = child.wait()?;
    let err = err_thread.join().unwrap_or_default();
    if !status.success() {
        let _ = std::fs::remove_file(&tmp);
        return Err(anyhow!("FFmpeg ({}) lỗi: {}", enc.name, err.lines().rev().take(4).collect::<Vec<_>>().join(" | ")));
    }
    std::fs::rename(&tmp, &c.path).with_context(|| format!("Không lưu được đoạn {}", c.path.display()))?;
    Ok(())
}

/// Ghép các đoạn hình (copy luồng) + trộn tiếng của các lớp video/audio thành file cuối.
fn mux(comp: &Composition, out: &Path, list: &Path, duration: f64, ffmpeg: &str) -> Result<()> {
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i"]).arg(list);
    let mut filters = Vec::new();
    let mut labels = Vec::new();
    let mut idx = 1;
    for l in &comp.layers {
        let (source, trim, volume, muted) = match &l.kind {
            LayerKind::Video { source, trim_start, volume, muted, .. } => (source, *trim_start, *volume, *muted),
            LayerKind::Audio { source, trim_start, volume, muted } => (source, *trim_start, *volume, *muted),
            _ => continue,
        };
        if muted || l.hidden || volume <= 0.0 || !has_audio(source) {
            continue;
        }
        cmd.args(["-i", source]);
        let delay = (l.start * 1000.0).round() as i64;
        let speed = l.speed.clamp(0.1, 5.0);
        let mut chain = vec![format!("atrim=start={trim:.3}:duration={:.3}", l.duration * speed), "asetpts=PTS-STARTPTS".to_string()];
        chain.extend(atempo_chain(speed)); // đổi tốc độ, giữ cao độ (FFmpeg atempo)
        if l.fade_in > 0.0 {
            chain.push(format!("afade=t=in:st=0:d={:.3}", l.fade_in.min(l.duration)));
        }
        if l.fade_out > 0.0 {
            let d = l.fade_out.min(l.duration);
            chain.push(format!("afade=t=out:st={:.3}:d={d:.3}", (l.duration - d).max(0.0)));
        }
        chain.push(format!("volume={:.3}", volume / 100.0));
        chain.push(format!("adelay=delays={delay}:all=1"));
        filters.push(format!("[{idx}:a]{}[a{idx}]", chain.join(",")));
        labels.push(format!("[a{idx}]"));
        idx += 1;
    }
    if !labels.is_empty() {
        let fc = format!("{};{}amix=inputs={}:normalize=0:duration=longest[aout]", filters.join(";"), labels.join(""), labels.len());
        cmd.args(["-filter_complex", &fc, "-map", "0:v", "-map", "[aout]", "-c:a", "aac", "-b:a", "192k"]);
    } else {
        cmd.args(["-map", "0:v"]);
    }
    cmd.args(["-c:v", "copy", "-movflags", "+faststart", "-t", &format!("{duration:.3}")]).arg(out);
    let o = cmd.stdin(Stdio::null()).output().with_context(|| format!("Không chạy được '{ffmpeg}'"))?;
    if !o.status.success() {
        let err = String::from_utf8_lossy(&o.stderr);
        return Err(anyhow!("FFmpeg ghép đoạn lỗi: {}", err.lines().rev().take(4).collect::<Vec<_>>().join(" | ")));
    }
    Ok(())
}

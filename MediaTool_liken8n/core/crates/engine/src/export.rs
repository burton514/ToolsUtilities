//! Xuất video: Skia render từng khung (RGBA) → đẩy qua pipe vào FFmpeg (libx264) ; tiếng của các lớp
//! video/audio được FFmpeg cắt, dời, chỉnh âm lượng và trộn (atrim/adelay/volume/amix). Toàn bộ mã hóa là FFmpeg native.

use crate::media::has_audio;
use crate::model::{Composition, LayerKind};
use crate::render::Renderer;
use anyhow::{anyhow, Context, Result};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

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
}

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
    let width = match opts.quality {
        Quality::Draft => (comp.canvas.width as f64 * 540.0 / comp.canvas.height.min(comp.canvas.width) as f64) as u32,
        _ => comp.canvas.width,
    } & !1;
    let height = ((width as f64 * comp.canvas.height as f64 / comp.canvas.width as f64).round() as u32) & !1;
    let (preset, crf) = match opts.quality {
        Quality::Draft => ("ultrafast", "28"),
        Quality::Standard => ("veryfast", "21"),
        Quality::High => ("slow", "17"),
    };

    let mut cmd = Command::new(&opts.ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "error", "-y"]);
    cmd.args(["-f", "rawvideo", "-pix_fmt", "rgba", "-s", &format!("{width}x{height}"), "-framerate", &format!("{fps}"), "-i", "-"]);

    // tiếng
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
        let mut chain = vec![
            format!("atrim=start={trim:.3}:duration={:.3}", l.duration * speed),
            "asetpts=PTS-STARTPTS".to_string(),
        ];
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
    cmd.args(["-c:v", "libx264", "-preset", preset, "-crf", crf, "-pix_fmt", "yuv420p", "-movflags", "+faststart"]);
    cmd.args(["-t", &format!("{duration:.3}")]);
    cmd.arg(out);
    cmd.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped());

    let mut child = cmd.spawn().with_context(|| format!("Không chạy được '{}'", opts.ffmpeg))?;
    let mut stdin = child.stdin.take().expect("stdin piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let err_thread = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = std::io::Read::read_to_string(&mut std::io::BufReader::new(stderr), &mut s);
        s
    });

    let mut renderer = Renderer::new();
    let total = (duration * fps).ceil() as u64;
    let mut buf = Vec::new();
    progress(0.0, "Đang dựng khung hình");
    for i in 0..total {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            return Err(anyhow!("Đã hủy"));
        }
        let t = i as f64 / fps;
        let mut frame = renderer.render(comp, t, width)?;
        frame.rgba(&mut buf)?;
        if stdin.write_all(&buf).is_err() {
            break; // FFmpeg đã dừng: lấy lỗi ở dưới
        }
        if i % 5 == 0 {
            progress(i as f64 / total as f64, "Đang dựng khung hình");
        }
    }
    drop(stdin);
    let status = child.wait()?;
    let err = err_thread.join().unwrap_or_default();
    if !status.success() {
        return Err(anyhow!("FFmpeg lỗi: {}", err.lines().rev().take(4).collect::<Vec<_>>().join(" | ")));
    }
    progress(1.0, "Xong");
    Ok(())
}

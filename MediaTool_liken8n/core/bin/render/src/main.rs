//! mediatool-render — CLI của engine native.
//!
//!   mediatool-render export --composition c.json --out video.mp4 [--quality draft|standard|high]
//!       In tiến độ dạng JSON-lines: {"progress":0.42,"message":"..."}
//!   mediatool-render frame --composition c.json --time 1.5 --out frame.jpg [--width 960]
//!
//! Đường dẫn nguồn trong composition phải là file thật (tool compose_render đã giải "asset:<id>").

use anyhow::{anyhow, Context, Result};
use mediatool_engine::{export, Composition, ExportOptions, Quality, Renderer};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn main() {
    if let Err(e) = run() {
        println!("{}", serde_json::json!({"error": format!("{e:#}")}));
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().cloned().unwrap_or_default();
    let comp_path = arg(&args, "--composition").ok_or_else(|| anyhow!("Thiếu --composition"))?;
    let out = PathBuf::from(arg(&args, "--out").ok_or_else(|| anyhow!("Thiếu --out"))?);
    let text = std::fs::read_to_string(&comp_path).with_context(|| format!("Không đọc được {comp_path}"))?;
    if cmd == "edit" {
        // sửa bản dựng theo bảng thao tác chung (mediatool_engine::edit)
        let ops_path = arg(&args, "--ops").ok_or_else(|| anyhow!("Thiếu --ops"))?;
        let ops: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(&ops_path)?).context("--ops phải là mảng JSON")?;
        let comp: serde_json::Value = serde_json::from_str(&text).context("Composition không hợp lệ")?;
        let (edited, counts) = mediatool_engine::edit::apply(comp, &ops)?;
        std::fs::write(&out, serde_json::to_string_pretty(&edited)?)?;
        println!("{}", serde_json::json!({"done": true, "out": out, "affected": counts}));
        return Ok(());
    }
    let comp: Composition = serde_json::from_str(&text).context("Composition không hợp lệ")?;

    match cmd.as_str() {
        "export" => {
            let mut opts = ExportOptions::new(
                Quality::parse(&arg(&args, "--quality").unwrap_or_default()),
                std::env::var("MEDIATOOL_FFMPEG").unwrap_or_else(|_| "ffmpeg".into()),
            );
            opts.threads = arg(&args, "--threads").and_then(|v| v.parse().ok());
            opts.encoder = arg(&args, "--encoder");
            opts.cache_dir = arg(&args, "--cache-dir").map(PathBuf::from);
            let cancel = AtomicBool::new(false);
            export(&comp, &out, &opts, |p, m| println!("{}", serde_json::json!({"progress": p, "message": m})), &cancel)?;
            println!("{}", serde_json::json!({"done": true, "out": out}));
        }
        "frame" => {
            let t: f64 = arg(&args, "--time").and_then(|v| v.parse().ok()).unwrap_or(0.0);
            let w: u32 = arg(&args, "--width").and_then(|v| v.parse().ok()).unwrap_or(960);
            let mut r = Renderer::new();
            let mut f = r.render(&comp, t, w)?;
            std::fs::write(&out, f.jpeg(88)?)?;
            println!("{}", serde_json::json!({"done": true, "out": out, "bounds": f.bounds}));
        }
        _ => return Err(anyhow!("Lệnh phải là 'export', 'frame' hoặc 'edit'")),
    }
    Ok(())
}

//! Xem trước bằng engine native: một luồng render riêng giữ Renderer (decoder FFmpeg + cache Skia)
//! sống giữa các lần gọi → kéo timeline / phát thử phản hồi nhanh, không phải mở lại file.

use base64::Engine as _;
use mediatool_engine::{Composition, Renderer};
use serde_json::{json, Value};
use std::sync::mpsc;
use std::time::Instant;
use tokio::sync::oneshot;

struct Request {
    comp: Composition,
    time: f64,
    width: u32,
    reply: oneshot::Sender<Result<Value, String>>,
}

#[derive(Clone)]
pub struct PreviewService {
    tx: mpsc::Sender<Request>,
}

impl PreviewService {
    pub fn start() -> Self {
        let (tx, rx) = mpsc::channel::<Request>();
        std::thread::Builder::new()
            .name("mediatool-preview".into())
            .spawn(move || {
                let mut renderer = Renderer::new();
                while let Ok(mut req) = rx.recv() {
                    // chỉ giữ yêu cầu mới nhất nếu đang dồn (bỏ khung cũ khi người dùng kéo nhanh)
                    while let Ok(newer) = rx.try_recv() {
                        let _ = req.reply.send(Err("Bỏ qua: đã có yêu cầu mới hơn".into()));
                        req = newer;
                    }
                    let t0 = Instant::now();
                    // chuẩn bị một lần: dùng để render và trả thời gian đã giải cho editor (timeline hiển thị đúng mốc)
                    let comp = req.comp.prepare();
                    let resolved: serde_json::Map<String, Value> = comp
                        .layers
                        .iter()
                        .map(|l| {
                            let anims: Vec<Value> = l.animations.iter().map(|a| json!({ "kind": a.kind, "windows": a.windows })).collect();
                            (l.id.clone(), json!({ "start": l.start, "duration": l.duration, "animations": anims }))
                        })
                        .collect();
                    let res = renderer
                        .render(&comp, req.time, req.width)
                        .and_then(|mut f| {
                            let jpg = f.jpeg(82)?;
                            Ok(json!({
                                "image": format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpg)),
                                "width": f.width, "height": f.height, "bounds": f.bounds,
                                "render_ms": t0.elapsed().as_millis() as u64,
                                "resolved": resolved,
                            }))
                        })
                        .map_err(|e| format!("{e:#}"));
                    renderer.retain_sources(&req.comp);
                    let _ = req.reply.send(res);
                }
            })
            .expect("không tạo được luồng preview");
        Self { tx }
    }

    pub async fn render(&self, comp: Composition, time: f64, width: u32) -> Result<Value, String> {
        let (reply, rx) = oneshot::channel();
        self.tx.send(Request { comp, time, width, reply }).map_err(|_| "Luồng preview đã dừng".to_string())?;
        rx.await.map_err(|_| "Luồng preview không trả lời".to_string())?
    }
}

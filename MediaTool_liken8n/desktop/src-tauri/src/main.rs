// App desktop: nhúng core MediaTool (không cần sidecar), mở API trên 127.0.0.1:8787 cho giao diện,
// MCP và mini app dùng chung. Giao diện = bản build của sandbox/workspace.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tracing_subscriber::fmt().with_env_filter("info").init();

    let mut cfg = mediatool_api::ServerConfig::from_env();
    cfg.host = "127.0.0.1".into();
    cfg.allow_local_paths = true; // desktop: được đăng ký file theo đường dẫn local

    tauri::Builder::default()
        .setup(move |_app| {
            let cfg = cfg.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = mediatool_api::serve(cfg).await {
                    eprintln!("Core MediaTool dừng: {e:#}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("không khởi động được app MediaTool");
}

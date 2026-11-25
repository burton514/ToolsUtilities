//! mediatool-server: đọc cấu hình từ biến môi trường (xem README) rồi chạy core.

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,tower_http=warn".into()),
        )
        .init();
    mediatool_api::serve(mediatool_api::ServerConfig::from_env()).await
}

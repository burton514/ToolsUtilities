# MediaTool Desktop (Tauri 2) — khung, chưa build

App desktop nhúng thẳng core Rust (`core/crates/api`) và dùng bản build của sandbox làm giao diện.

## Yêu cầu (chưa cài trên máy dev hiện tại)

- Rust (rustup) + **MSVC Build Tools** (C++ workload). Tauri trên Windows bắt buộc dùng MSVC.
- WebView2 (Windows 11 có sẵn).
- Python + SDK/worker và FFmpeg trên máy để chạy tool. Bản phát hành sau này sẽ mang theo Python embeddable + profile `base`.

## Chạy dev

```powershell
cd desktop/src-tauri
cargo tauri dev
```

## Việc còn lại

- Chọn cổng ngẫu nhiên + token local thay cho cổng cố định 8787, truyền cho giao diện.
- Đóng gói Python embeddable + FFmpeg vào bundle.
- Icon app (`tauri icon`).

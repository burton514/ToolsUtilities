# MediaTool

Bộ công cụ xử lý media **Tách → Sửa → Ghép**, API-first: core Rust + tool Python + giao diện React (desktop Tauri, web), có MCP để AI điều khiển.

Tài liệu thiết kế: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Viết tool: [docs/TOOL_AUTHORING.md](docs/TOOL_AUTHORING.md) · Viết mini app: [docs/MINIAPP_AUTHORING.md](docs/MINIAPP_AUTHORING.md) · Danh mục tool: [docs/TOOL_CATALOG.md](docs/TOOL_CATALOG.md) · Engine: [docs/ENGINES.md](docs/ENGINES.md)

## Cấu trúc

```
core/           Rust: registry, jobs (scheduler theo RAM), storage (SQLite), API /v1 + SSE, mediatool-server
sdk/python/     mediatool_sdk: hợp đồng tool + CLI mediatool-dev
workers/python/ mediatool_worker: chạy 1 tool theo giao thức JSON-lines
tools/          ★ tool (headless), mỗi tool một thư mục: tools/<category>/<name>/
packages/       ui · miniapp-sdk · workspace (core UI) · api-client
miniapps/       ★ mini app: chỉ cắm panel vào workspace
sandbox/        app kiểm thử dùng chung (Tools · Mini apps · Jobs)
desktop/        Tauri 2 (khung, chưa build)
docker/         image core: Rust + Python + FFmpeg
```

## Chạy nhanh (pull về là chạy)

Yêu cầu: **Docker** (Windows/macOS: Docker Desktop) và **Node.js 20+**. Không cần cài Python, Rust, FFmpeg hay model AI — tất cả nằm
trong image Docker, model tự tải (kiểm sha256) lần đầu dùng tool cần nó.

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Linux / macOS:

```sh
./start.sh
```

Script dựng core (Docker), cài thư viện giao diện nếu chưa có, rồi mở sandbox tại http://localhost:5173. Lần đầu build image mất
vài chục phút (biên dịch Rust); các lần sau vài giây.

**GPU:** máy có GPU **NVIDIA** (driver hỗ trợ CUDA 12, Docker nhận GPU — Docker Desktop + WSL2 trên Windows, `nvidia-container-toolkit`
trên Linux) thì script tự dựng core bản GPU; tool hỗ trợ GPU (tách giọng / tách nhạc cụ, chép lời Whisper) tự chạy CUDA, nhanh hơn
nhiều lần. Trang **Sức khỏe hệ thống** trong sandbox cho biết core đang chạy GPU hay CPU. Không có GPU vẫn chạy bình thường bằng CPU (ép CPU: `start.ps1 -Cpu` / `./start.sh --cpu`). Bật GPU thủ công:

```powershell
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build core
```

## Chạy từng phần (Windows, mọi thứ cài trong thư mục project)

Yêu cầu: Docker Desktop, Node.js 20+, Python 3.11+ (chỉ cho người viết tool).

1. Core (Rust + FFmpeg + Python chạy trong Docker):

```powershell
docker compose up -d --build core
```

2. Sandbox (giao diện kiểm thử), mở http://localhost:5173:

```powershell
npm install
```

```powershell
npm run sandbox
```

3. Môi trường Python cho người viết tool (chạy `mediatool-dev` trên máy):

```powershell
py -3 -m venv .toolchain/venv
```

```powershell
.toolchain/venv/Scripts/python -m pip install -e sdk/python -e workers/python pytest
```

Lệnh dev cần FFmpeg có thể chạy trong container:

```powershell
docker compose run --rm core mediatool-dev validate tools/video/demux
```

```powershell
docker compose run --rm core python -m pytest -q -p no:cacheprovider tools
```

## Gỡ sạch

```powershell
docker compose down -v --rmi local
```

Sau đó xóa các thư mục `.toolchain/`, `node_modules/`, `sandbox/dist/`.

## Biến môi trường của core

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `MEDIATOOL_HOST` / `MEDIATOOL_PORT` | `127.0.0.1` / `8787` | Địa chỉ API |
| `MEDIATOOL_TOOLS`, `MEDIATOOL_MINIAPPS`, `MEDIATOOL_DATA`, `MEDIATOOL_CONFIG` | `tools`, `miniapps`, `data`, `config` | Thư mục |
| `MEDIATOOL_PYTHON` | `python3` | Python có cài SDK + worker |
| `MEDIATOOL_RAM_BUDGET_MB` | `5500` | Ngân sách RAM cho các job chạy cùng lúc |
| `MEDIATOOL_DEVICE` | `cpu` | Thiết bị cho tool hỗ trợ GPU: `cpu`, `cuda`, `auto` (có GPU NVIDIA thì dùng) — bản GPU đặt `auto` |
| `MEDIATOOL_TOKEN` | (trống) | Bật xác thực Bearer cho /v1 |
| `MEDIATOOL_ALLOW_LOCAL_PATHS` | `0` | `1` = cho đăng ký file theo đường dẫn (desktop) |
| `MEDIATOOL_STATIC` | (trống) | Thư mục web tĩnh phục vụ tại `/` |

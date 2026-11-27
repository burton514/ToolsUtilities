#!/usr/bin/env sh
# Khởi động MediaTool một lệnh: core (Docker) + giao diện sandbox (http://localhost:5173).
# Tự dùng GPU NVIDIA nếu máy có (driver + nvidia-container-toolkit); không có thì chạy CPU.
#   ./start.sh            tự chọn GPU / CPU
#   ./start.sh --cpu      ép CPU
#   ./start.sh --core     chỉ chạy core
set -e
cd "$(dirname "$0")"
CPU=0; CORE_ONLY=0
for a in "$@"; do case "$a" in --cpu) CPU=1;; --core) CORE_ONLY=1;; esac; done

docker info >/dev/null 2>&1 || { echo "Docker chưa chạy — bật Docker rồi chạy lại."; exit 1; }

started=0
if [ "$CPU" = 0 ] && command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
  echo "Có GPU NVIDIA — dựng core bản GPU (CUDA)..."
  if docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build core; then started=1
  else echo "Docker chưa dùng được GPU — chuyển sang bản CPU."; fi
fi
if [ "$started" = 0 ]; then
  echo "Dựng core bản CPU..."
  docker compose up -d --build core
fi
echo "Core: http://localhost:8787 (model AI tự tải lần đầu khi chạy tool)"

[ "$CORE_ONLY" = 1 ] && exit 0
[ -d node_modules ] || npm install
echo "Giao diện: http://localhost:5173 (Ctrl+C để dừng giao diện; core vẫn chạy nền)"
exec npm run sandbox

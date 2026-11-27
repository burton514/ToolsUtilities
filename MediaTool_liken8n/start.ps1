# Khởi động MediaTool một lệnh: core (Docker) + giao diện sandbox (http://localhost:5173).
# Tự dùng GPU NVIDIA nếu máy có (driver + Docker nhận GPU); không có thì chạy CPU. Ép CPU: .\start.ps1 -Cpu
# Chỉ chạy core (không mở sandbox): .\start.ps1 -CoreOnly
param([switch]$Cpu, [switch]$CoreOnly)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

docker info *> $null
if ($LASTEXITCODE -ne 0) { Write-Host "Docker chưa chạy — mở Docker Desktop rồi chạy lại." -ForegroundColor Red; exit 1 }

$gpu = $false
if (-not $Cpu -and (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
  nvidia-smi -L *> $null
  if ($LASTEXITCODE -eq 0) { $gpu = $true }
}

$started = $false
if ($gpu) {
  Write-Host "Có GPU NVIDIA — dựng core bản GPU (CUDA)..." -ForegroundColor Cyan
  docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build core
  if ($LASTEXITCODE -eq 0) { $started = $true }
  else { Write-Host "Docker chưa dùng được GPU — chuyển sang bản CPU." -ForegroundColor Yellow }
}
if (-not $started) {
  Write-Host "Dựng core bản CPU..." -ForegroundColor Cyan
  docker compose up -d --build core
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
Write-Host "Core: http://localhost:8787 (model AI tự tải lần đầu khi chạy tool)" -ForegroundColor Green

if ($CoreOnly) { exit 0 }
if (-not (Test-Path node_modules)) { npm install; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
Write-Host "Giao diện: http://localhost:5173 (Ctrl+C để dừng giao diện; core vẫn chạy nền)" -ForegroundColor Green
npm run sandbox

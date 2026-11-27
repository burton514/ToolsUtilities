"""Kiểm tra môi trường chạy tool — `python -m mediatool_worker health --data-dir <dir>` in một JSON.

Core gọi lệnh này cho trang "Sức khỏe hệ thống": Python, thư viện, FFmpeg (bộ lọc / bộ mã hóa tool cần), ONNX Runtime
(CPU / GPU), GPU NVIDIA, CPU / RAM / ổ đĩa dữ liệu. Chỉ đọc, không tải gì, không sửa gì; mỗi mục lỗi độc lập
(một mục hỏng không làm hỏng cả báo cáo).
"""
from __future__ import annotations

import importlib.metadata as md
import importlib.util
import os
import platform
import re
import shutil
import subprocess
import sys
from typing import Any

# (gói pip, tên module, dùng cho) — thư viện chung của image core (docker/core.Dockerfile)
PACKAGES = [
    ("pydantic", "pydantic", "SDK (schema tham số)"),
    ("numpy", "numpy", "mọi tool AI"),
    ("onnxruntime", "onnxruntime", "chạy model ONNX (tách nguồn âm, căn lời, bắt nhịp, giọng đọc)"),
    ("onnx", "onnx", "BS-RoFormer (tách giọng / 6 phần)"),
    ("faster-whisper", "faster_whisper", "chép lời (Whisper / PhoWhisper)"),
    ("sherpa-onnx", "sherpa_onnx", "chép lời ZipFormer"),
    ("vieneu", "vieneu", "giọng đọc VieNeu-TTS"),
    ("soundfile", "soundfile", "đọc / ghi âm thanh"),
]


def _run(cmd: list[str], timeout: float = 10) -> str | None:
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=timeout)
        return r.stdout.decode(errors="replace") if r.returncode == 0 else None
    except Exception:
        return None


def _version(pip_name: str, module: str) -> str | None:
    for n in (pip_name, pip_name.replace("-", "_"), "onnxruntime-gpu" if module == "onnxruntime" else ""):
        if not n:
            continue
        try:
            return md.version(n)
        except md.PackageNotFoundError:
            continue
    return "có" if importlib.util.find_spec(module) else None


def packages() -> list[dict[str, Any]]:
    return [{"name": p, "version": _version(p, m), "purpose": why} for p, m, why in PACKAGES]


def ffmpeg() -> dict[str, Any]:
    path = shutil.which("ffmpeg")
    if not path:
        return {"ok": False, "path": None}
    ver = _run([path, "-hide_banner", "-version"]) or ""
    m = re.search(r"ffmpeg version (\S+)", ver)
    filters = _run([path, "-hide_banner", "-filters"]) or ""
    encoders = _run([path, "-hide_banner", "-encoders"]) or ""
    has = lambda text, name: re.search(rf"\s{re.escape(name)}\s", text) is not None
    return {
        "ok": True, "path": path, "version": m.group(1) if m else None, "ffprobe": shutil.which("ffprobe") is not None,
        "features": {
            "libass (chèn phụ đề)": has(filters, "subtitles"),
            "loudnorm (chuẩn hóa âm lượng)": has(filters, "loudnorm"),
            "rubberband (đổi tốc độ giọng, GPL)": has(filters, "rubberband"),
            "libx264 (xuất MP4)": has(encoders, "libx264"),
            "libmp3lame (xuất MP3)": has(encoders, "libmp3lame"),
        },
    }


def gpu() -> dict[str, Any]:
    out: dict[str, Any] = {"nvidia": [], "onnxruntime": None, "cuda_usable": False, "note": None}
    smi = shutil.which("nvidia-smi")
    if smi:
        txt = _run([smi, "--query-gpu=name,memory.total,memory.used,driver_version", "--format=csv,noheader,nounits"]) or ""
        for line in txt.strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) == 4:
                out["nvidia"].append({"name": parts[0], "memory_total_mb": float(parts[1]), "memory_used_mb": float(parts[2]),
                                      "driver": parts[3]})
    try:
        import onnxruntime as ort

        provs = ort.get_available_providers()
        out["onnxruntime"] = {"version": ort.__version__, "providers": provs}
        if "CUDAExecutionProvider" in provs:
            # thử thật: dựng một đồ thị 1 phép, xem onnxruntime có giữ CUDA không (thiếu driver / thư viện thì tự về CPU)
            try:
                from onnx import TensorProto, helper

                g = helper.make_graph([helper.make_node("Relu", ["x"], ["y"])], "t",
                                      [helper.make_tensor_value_info("x", TensorProto.FLOAT, [1])],
                                      [helper.make_tensor_value_info("y", TensorProto.FLOAT, [1])])
                m = helper.make_model(g, opset_imports=[helper.make_opsetid("", 17)])
                m.ir_version = 8
                from mediatool_sdk.device import providers

                s = ort.InferenceSession(m.SerializeToString(), providers=providers(True))
                out["cuda_usable"] = s.get_providers()[0] == "CUDAExecutionProvider"
                if not out["cuda_usable"]:
                    out["note"] = "onnxruntime có CUDA nhưng không khởi động được (driver / thư viện CUDA)"
            except Exception as e:  # noqa: BLE001
                out["note"] = f"Thử CUDA lỗi: {e}"[:300]
        elif out["nvidia"]:
            out["note"] = "Có GPU NVIDIA nhưng core đang chạy bản CPU — dựng bản GPU: docker-compose.gpu.yml"
        else:
            out["note"] = "Không thấy GPU NVIDIA trong môi trường chạy tool — mọi tool chạy bằng CPU"
    except Exception as e:  # noqa: BLE001
        out["note"] = f"Không nạp được onnxruntime: {e}"[:300]
    return out


def system(data_dir: str) -> dict[str, Any]:
    info: dict[str, Any] = {"os": platform.platform(), "cpu_count": os.cpu_count(), "cpu": None,
                            "ram_total_mb": None, "ram_available_mb": None, "disk": None}
    try:
        txt = open("/proc/cpuinfo", encoding="utf-8", errors="ignore").read()
        m = re.search(r"model name\s*:\s*(.+)", txt)
        info["cpu"] = m.group(1).strip() if m else None
        info["avx512"] = "avx512f" in txt
    except OSError:
        info["cpu"] = platform.processor() or None
    try:
        mem = {k: int(v.split()[0]) // 1024 for k, v in (l.split(":", 1) for l in open("/proc/meminfo", encoding="utf-8"))
               if k in ("MemTotal", "MemAvailable")}
        info["ram_total_mb"], info["ram_available_mb"] = mem.get("MemTotal"), mem.get("MemAvailable")
    except OSError:
        pass
    try:
        os.makedirs(data_dir, exist_ok=True)
        u = shutil.disk_usage(data_dir)
        info["disk"] = {"path": data_dir, "total_mb": u.total // 2**20, "free_mb": u.free // 2**20}
    except OSError:
        pass
    return info


def report(data_dir: str) -> dict[str, Any]:
    out: dict[str, Any] = {"python": sys.version.split()[0]}
    for key, fn in (("packages", packages), ("ffmpeg", ffmpeg), ("gpu", gpu), ("system", lambda: system(data_dir))):
        try:
            out[key] = fn()
        except Exception as e:  # noqa: BLE001
            out[key] = {"error": str(e)[:300]}
    try:
        from mediatool_sdk import __version__ as sdk_version  # type: ignore[attr-defined]
    except Exception:
        sdk_version = _version("mediatool-sdk", "mediatool_sdk")
    out["sdk"] = sdk_version
    return out

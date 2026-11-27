"""Chạy model ONNX trên GPU (NVIDIA CUDA) hoặc CPU — một nơi cho mọi tool khai `runtime.gpu = "optional"`.

Một lựa chọn duy nhất cho cả máy chủ: core đặt `ctx.device = "cuda"` khi chạy bản GPU (MEDIATOOL_DEVICE, xem
docker-compose.gpu.yml) cho tool hỗ trợ GPU; tool chỉ việc truyền `gpu=ctx.device.startswith("cuda")`.
Đường GPU duy nhất: CUDA qua `onnxruntime-gpu`. Không có GPU / driver không nhận → tự chạy CPU và ghi cảnh báo.

    sess, on_gpu = ort_session(model, opts, ctx, gpu=ctx.device.startswith("cuda"))
"""
from __future__ import annotations

from typing import Any

CPU = "CPUExecutionProvider"
CUDA = "CUDAExecutionProvider"
_preloaded = False


def cuda_ready() -> bool:
    """onnxruntime trên máy chạy tool có CUDA không (chỉ kiểm bản cài, chưa thử nạp driver)."""
    try:
        import onnxruntime as ort

        return CUDA in ort.get_available_providers()
    except Exception:
        return False


def providers(gpu: bool) -> list[Any]:
    """Danh sách provider cho onnxruntime: CUDA (nếu muốn và có) rồi CPU làm dự phòng cho phép tính CUDA không hỗ trợ."""
    global _preloaded
    if not gpu or not cuda_ready():
        return [CPU]
    import onnxruntime as ort

    if not _preloaded and hasattr(ort, "preload_dlls"):
        try:  # CUDA / cuDNN cài bằng pip (gói nvidia-*) không nằm trong đường dẫn thư viện của hệ thống
            ort.preload_dlls()
        except Exception:
            pass
        _preloaded = True
    # cấp phát VRAM vừa đủ (không nhân đôi khối nhớ) — GPU laptop 4 GB vẫn chạy được
    return [(CUDA, {"device_id": 0, "arena_extend_strategy": "kSameAsRequested", "cudnn_conv_algo_search": "HEURISTIC"}), CPU]


def ort_session(model: Any, opts: Any, ctx: Any = None, *, gpu: bool = False) -> tuple[Any, bool]:
    """InferenceSession trên GPU nếu được, không thì CPU. Trả (session, có chạy GPU thật không); cảnh báo qua `ctx.log`
    khi máy chủ đặt chạy GPU mà thực tế không dùng được."""
    import onnxruntime as ort

    model = str(model) if not isinstance(model, (bytes, bytearray)) else model
    # chỉ báo lỗi thật: CUDA in hàng trăm cảnh báo vô hại (ScatterND, Memcpy) mỗi lần chạy, làm ngập log của job
    opts.log_severity_level = 3
    sess = ort.InferenceSession(model, opts, providers=providers(gpu))
    on_gpu = sess.get_providers()[0] == CUDA
    if gpu and not on_gpu and ctx is not None:
        why = ("máy chủ chưa cài bản onnxruntime có CUDA (dùng image GPU: docker-compose.gpu.yml)" if not cuda_ready()
               else "không khởi động được CUDA (driver NVIDIA / GPU không nhận)")
        ctx.log.warning(f"Máy chủ đặt chạy GPU nhưng {why} — đang chạy bằng CPU")
    return sess, on_gpu

"""Đọc checkpoint PyTorch (`.ckpt` / `.pt` / `.pth`, định dạng zip của `torch.save`) thành mảng numpy — KHÔNG cần torch.

An toàn: unpickler chỉ cho phép đúng các lớp mà một state_dict cần (tensor, storage, OrderedDict) — file lạ chứa mã
tùy ý sẽ bị từ chối thay vì chạy. Mảng được đọc bằng memmap (không chép cả file vào RAM): chỉ trang nào dùng tới mới nạp.

    sd = load_state_dict(path)          # {"layers.0.0.attn.to_qkv.weight": np.ndarray, ...}
"""
from __future__ import annotations

import pickle
import zipfile
from collections import OrderedDict

import numpy as np

_DTYPES = {
    "FloatStorage": np.float32, "HalfStorage": np.float16, "DoubleStorage": np.float64,
    "LongStorage": np.int64, "IntStorage": np.int32, "ShortStorage": np.int16,
    "CharStorage": np.int8, "ByteStorage": np.uint8, "BoolStorage": np.bool_,
    "BFloat16Storage": "bfloat16",
}


class _Storage:
    def __init__(self, name: str):
        self.name = name


def _rebuild_tensor(storage, offset, size, stride, *_):
    return ("tensor", storage, offset, tuple(size), tuple(stride))


def _rebuild_parameter(data, *_):
    return data


class _Unpickler(pickle.Unpickler):
    def __init__(self, f, storages):
        super().__init__(f)
        self.storages = storages

    def find_class(self, module, name):
        if module == "collections" and name == "OrderedDict":
            return OrderedDict
        if module == "torch._utils" and name in ("_rebuild_tensor_v2", "_rebuild_tensor"):
            return _rebuild_tensor
        if module == "torch._utils" and name == "_rebuild_parameter":
            return _rebuild_parameter
        if module == "torch" and name in _DTYPES:
            return _Storage(name)
        if module == "torch" and name == "device":
            return str
        raise pickle.UnpicklingError(f"checkpoint chứa đối tượng không được phép: {module}.{name}")

    def persistent_load(self, pid):
        # ('storage', storage_type, key, location, numel)
        _, stype, key, _loc, numel = pid
        return self.storages(stype.name if isinstance(stype, _Storage) else str(stype), key, numel)


def load_state_dict(path: str) -> dict[str, np.ndarray]:
    """state_dict của checkpoint dưới dạng {tên: np.ndarray} (bf16 được đổi sang float32)."""
    zf = zipfile.ZipFile(path)
    names = zf.namelist()
    pkl = next(n for n in names if n.endswith("/data.pkl") or n == "data.pkl")
    root = pkl[: -len("data.pkl")]
    infos = {i.filename: i for i in zf.infolist()}

    def storage(stype: str, key: str, numel: int):
        info = infos[f"{root}data/{key}"]
        if info.compress_type != zipfile.ZIP_STORED:
            raise ValueError("checkpoint nén — không đọc trực tiếp được")
        # vị trí dữ liệu thật = sau header cục bộ của mục zip
        with open(path, "rb") as fh:
            fh.seek(info.header_offset)
            h = fh.read(30)
            start = info.header_offset + 30 + int.from_bytes(h[26:28], "little") + int.from_bytes(h[28:30], "little")
        dt = _DTYPES.get(stype, np.float32)
        if dt == "bfloat16":
            raw = np.memmap(path, np.uint16, "r", start, (numel,))
            return (raw.astype(np.uint32) << 16).view(np.float32)
        return np.memmap(path, dt, "r", start, (numel,))

    with zf.open(pkl) as f:
        obj = _Unpickler(f, storage).load()
    if isinstance(obj, dict):
        for k in ("state_dict", "model", "model_state_dict"):
            if k in obj and isinstance(obj[k], dict):
                obj = obj[k]
                break
    out: dict[str, np.ndarray] = {}
    for k, v in obj.items():
        if not (isinstance(v, tuple) and v and v[0] == "tensor"):
            continue
        _, st, off, size, stride = v
        item = st.dtype.itemsize
        arr = np.lib.stride_tricks.as_strided(st[off:], shape=size, strides=tuple(s * item for s in stride)) if size else st[off:off + 1].reshape(())
        out[k.removeprefix("module.")] = arr
    return out

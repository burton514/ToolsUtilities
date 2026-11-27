"""BS-RoFormer (Band-Split RoPE Transformer) chạy bằng numpy + onnxruntime trên CPU — KHÔNG cần PyTorch.

Đọc thẳng checkpoint huấn luyện bằng ZFTurbo/Music-Source-Separation-Training (MIT, kiến trúc của lucidrains/BS-RoFormer,
MIT) — dùng chung cho mọi model họ này (BS-RoFormer Leap Xe, BS-RoFormer SW 6 phần, …), chỉ khác cấu hình băng tần.

Một đoạn âm thanh stereo 44,1 kHz đi qua:
  STFT (n_fft 2048, hop 512, Hann, center) → ghép 2 kênh vào trục tần số → cắt thành các băng (RMSNorm + Linear)
  → `depth` lớp × [Transformer theo thời gian (mỗi băng là một chuỗi) → Transformer theo tần số (mỗi khung là một chuỗi)]
  → RMSNorm → mỗi stem một bộ ước lượng mặt nạ (MLP tanh + GLU theo từng băng) → nhân phức với phổ gốc → iSTFT.

Khớp từng phép với code gốc (`models/bs_roformer/bs_roformer.py`): RMSNorm = normalize·√dim·γ, attention có cổng sigmoid
theo đầu, RoPE xen kẽ (rotary-embedding-torch), GELU chính xác (erf), xóa thành phần DC trước iSTFT (`zero_dc`).

GPU: `gpu=True` chạy hai đồ thị bằng CUDA (onnxruntime-gpu, `mediatool_sdk.device`); không có GPU thì tự về CPU.

Bộ nhớ: attention dùng nhân flash của onnxruntime (không dựng ma trận T×T), các chuỗi chạy theo nhóm nhỏ (~2 048 token
mỗi lần) → đoạn dài 20 s (T = 1723) vẫn chỉ cần vài trăm MB ngoài trọng số. Trọng số đọc bằng memmap.
"""
from __future__ import annotations

import os
from typing import Any, Callable, Sequence

import numpy as np

from .ckpt import load_state_dict

N_FFT, HOP = 2048, 512
SR = 44100


# ---------------------------------------------------------------- STFT / iSTFT giống torch.stft / torch.istft
def _hann(n: int = N_FFT) -> np.ndarray:
    return (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)).astype(np.float32)  # periodic, như torch.hann_window


def stft(x: np.ndarray) -> np.ndarray:
    """x [kênh, mẫu] float32 → phổ phức [kênh, 1025, khung] (center=True, đệm phản chiếu, không chuẩn hóa)."""
    pad = N_FFT // 2
    xp = np.pad(x, ((0, 0), (pad, pad)), mode="reflect")
    n_frames = 1 + (xp.shape[1] - N_FFT) // HOP
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(n_frames)[:, None]
    w = _hann()
    out = np.empty((x.shape[0], N_FFT // 2 + 1, n_frames), np.complex64)
    for c in range(x.shape[0]):
        out[c] = np.fft.rfft(xp[c][idx] * w, axis=1).T
    return out


def istft(spec: np.ndarray, length: int) -> np.ndarray:
    """Phổ [..., 1025, khung] → sóng [..., length]; chia cho tổng cửa sổ² như torch.istft."""
    lead = spec.shape[:-2]
    s = spec.reshape(-1, *spec.shape[-2:])
    n_frames = s.shape[-1]
    w = _hann()
    full = N_FFT + HOP * (n_frames - 1)
    env = np.zeros(full, np.float32)
    for t in range(n_frames):
        env[t * HOP:t * HOP + N_FFT] += w * w
    out = np.zeros((s.shape[0], full), np.float32)
    for c in range(s.shape[0]):
        frames = np.fft.irfft(s[c].T, n=N_FFT, axis=1).astype(np.float32) * w
        for t in range(n_frames):
            out[c, t * HOP:t * HOP + N_FFT] += frames[t]
    pad = N_FFT // 2
    out = out[:, pad:pad + length] / np.maximum(env[pad:pad + length], 1e-11)
    if out.shape[1] < length:
        out = np.pad(out, ((0, 0), (0, length - out.shape[1])))
    return out.reshape(*lead, length)


# ---------------------------------------------------------------- đồ thị ONNX nhỏ (dựng lúc chạy, trọng số là input)
def _layer_graph() -> bytes:
    """Một lớp Transformer: x + Attn(RMSNorm(x)) rồi + FF(RMSNorm(·)). x [B, N, D]; trọng số truyền vào như input.

    Attention dùng `com.microsoft.MultiHeadAttention` của onnxruntime (nhân flash trên CPU): không dựng ma trận N×N
    nên RAM không tăng theo bình phương độ dài đoạn, và nhanh gấp ~3 lần softmax(QKᵀ)V viết bằng phép thường.
    """
    import onnx
    from onnx import TensorProto as T, helper as h

    f = T.FLOAT
    inp = [h.make_tensor_value_info(n, f, s) for n, s in [
        ("x", ["B", "N", "D"]), ("cos", ["N", 1, 64]), ("sin", ["N", 1, 64]), ("rot", [64, 64]),
        ("g1", ["D"]), ("wqkv", ["D", "Q3"]), ("wg", ["D", "H"]), ("bg", ["H"]), ("wo", ["Q", "D"]),
        ("g2", ["D"]), ("w1", ["D", "F"]), ("b1", ["F"]), ("w2", ["F", "D"]), ("b2", ["D"]), ("sqrtd", [])]] + [
        h.make_tensor_value_info(n, T.INT64, [k]) for n, k in (("shape5", 5), ("shape4", 4), ("shape3", 3))]
    out = [h.make_tensor_value_info("y", f, ["B", "N", "D"])]
    c = lambda name, v: h.make_node("Constant", [], [name], value=h.make_tensor(name + "_t", f, [], [v]))
    n = [c("eps", 1e-12), c("half", 0.5), c("one", 1.0), c("isq2", 0.7071067811865476),
         h.make_node("Constant", [], ["ax2"], value=h.make_tensor("ax2_t", T.INT64, [1], [2])),
         h.make_node("Constant", [], ["axm1"], value=h.make_tensor("axm1_t", T.INT64, [1], [-1]))]

    def rms(src: str, g: str, dst: str) -> None:
        n.extend([h.make_node("ReduceL2", [src], [dst + "_l2"], axes=[-1], keepdims=1),
                  h.make_node("Max", [dst + "_l2", "eps"], [dst + "_d"]),
                  h.make_node("Div", [src, dst + "_d"], [dst + "_n"]),
                  h.make_node("Mul", [dst + "_n", "sqrtd"], [dst + "_s"]),
                  h.make_node("Mul", [dst + "_s", g], [dst])])

    rms("x", "g1", "h")
    n += [h.make_node("MatMul", ["h", "wqkv"], ["qkv"]),
          h.make_node("Reshape", ["qkv", "shape5"], ["qkv5"]),                 # [B, N, 3, H, 64]  ('(qkv h d)')
          h.make_node("Split", ["qkv5"], ["q0", "k0", "v0"], axis=2)]
    for a in ("q", "k", "v"):
        n.append(h.make_node("Squeeze", [a + "0", "ax2"], [a + "s"]))       # [B, N, H, 64]
    for a in ("q", "k"):  # RoPE xen kẽ: a·cos + rotate_half(a)·sin, rotate_half = a @ rot
        n += [h.make_node("Mul", [a + "s", "cos"], [a + "c"]),
              h.make_node("MatMul", [a + "s", "rot"], [a + "r"]),
              h.make_node("Mul", [a + "r", "sin"], [a + "rs"]),
              h.make_node("Add", [a + "c", a + "rs"], [a + "e"])]
    for a, src in (("q", "qe"), ("k", "ke"), ("v", "vs")):
        n.append(h.make_node("Reshape", [src, "shape3"], [a + "3"]))       # [B, N, H·64]
    n += [h.make_node("MultiHeadAttention", ["q3", "k3", "v3"], ["att"], domain="com.microsoft", num_heads=8),
          h.make_node("Reshape", ["att", "shape4"], ["att4"]),                 # [B, N, H, 64]
          h.make_node("MatMul", ["h", "wg"], ["gl"]),
          h.make_node("Add", ["gl", "bg"], ["gb"]),
          h.make_node("Sigmoid", ["gb"], ["gs"]),                               # [B, N, H] — cổng theo từng đầu
          h.make_node("Unsqueeze", ["gs", "axm1"], ["gu"]),
          h.make_node("Mul", ["att4", "gu"], ["ag"]),
          h.make_node("Reshape", ["ag", "shape3"], ["af"]),
          h.make_node("MatMul", ["af", "wo"], ["ao"]),
          h.make_node("Add", ["ao", "x"], ["x1"])]
    rms("x1", "g2", "h2")
    n += [h.make_node("MatMul", ["h2", "w1"], ["f1"]),
          h.make_node("Add", ["f1", "b1"], ["f2"]),
          h.make_node("Mul", ["f2", "isq2"], ["f3"]),
          h.make_node("Erf", ["f3"], ["f4"]),
          h.make_node("Add", ["f4", "one"], ["f5"]),
          h.make_node("Mul", ["f2", "f5"], ["f6"]),
          h.make_node("Mul", ["f6", "half"], ["f7"]),                           # GELU chính xác
          h.make_node("MatMul", ["f7", "w2"], ["f8"]),
          h.make_node("Add", ["f8", "b2"], ["f9"]),
          h.make_node("Add", ["f9", "x1"], ["y"])]
    g = h.make_graph(n, "bsroformer_layer", inp, out)
    m = h.make_model(g, opset_imports=[h.make_opsetid("", 17), h.make_opsetid("com.microsoft", 1)])
    m.ir_version = 8
    onnx.checker.check_model(m)
    return m.SerializeToString()


def _mask_graph() -> bytes:
    """MLP ước lượng mặt nạ của một băng: tanh(x·W1 + b1)·W2 + b2 → GLU (nửa đầu × sigmoid(nửa sau))."""
    import onnx
    from onnx import TensorProto as T, helper as h

    f = T.FLOAT
    inp = [h.make_tensor_value_info(n, f, s) for n, s in [
        ("x", ["M", "D"]), ("w1", ["D", "F"]), ("b1", ["F"]), ("w2", ["F", "K2"]), ("b2", ["K2"])]]
    out = [h.make_tensor_value_info("y", f, ["M", "K"])]
    n = [h.make_node("MatMul", ["x", "w1"], ["a"]), h.make_node("Add", ["a", "b1"], ["b"]),
         h.make_node("Tanh", ["b"], ["c"]), h.make_node("MatMul", ["c", "w2"], ["d"]),
         h.make_node("Add", ["d", "b2"], ["e"]),
         h.make_node("Split", ["e"], ["lo", "hi"], axis=-1, num_outputs=2),
         h.make_node("Sigmoid", ["hi"], ["s"]), h.make_node("Mul", ["lo", "s"], ["y"])]
    m = h.make_model(h.make_graph(n, "bsroformer_mask", inp, out), opset_imports=[h.make_opsetid("", 18)])
    m.ir_version = 8
    onnx.checker.check_model(m)
    return m.SerializeToString()


def _session(model: bytes, threads: int | None, gpu: bool = False, ctx: Any = None) -> tuple[Any, bool]:
    import onnxruntime as ort

    from .device import ort_session

    o = ort.SessionOptions()
    # 0 = onnxruntime tự lấy số NHÂN THẬT; dùng cả luồng siêu phân luồng (12 trên CPU 6 nhân) chậm hơn ~25% do tranh cache
    o.intra_op_num_threads = int(threads or os.environ.get("MEDIATOOL_SEP_THREADS", "0") or 0)
    o.enable_cpu_mem_arena = False   # trả RAM ngay sau mỗi lần chạy (ma trận attention rất lớn)
    o.enable_mem_pattern = False
    return ort_session(model, o, ctx, gpu=gpu)


def _rope(n: int, freqs: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    ang = np.arange(n, dtype=np.float32)[:, None] * freqs[None, :].astype(np.float32)
    ang = np.repeat(ang, 2, axis=1)                   # '... n -> ... (n r)', r = 2
    return np.cos(ang).astype(np.float32)[:, None], np.sin(ang).astype(np.float32)[:, None]   # [N, 1, 64]


_ROT = np.zeros((64, 64), np.float32)
_ROT[np.arange(1, 64, 2), np.arange(0, 64, 2)] = -1.0
_ROT[np.arange(0, 64, 2), np.arange(1, 64, 2)] = 1.0


class BSRoformer:
    """Model BS-RoFormer từ checkpoint. `freqs_per_bands`: lấy từ YAML cấu hình của model (tổng = 1025)."""

    def __init__(self, ckpt_path: str, freqs_per_bands: Sequence[int], *, heads: int = 8, dim_head: int = 64,
                 threads: int | None = None, tokens_per_run: int | None = None, gpu: bool = False, ctx: Any = None):
        if sum(freqs_per_bands) != N_FFT // 2 + 1:
            raise ValueError("freqs_per_bands phải có tổng 1025")
        sd = load_state_dict(ckpt_path)
        self.sd = sd
        self.heads, self.dim_head = heads, dim_head
        self.dims_in = [2 * f * 2 for f in freqs_per_bands]          # phức × stereo
        self.depth = 1 + max(int(k.split(".")[1]) for k in sd if k.startswith("layers."))
        self.n_stems = 1 + max(int(k.split(".")[1]) for k in sd if k.startswith("mask_estimators."))
        self.dim = sd["final_norm.gamma"].shape[0]
        if len([k for k in sd if k.startswith("band_split.to_features.") and k.endswith(".1.weight")]) != len(self.dims_in):
            raise ValueError("checkpoint không khớp số băng của cấu hình")
        self._layer, self.on_gpu = _session(_layer_graph(), threads, gpu, ctx)
        self._mask, _ = _session(_mask_graph(), threads, self.on_gpu)
        # CPU: nhóm nhỏ vừa cache nhanh nhất (~2 048 token); GPU: nhóm lớn để GPU đủ việc (vẫn vừa VRAM 4 GB)
        self.tokens_per_run = tokens_per_run or (32768 if self.on_gpu else 2048)
        self._w: dict[str, np.ndarray] = {}

    def _f(self, key: str, t: bool = False) -> np.ndarray:
        """Trọng số float32 liền mạch (chuyển vị cho MatMul khi `t`), nhớ lại để không đổi kiểu lại mỗi đoạn."""
        k = key + ("^T" if t else "")
        if k not in self._w:
            a = np.asarray(self.sd[key], dtype=np.float32)
            self._w[k] = np.ascontiguousarray(a.T if t else a)
        return self._w[k]

    def _transformer(self, x: np.ndarray, prefix: str, seq_batch: int) -> np.ndarray:
        """x [B, N, D] (mỗi hàng B là một chuỗi) qua một lớp; chạy theo nhóm `seq_batch` chuỗi để giới hạn RAM."""
        a, ff = prefix + ".layers.0.0.", prefix + ".layers.0.1."
        b, n, d = x.shape
        cos, sin = _rope(n, np.asarray(self.sd[a + "rotary_embed.freqs"]))
        feeds = {
            "cos": cos, "sin": sin, "rot": _ROT,
            "g1": self._f(a + "norm.gamma"), "wqkv": self._f(a + "to_qkv.weight", True),
            "wg": self._f(a + "to_gates.weight", True), "bg": self._f(a + "to_gates.bias"),
            "wo": self._f(a + "to_out.0.weight", True),
            "g2": self._f(ff + "net.0.gamma"), "w1": self._f(ff + "net.1.weight", True), "b1": self._f(ff + "net.1.bias"),
            "w2": self._f(ff + "net.4.weight", True), "b2": self._f(ff + "net.4.bias"),
            "shape5": np.array([0, n, 3, self.heads, self.dim_head], np.int64),
            "shape4": np.array([0, n, self.heads, self.dim_head], np.int64),
            "shape3": np.array([0, n, self.heads * self.dim_head], np.int64),
            "sqrtd": np.array(d ** 0.5, np.float32),
        }
        out = np.empty_like(x)
        for s in range(0, b, seq_batch):
            e = min(b, s + seq_batch)
            feeds["x"] = np.ascontiguousarray(x[s:e])
            for k in ("shape5", "shape4", "shape3"):
                feeds[k][0] = e - s
            out[s:e] = self._layer.run(["y"], feeds)[0]
        return out

    def _group(self, n: int) -> int:
        """Số chuỗi mỗi lần chạy: ~`tokens_per_run` token (đo trên CPU 6 nhân: nhóm nhỏ vừa cache nhanh hơn nhóm to)."""
        return max(1, self.tokens_per_run // n)

    def __call__(self, audio: np.ndarray, stems: Sequence[int] | None = None,
                 cancel: Callable[[], None] | None = None) -> np.ndarray:
        """audio [2, mẫu] float32 → [số stem, 2, mẫu]. `stems`: chỉ chạy bộ mặt nạ của các stem này (mặc định: tất cả)."""
        length = audio.shape[1]
        spec = stft(audio.astype(np.float32))                         # [2, 1025, T]
        n_t = spec.shape[2]
        fs = np.transpose(spec, (1, 0, 2)).reshape(-1, n_t)          # 'b s f t -> b (f s) t'
        x_in = np.empty((n_t, fs.shape[0] * 2), np.float32)          # 'b f t c -> b t (f c)'
        x_in[:, 0::2], x_in[:, 1::2] = fs.real.T, fs.imag.T

        # tách băng
        x = np.empty((n_t, len(self.dims_in), self.dim), np.float32)
        o = 0
        for i, di in enumerate(self.dims_in):
            p = x_in[:, o:o + di]
            o += di
            nrm = p / np.maximum(np.linalg.norm(p, axis=-1, keepdims=True), 1e-12) * np.float32(di ** 0.5)
            nrm *= self._f(f"band_split.to_features.{i}.0.gamma")
            x[:, i] = nrm @ self._f(f"band_split.to_features.{i}.1.weight", True) + self._f(f"band_split.to_features.{i}.1.bias")

        n_b = x.shape[1]
        for layer in range(self.depth):
            if cancel:
                cancel()
            xt = np.ascontiguousarray(x.transpose(1, 0, 2))           # [băng, T, D]: chuỗi theo thời gian
            xt = self._transformer(xt, f"layers.{layer}.0", self._group(n_t))
            x = np.ascontiguousarray(xt.transpose(1, 0, 2))           # [T, băng, D]: chuỗi theo tần số
            x = self._transformer(x, f"layers.{layer}.1", self._group(n_b))

        g = self._f("final_norm.gamma")
        x = x / np.maximum(np.linalg.norm(x, axis=-1, keepdims=True), 1e-12) * np.float32(self.dim ** 0.5) * g

        ids = list(range(self.n_stems)) if stems is None else list(stems)
        res = np.empty((len(ids), 2, length), np.float32)
        for j, s in enumerate(ids):
            if cancel:
                cancel()
            mask = np.empty((n_t, x_in.shape[1]), np.float32)
            o = 0
            for i, di in enumerate(self.dims_in):
                k = f"mask_estimators.{s}.to_freqs.{i}.0."
                mask[:, o:o + di] = self._mask.run(["y"], {
                    "x": np.ascontiguousarray(x[:, i]), "w1": self._f(k + "0.weight", True), "b1": self._f(k + "0.bias"),
                    "w2": self._f(k + "2.weight", True), "b2": self._f(k + "2.bias")})[0]
                o += di
            m = (mask[:, 0::2] + 1j * mask[:, 1::2]).T.astype(np.complex64)   # [(f s), T]
            est = (fs * m).reshape(-1, 2, n_t).transpose(1, 0, 2)              # [s, f, T]
            est[:, 0] = 0                                                      # zero_dc
            res[j] = istft(est, length)
        return res

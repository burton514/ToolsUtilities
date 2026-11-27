"""Căn ép (forced alignment) chữ đã biết vào âm thanh bằng model CTC — một nơi cho mọi tool căn lời / căn phụ đề.

Thuật toán (CTC-segmentation, Kürzinger 2020; bài hướng dẫn "Forced Alignment with Wav2Vec2" của PyTorch — cũng là
cách của nguyenvulebinh/lyric-alignment):

1. `emissions`: model CTC (wav2vec2…) cho log-xác-suất từng ký tự mỗi khung 20 ms. Âm thanh dài được chạy theo đoạn
   (mặc định 20 s) có thêm 1 s ngữ cảnh mỗi bên, chỉ giữ phần giữa — RAM không đổi theo độ dài bài, ghép không lệch.
2. `trellis`: ma trận điểm (khung × ký tự) — ở lại ký tự hiện tại (đi qua ký tự "trống") hoặc sang ký tự kế tiếp.
3. `backtrack`: dò ngược đường điểm cao nhất (Viterbi), cho phép đoạn đầu / cuối không có lời (nhạc dạo, đuôi bài).
4. `words`: gộp ký tự liền nhau thành từ (ngăn bởi `|`), kèm khung bắt đầu / kết thúc và độ tin cậy trung bình.

Mọi thứ là numpy thuần; model chạy bằng hàm `run(audio[1, n]) -> [1, frames, vocab]` do tool đưa vào (ONNX Runtime…).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    import numpy as np

SR = 16000
HOP = 320                      # wav2vec2: 1 khung = 320 mẫu = 20 ms
FRAME_S = HOP / SR
MAX_CELLS = 200_000_000        # khung × ký tự: quá thì báo chia nhỏ (≈ 800 MB float32 — vừa ngân sách RAM của tool)


@dataclass
class Word:
    label: str
    start: int                 # khung
    end: int                   # khung (không gồm)
    score: float               # xác suất trung bình của các ký tự


def emissions(run: Callable[["np.ndarray"], "np.ndarray"], audio: "np.ndarray", *, chunk_s: float = 20.0, context_s: float = 1.0,
              normalize: bool = False, log_softmax: bool = False, progress: Callable[[float], None] | None = None) -> "np.ndarray":
    """Log-xác-suất [khung, ký tự] cho cả bài. `normalize`: chuẩn hóa đầu vào về trung bình 0, phương sai 1 (theo đoạn)
    khi model không tự làm; `log_softmax`: khi model trả logits."""
    import numpy as np

    n = len(audio)
    total = max(1, n // HOP)
    step = int(chunk_s * SR) // HOP * HOP
    ctxn = int(context_s * SR) // HOP * HOP
    parts = []
    starts = list(range(0, n, step)) or [0]
    for k, a in enumerate(starts):
        b = min(n, a + step)
        w0, w1 = max(0, a - ctxn), min(n, b + ctxn)
        x = audio[w0:w1].astype(np.float32)
        if len(x) < 400:  # quá ngắn cho lớp tích chập đầu
            x = np.pad(x, (0, 400 - len(x)))
        if normalize:
            x = (x - x.mean()) / np.sqrt(x.var() + 1e-7)
        y = np.asarray(run(x[None]), dtype=np.float32)[0]
        if log_softmax:
            m = y.max(axis=1, keepdims=True)
            y = y - (m + np.log(np.exp(y - m).sum(axis=1, keepdims=True)))
        off = (a - w0) // HOP
        want = (b - a) // HOP if b < n else total - a // HOP
        seg = y[off: off + want]
        if len(seg) < want and len(seg):  # khung cuối thiếu do làm tròn của lớp tích chập: lặp khung cuối
            seg = np.concatenate([seg, np.repeat(seg[-1:], want - len(seg), axis=0)])
        parts.append(seg)
        if progress:
            progress((k + 1) / len(starts))
    return np.concatenate(parts)[:total]


def trellis(em: "np.ndarray", tokens: list[int], blank: int) -> "np.ndarray":
    import numpy as np

    T, N = em.shape[0], len(tokens)
    if N > T:
        raise ValueError(f"Lời dài hơn âm thanh ({N} ký tự cho {T * FRAME_S:.0f} giây) — không căn được")
    if T * N > MAX_CELLS:
        raise ValueError(f"Bài quá dài so với lời ({T} khung × {N} ký tự) — hãy căn từng đoạn")
    tok = np.asarray(tokens)
    tr = np.empty((T + 1, N + 1), dtype=np.float32)
    tr[0, 0] = 0
    tr[1:, 0] = np.cumsum(em[:, blank])
    tr[0, 1:] = -np.inf
    tr[-N:, 0] = np.inf  # như bài hướng dẫn gốc: chặn bắt đầu lời quá muộn (không đủ khung cho hết ký tự)
    for t in range(T):
        tr[t + 1, 1:] = np.maximum(tr[t, 1:] + em[t, blank], tr[t, :-1] + em[t, tok])
    return tr


def backtrack(tr: "np.ndarray", em: "np.ndarray", tokens: list[int], blank: int) -> list[tuple[int, int, float]]:
    """[(chỉ số ký tự, khung, xác suất)] theo thời gian."""
    import numpy as np

    j = tr.shape[1] - 1
    t_start = int(np.argmax(tr[:, j]))
    path: list[tuple[int, int, float]] = []
    for t in range(t_start, 0, -1):
        stayed = tr[t - 1, j] + em[t - 1, blank]
        changed = tr[t - 1, j - 1] + em[t - 1, tokens[j - 1]]
        prob = float(np.exp(em[t - 1, tokens[j - 1] if changed > stayed else blank]))
        path.append((j - 1, t - 1, prob))
        if changed > stayed:
            j -= 1
            if j == 0:
                break
    else:
        raise ValueError("Không căn được lời vào âm thanh (lời dài hơn hoặc không khớp)")
    return path[::-1]


def words(path: list[tuple[int, int, float]], transcript: str, sep: str = "|") -> list[Word]:
    """Gộp đường đi thành ký tự (lặp liên tiếp = một ký tự) rồi thành từ ngăn bởi `sep`."""
    segs: list[tuple[str, int, int, float]] = []  # (ký tự, khung đầu, khung cuối, điểm)
    i = 0
    while i < len(path):
        k = i
        while k < len(path) and path[k][0] == path[i][0]:
            k += 1
        score = sum(p[2] for p in path[i:k]) / (k - i)
        segs.append((transcript[path[i][0]], path[i][1], path[k - 1][1] + 1, score))
        i = k
    out: list[Word] = []
    a = 0
    while a <= len(segs):
        b = a
        while b < len(segs) and segs[b][0] != sep:
            b += 1
        if b > a:
            part = segs[a:b]
            length = sum(s[2] - s[1] for s in part) or 1
            out.append(Word("".join(s[0] for s in part), part[0][1], part[-1][2],
                            sum(s[3] * (s[2] - s[1]) for s in part) / length))
        a = b + 1
    return out


def align(em: "np.ndarray", units: list[str], vocab: dict[str, int], sep: str = "|", pad: str | None = None,
          floor: float = -20.0) -> list[Word]:
    """Căn các đơn vị đọc (mỗi phần tử một từ, chỉ gồm ký tự có trong `vocab`) vào ma trận log-xác-suất `em`.
    Như lyric-alignment: ký tự ngăn từ `sep` đóng vai ký tự trống (nhạc / khoảng lặng giữa các từ rơi vào đó), ký tự đệm
    CTC `pad` được gộp vào `sep` (lấy max) rồi loại, log-xác-suất dưới `floor` bị chặn để một khung nhiễu không bẻ đường."""
    import numpy as np

    em = np.maximum(em, floor)
    blank = vocab[sep]
    if pad is not None and pad in vocab:
        p = vocab[pad]
        em = em.copy()
        em[:, blank] = np.maximum(em[:, blank], em[:, p])
        em[:, p] = floor
    transcript = sep.join(units)
    tokens = [vocab[c] for c in transcript]
    path = backtrack(trellis(em, tokens, blank), em, tokens, blank)
    ws = words(path, transcript, sep)
    if [w.label for w in ws] != units:
        raise ValueError("Căn lỗi: số từ sau khi căn không khớp lời")
    return ws

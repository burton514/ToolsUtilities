"""Phần chung của các tool tách nguồn âm (giọng hát / nhạc nền / nhạc cụ) — không phụ thuộc model.

- `decode_stereo`: ffmpeg giải mã một lần ra PCM float32 44,1 kHz stereo trong workdir, đọc bằng memmap (không nạp cả bài).
- `overlap_add`: chạy model theo ĐOẠN chồng nhau rồi trộn có trọng số, phát dần từng khối đã xong theo thứ tự thời gian →
  bộ đệm chỉ dài một đoạn, RAM không tăng theo độ dài bài. Dùng chung cho mọi model (Demucs: trọng số tam giác; RoFormer:
  cửa sổ mờ dần như `demix` của ZFTurbo).
- `StemWriter`: ghi dần WAV 16-bit stereo cho từng phần + đo năng lượng (để cảnh báo bài không lời).
- `finish`: đổi WAV sang FLAC / MP3 nếu cần, dọn file tạm, trả {tên: AudioFile}.
"""
from __future__ import annotations

import wave
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

import numpy as np

from .assets import AudioFile
from .errors import ToolError

SR = 44100


def decode_stereo(ctx: Any, path: Path, duration_s: float | None, progress_range=(0.0, 0.05)) -> np.ndarray:
    """File audio / video → memmap float32 [mẫu, 2] ở 44,1 kHz (file tạm `mix.f32` trong workdir)."""
    raw = ctx.workdir / "mix.f32"
    ctx.ffmpeg(["-i", str(path), "-vn", "-ac", "2", "-ar", str(SR), "-f", "f32le", str(raw)],
               total_seconds=duration_s, progress_range=progress_range, message="Đang đọc âm thanh")
    if not raw.is_file() or raw.stat().st_size < SR * 8:
        raise ToolError("NO_AUDIO", "File không có đủ âm thanh để tách (cần ít nhất 1 giây)")
    return np.memmap(raw, dtype=np.float32, mode="r").reshape(-1, 2)


def triangle_weight(n: int) -> np.ndarray:
    """Trọng số tam giác như `demucs.apply` (đỉnh giữa đoạn, không bằng 0 ở mép)."""
    half = n // 2
    w = np.concatenate([np.arange(1, half + 1), np.arange(n - half, 0, -1)]).astype(np.float32)
    return w / w.max()


def fade_window(chunk: int, fade: int, first: bool, last: bool) -> np.ndarray:
    """Cửa sổ của `demix` (ZFTurbo): tăng / giảm tuyến tính `fade` mẫu ở hai mép; đoạn đầu không fade-in, đoạn cuối không fade-out."""
    w = np.ones(chunk, np.float32)
    if fade > 0:
        if not first:
            w[:fade] = np.linspace(0, 1, fade, dtype=np.float32)
        if not last:
            w[-fade:] = np.linspace(1, 0, fade, dtype=np.float32)
    return w


def reflect_reader(pcm: np.ndarray, border: int) -> Callable[[int, int], np.ndarray]:
    """Đọc đoạn [a, a+n) của tín hiệu đã đệm phản chiếu `border` mẫu hai đầu (như `F.pad(mode="reflect")`), trả [2, n]."""
    total = pcm.shape[0]

    def read(a: int, n: int) -> np.ndarray:
        idx = np.arange(a, a + n) - border
        idx = np.abs(idx)                                  # phản chiếu đầu: -k → k
        over = idx > total - 1
        idx[over] = 2 * (total - 1) - idx[over]            # phản chiếu cuối
        idx = np.clip(idx, 0, total - 1)
        return np.ascontiguousarray(pcm[idx].T)

    return read


def overlap_add(read: Callable[[int, int], np.ndarray], length: int, chunk: int, starts: Sequence[int],
                infer: Callable[[np.ndarray], np.ndarray], weight: Callable[[int], np.ndarray],
                emit: Callable[[np.ndarray], None], progress: Callable[[float], None] | None = None,
                tail_pad: Callable[[np.ndarray, int], np.ndarray] | None = None) -> None:
    """Chạy `infer(x[2, chunk]) → [nguồn, 2, chunk]` trên các đoạn bắt đầu tại `starts` (tăng dần, đoạn đầu = 0) của tín hiệu dài
    `length`, trộn bằng `weight(k)`, gọi `emit(khối[nguồn, 2, n])` cho từng phần đã đủ mọi đoạn phủ, theo thứ tự thời gian.
    Đoạn cuối ngắn hơn `chunk` được đệm bằng `tail_pad(x, n)` (mặc định: số 0)."""
    acc: np.ndarray | None = None
    wsum = np.zeros(chunk, np.float32)
    base = 0
    for k, s in enumerate(starts):
        if acc is not None and s > base:
            done = s - base
            emit(acc[:, :, :done] / np.maximum(wsum[:done], 1e-8))
            acc = np.concatenate([acc[:, :, done:], np.zeros((*acc.shape[:2], done), np.float32)], axis=2)
            wsum = np.concatenate([wsum[done:], np.zeros(done, np.float32)])
            base = s
        n = min(chunk, length - s)
        x = read(s, n)
        if n < chunk:
            x = tail_pad(x, chunk) if tail_pad else np.pad(x, ((0, 0), (0, chunk - n)))
        y = infer(x.astype(np.float32))
        if acc is None:
            acc = np.zeros((y.shape[0], 2, chunk), np.float32)
        w = weight(k)
        acc[:, :, :n] += y[:, :, :n] * w[:n]
        wsum[:n] += w[:n]
        if progress:
            progress((k + 1) / len(starts))
    rest = length - base
    if acc is not None and rest > 0:
        emit(acc[:, :, :rest] / np.maximum(wsum[:rest], 1e-8))


def roformer_plan(length: int, chunk: int, step: int) -> tuple[int, int, list[int]]:
    """(border, độ dài sau đệm, vị trí đoạn) theo `demix` chế độ generic: đệm phản chiếu `chunk − step` mẫu hai đầu khi bài đủ dài."""
    border = chunk - step
    if not (length > 2 * border and border > 0):
        border = 0
    padded = length + 2 * border
    return border, padded, list(range(0, padded, step))


def roformer_tail_pad(x: np.ndarray, chunk: int) -> np.ndarray:
    """Đệm đoạn cuối như `demix`: dài hơn nửa đoạn → phản chiếu, ngắn hơn → số 0."""
    n = x.shape[1]
    if n > chunk // 2 and chunk - n < n:
        return np.pad(x, ((0, 0), (0, chunk - n)), mode="reflect")
    return np.pad(x, ((0, 0), (0, chunk - n)))


def separate_roformer(ctx: Any, pcm: np.ndarray, chunk: int, step: int, infer: Callable[[np.ndarray], np.ndarray],
                      sources: Sequence[str], wavs: dict[str, Path], combos: dict[str, Iterable[str]] | None = None,
                      message: str = "Đang tách nguồn âm", progress_range=(0.08, 0.93)) -> StemWriter:
    """Cả bài qua model kiểu RoFormer theo `demix` của ZFTurbo: đoạn `chunk` mẫu, bước `step`, cửa sổ mờ dần 10% hai mép,
    đệm phản chiếu hai đầu bài. `infer(x[2, chunk]) → [len(sources), 2, chunk]`. Trả StemWriter đã đóng (có `energy`)."""
    total = pcm.shape[0]
    fade = chunk // 10
    border, padded, starts = roformer_plan(total, chunk, step)
    sink = StemWriter(sources, wavs, combos, skip=border, keep=total)
    last = len(starts) - 1
    a, b = progress_range
    ctx.progress(a, f"{message} (đoạn 1/{len(starts)})")
    try:
        overlap_add(reflect_reader(pcm, border), padded, chunk, starts, infer,
                    lambda k: fade_window(chunk, fade, k == 0, k == last), sink,
                    lambda f: ctx.progress(a + (b - a) * f, f"{message} (xong {round(f * len(starts))}/{len(starts)} đoạn)"),
                    tail_pad=roformer_tail_pad)
    finally:
        sink.close()
    return sink


class StemWriter:
    """Nhận khối [nguồn, 2, n] (theo thứ tự `sources`), ghi WAV 16-bit stereo cho từng phần muốn xuất + phần ghép.

    `combos`: phần ghép = tổng vài nguồn, vd. {"instrumental": ["drums", "bass", "other"]}.
    `skip` / `keep`: bỏ `skip` mẫu đầu và chỉ giữ `keep` mẫu (cắt phần đệm hai đầu của RoFormer)."""

    def __init__(self, sources: Sequence[str], paths: dict[str, Path], combos: dict[str, Iterable[str]] | None = None,
                 skip: int = 0, keep: int | None = None):
        self.sources = list(sources)
        self.combos = {k: [self.sources.index(s) for s in v] for k, v in (combos or {}).items()}
        self.files = {}
        for k, p in paths.items():
            f = wave.open(str(p), "wb")
            f.setnchannels(2)
            f.setsampwidth(2)
            f.setframerate(SR)
            self.files[k] = f
        self.energy: dict[str, float] = {}
        self.skip, self.keep = skip, keep
        self.written = 0

    def __call__(self, block: np.ndarray) -> None:
        if self.skip:
            cut = min(self.skip, block.shape[2])
            block, self.skip = block[:, :, cut:], self.skip - cut
        if self.keep is not None:
            block = block[:, :, :max(0, self.keep - self.written)]
        if not block.shape[2]:
            return
        self.written += block.shape[2]
        parts = {name: block[i] for i, name in enumerate(self.sources)}
        for name, ids in self.combos.items():
            parts[name] = block[ids].sum(axis=0)
        for name, data in parts.items():
            self.energy[name] = self.energy.get(name, 0.0) + float(np.square(data, dtype=np.float64).sum())
            if name in self.files:
                pcm16 = (np.clip(data.T, -1.0, 1.0) * 32767.0).round().astype("<i2")
                self.files[name].writeframes(pcm16.tobytes())

    def close(self) -> None:
        for f in self.files.values():
            f.close()


def vocal_ratio(energy: dict[str, float], vocals: str = "vocals", rest: str = "instrumental") -> float:
    """Tỉ lệ năng lượng giọng / (giọng + nhạc nền) — gần 0 nghĩa là bài không có lời."""
    v, i = energy.get(vocals, 0.0), energy.get(rest, 0.0)
    return v / (v + i) if v + i > 0 else 0.0


def finish(ctx: Any, wavs: dict[str, Path], fmt: str, length_s: float, progress_from: float = 0.93) -> dict[str, AudioFile]:
    """WAV → định dạng xuất (`wav` giữ nguyên, `flac` không mất chất lượng, `mp3` 320 kbps); trả {tên: AudioFile}."""
    files = dict(wavs)
    if fmt != "wav":
        codec = ["-c:a", "flac"] if fmt == "flac" else ["-c:a", "libmp3lame", "-b:a", "320k"]
        span = (1.0 - progress_from) / max(len(wavs), 1)
        for i, (k, p) in enumerate(wavs.items()):
            ctx.check_cancelled()
            dst = p.with_suffix(f".{fmt}")
            a = progress_from + span * i
            ctx.ffmpeg(["-i", str(p), *codec, str(dst)], total_seconds=length_s, progress_range=(a, a + span),
                       message="Đang nén file xuất")
            p.unlink(missing_ok=True)
            files[k] = dst
    return {k: AudioFile(path=p) for k, p in files.items()}


def duration_text(seconds: float) -> str:
    m, s = divmod(int(round(seconds)), 60)
    return f"{m}:{s:02d}"

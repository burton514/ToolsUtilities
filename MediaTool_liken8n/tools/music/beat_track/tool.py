"""music_beat_track — tìm nhịp (beat), phách mạnh (downbeat) và BPM của bản nhạc bằng model Beat This! (ONNX, CPU).

Đặc trưng đầu vào tự tính bằng numpy theo đúng công thức lúc huấn luyện model: mono 22050 Hz, STFT Hann 1024 /
hop 441 (50 khung/giây), biên độ chuẩn hóa √1024, 128 dải mel Slaney 30 Hz–11 kHz, log(1 + 1000·x). Model nhận
từng đoạn 1500 khung (30 giây, chồng mép 6 khung), trả logit beat / downbeat mỗi khung; đỉnh cục bộ > 0 là nhịp.

Kết quả là BeatGrid: `beats`, `downbeats`, `bpm`, kèm `markers` (kind beat / downbeat — engine dùng trực tiếp cho
hiệu ứng / chuyển động "theo nhịp") và `items` (TimedData, mỗi nhịp một mục "1 2 3 4") để nối vào tool khác.
"""
from __future__ import annotations

import importlib.util
from typing import Any

from pydantic import BaseModel, Field

from mediatool_sdk import BaseTool, BeatGrid, Context, MediaFile, Result, ToolError

SR, N_FFT, HOP, N_MELS, FPS = 22050, 1024, 441, 128, 50
CHUNK, BORDER = 1500, 6


class Inputs(BaseModel):
    media: MediaFile = Field(description="Bản nhạc (audio) hoặc video có nhạc")


class Params(BaseModel):
    start: float = Field(0, ge=0, description="Chỉ phân tích từ giây này (0 = từ đầu)")
    duration: float = Field(0, ge=0, le=3600, description="Phân tích bao nhiêu giây (0 = đến hết)")


class Outputs(BaseModel):
    beats: BeatGrid = Field(description="Nhịp, phách mạnh, BPM và mốc thời gian (markers) — dùng cho cắt ghép / hiệu ứng theo nhịp")


# ---------------------------------------------------------------- đặc trưng (numpy)
def _mel_filters(np: Any) -> Any:
    """Bộ lọc mel thang Slaney, không chuẩn hóa diện tích (giống torchaudio melscale_fbanks(norm=None, mel_scale="slaney"))."""
    def hz2mel(f: Any) -> Any:
        f = np.asarray(f, dtype=np.float64)
        lin = 3.0 * f / 200.0
        return np.where(f >= 1000.0, 15.0 + np.log(np.maximum(f, 1e-9) / 1000.0) / (np.log(6.4) / 27.0), lin)

    def mel2hz(m: Any) -> Any:
        return np.where(m >= 15.0, 1000.0 * np.exp((np.log(6.4) / 27.0) * (m - 15.0)), 200.0 * m / 3.0)

    freqs = np.linspace(0, SR // 2, N_FFT // 2 + 1)
    f_pts = mel2hz(np.linspace(hz2mel(30.0), hz2mel(11000.0), N_MELS + 2))
    diff = np.diff(f_pts)
    slopes = f_pts[None, :] - freqs[:, None]
    down = -slopes[:, :-2] / diff[:-1]
    up = slopes[:, 2:] / diff[1:]
    return np.maximum(0.0, np.minimum(down, up)).astype(np.float32)  # [n_freqs, n_mels]


def log_mel(np: Any, y: Any) -> Any:
    """Âm thanh mono 22050 Hz → [số khung, 128] (khung 20 ms)."""
    pad = N_FFT // 2
    y = np.pad(y, (pad, pad), mode="reflect") if len(y) > pad else np.pad(y, (pad, pad))
    n = 1 + (len(y) - N_FFT) // HOP
    win = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT)).astype(np.float32)  # Hann tuần hoàn
    fb = _mel_filters(np)
    out = np.empty((n, N_MELS), dtype=np.float32)
    step = 2000  # theo khối để giữ RAM thấp với bài dài
    for a in range(0, n, step):
        b = min(n, a + step)
        idx = np.arange(a, b)[:, None] * HOP + np.arange(N_FFT)[None, :]
        mag = np.abs(np.fft.rfft(y[idx] * win, axis=1)).astype(np.float32) / np.sqrt(N_FFT)
        out[a:b] = np.log1p(1000.0 * (mag @ fb))
    return out


# ---------------------------------------------------------------- suy luận theo đoạn
def predict(np: Any, sess: Any, spect: Any, progress: Any = None) -> tuple[Any, Any]:
    """Logit beat, downbeat cho từng khung; chạy từng đoạn CHUNK khung, bỏ BORDER khung mép mỗi đoạn.
    Như `split_predict_aggregate` của Beat This (overlap_mode = keep_first): chỗ hai đoạn chồng nhau giữ kết quả đoạn TRƯỚC."""
    n = len(spect)
    beat = np.full(n, -1e4, dtype=np.float32)
    down = np.full(n, -1e4, dtype=np.float32)
    starts = list(range(-BORDER, n - BORDER, CHUNK - 2 * BORDER))
    if len(starts) > 1 and n > CHUNK:  # tránh đoạn cuối quá ngắn: kéo về sát cuối bài
        starts[-1] = n - CHUNK + BORDER
    filled = np.zeros(n, dtype=bool)
    for k, s in enumerate(starts):
        a, b = max(0, s), min(n, s + CHUNK)
        x = np.zeros((CHUNK, N_MELS), dtype=np.float32)
        x[a - s:b - s] = spect[a:b]
        lb, ld = sess.run(["beat", "downbeat"], {"spect": x[None]})
        keep_a, keep_b = max(a, s + BORDER), min(b, s + CHUNK - BORDER)
        new = ~filled[keep_a:keep_b]
        beat[keep_a:keep_b][new] = lb[0, keep_a - s:keep_b - s][new]
        down[keep_a:keep_b][new] = ld[0, keep_a - s:keep_b - s][new]
        filled[keep_a:keep_b] = True
        if progress:
            progress((k + 1) / len(starts))
    return beat, down


def peaks(np: Any, logit: Any) -> list[float]:
    """Đỉnh cục bộ trong ±3 khung có logit > 0 → thời điểm (giây); gộp đỉnh liền kề — postprocessor `minimal` của Beat This."""
    n = len(logit)
    pad = np.pad(logit, 3, constant_values=-1e9)
    win = np.lib.stride_tricks.sliding_window_view(pad, 7)
    is_peak = (logit >= win.max(axis=1)) & (logit > 0)
    idx = np.flatnonzero(is_peak)
    groups: list[list[int]] = []
    for i in idx:
        if groups and i - groups[-1][-1] <= 1:
            groups[-1].append(int(i))
        else:
            groups.append([int(i)])
    times = []
    for g in groups:
        times.append(float(np.mean(g)) / FPS)   # như `deduplicate_peaks(width=1)` của Beat This: đỉnh liền kề lấy trung bình
    return times


def bpm_of(np: Any, beats: list[float]) -> float:
    if len(beats) < 2:
        return 0.0
    return round(60.0 / float(np.median(np.diff(beats))), 1)


def build_grid(np: Any, beats: list[float], down_raw: list[float], offset: float, end: float) -> dict[str, Any]:
    """Gắn downbeat vào nhịp gần nhất, đánh số phách trong ô nhịp, sinh markers + items."""
    downs = sorted({min(range(len(beats)), key=lambda i: abs(beats[i] - d)) for d in down_raw}) if beats else []
    count, nxt, numbers = 0, 0, []
    for i in range(len(beats)):
        if nxt < len(downs) and i == downs[nxt]:
            count, nxt = 1, nxt + 1
        else:
            count = count + 1 if count else 0
        numbers.append(count)
    bars = [b - a for a, b in zip(downs, downs[1:])]
    meter = int(np.median(bars)) if bars else 4
    beats_t = [round(b + offset, 3) for b in beats]
    downs_t = [beats_t[i] for i in downs]
    items = [{"start": t, "end": round(beats_t[i + 1] if i + 1 < len(beats_t) else end, 3), "text": str(numbers[i] or "•")}
             for i, t in enumerate(beats_t)]
    markers = [{"id": f"beat{i + 1}", "start": t, "kind": "downbeat" if i in set(downs) else "beat", "label": str(numbers[i] or "")}
               for i, t in enumerate(beats_t)]
    return {"bpm": bpm_of(np, beats), "meter": meter, "beats": beats_t, "downbeats": downs_t, "markers": markers, "items": items}


class MusicBeatTrackTool(BaseTool[Inputs, Params, Outputs]):
    def check(self, ctx: Context) -> None:
        ctx.require_binary("ffmpeg")
        if importlib.util.find_spec("onnxruntime") is None:
            raise ToolError("MISSING_PACKAGE", "Máy chạy tool chưa cài onnxruntime (pip install onnxruntime)")

    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        import numpy as np  # import nặng: chỉ khi chạy
        import onnxruntime as ort

        raw = ctx.workdir / "audio.f32"
        cut = (["-ss", f"{params.start}"] if params.start else []) + (["-t", f"{params.duration}"] if params.duration else [])
        total = params.duration or max(0.0, (inputs.media.duration_s or 0) - params.start) or None
        ctx.ffmpeg(["-y", *cut, "-i", str(inputs.media.path), "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", str(raw)],
                   total_seconds=total, progress_range=(0.0, 0.1), message="Đang đọc âm thanh")
        y = np.fromfile(raw, dtype=np.float32) if raw.is_file() else np.zeros(0, np.float32)
        if len(y) < SR:
            raise ToolError("NO_AUDIO", "Không có đủ âm thanh để tìm nhịp (cần ít nhất 1 giây)")
        length = len(y) / SR

        ctx.progress(0.12, "Đang chuẩn bị model nhịp")
        model = ctx.models.get("beat_this_small")
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 0
        sess = ort.InferenceSession(str(model), opts, providers=["CPUExecutionProvider"])

        ctx.progress(0.15, "Đang phân tích phổ âm thanh")
        spect = log_mel(np, y)
        del y
        ctx.check_cancelled()
        beat, down = predict(np, sess, spect, lambda f: (ctx.check_cancelled(), ctx.progress(0.25 + 0.7 * f, "Đang tìm nhịp")))
        grid = build_grid(np, peaks(np, beat), peaks(np, down), params.start, params.start + length)
        grid.update(start=round(params.start, 3), duration=round(length, 3), model="beat_this_small")
        if not grid["beats"]:
            ctx.log.warning("Không tìm thấy nhịp rõ ràng (đoạn nói / im lặng / nhạc không có nhịp)")
        out = BeatGrid.write(ctx.workdir / "beats.json", grid)
        return Result(outputs=Outputs(beats=out),
                      summary=f"{grid['bpm']:g} BPM · {len(grid['beats'])} nhịp · {len(grid['downbeats'])} ô nhịp ({grid['meter']}/4)")

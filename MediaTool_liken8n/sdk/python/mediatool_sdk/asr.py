"""Nhận dạng giọng nói (speech-to-text) — phần dùng chung cho mọi tool chép lời, mọi model.

- `speech_spans`: cắt âm thanh thành các đoạn có tiếng nói ≤ `max_s` giây (Silero VAD đi kèm faster-whisper). Bài hát / nhạc
  nền to (VAD coi giọng hát là "không phải tiếng nói" — `looks_like_music`) thì cắt đều tại chỗ nhỏ tiếng nhất.
- `ZipFormer`: chạy model ZipFormer / transducer kiểu k2 (encoder + decoder + joiner ONNX + tokens.txt) bằng sherpa-onnx (Apache-2.0),
  trả các dòng có thời gian từng từ.
- `sentence_case`, `write_outputs`: chuẩn hóa chữ và ghi `subtitle` (.srt) + `text` (.txt) + `transcript` (TimedData) giống nhau
  cho mọi tool chép lời — nên các tool thay thế cho nhau được trong chuỗi.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

from . import timed
from .assets import SubtitleFile, TextFile, Transcript

if TYPE_CHECKING:
    import numpy as np

SR = 16000


def looks_like_music(audio: "np.ndarray", kept_s: float, total_s: float, sr: int = SR) -> bool:
    """VAD giữ < 30% thời lượng trong khi > 50% các ô 0,5 s có tiếng to (RMS > −40 dBFS): gần như chắc là bài hát / nhạc
    (VAD loại giọng hát), không phải file im lặng. File ngắn dưới 10 s thì bỏ qua."""
    import numpy as np

    if total_s < 10 or kept_s >= 0.3 * total_s:
        return False
    w = sr // 2
    n = len(audio) // w
    if n == 0:
        return False
    rms = np.sqrt((np.asarray(audio[: n * w], dtype=np.float32).reshape(n, w) ** 2).mean(axis=1))
    return float((rms > 0.01).mean()) > 0.5


def _even_spans(audio: "np.ndarray", sr: int, max_s: float) -> list[tuple[int, int]]:
    """Cắt đều ≤ max_s, mỗi mép dời về chỗ nhỏ tiếng nhất trong 3 giây cuối của đoạn (ít cắt giữa chữ)."""
    import numpy as np

    n, step, look = len(audio), int(max_s * sr), int(3 * sr)
    hop = sr // 50
    spans, a = [], 0
    while a < n:
        b = min(n, a + step)
        if b < n:
            seg = np.abs(audio[b - look: b])
            m = len(seg) // hop
            if m:
                env = seg[: m * hop].reshape(m, hop).mean(axis=1)
                b = b - look + int(np.argmin(env)) * hop
        spans.append((a, b))
        a = b
    return spans


def speech_spans(audio: "np.ndarray", sr: int = SR, max_s: float = 20.0, on_music: Callable[[], None] | None = None) -> list[tuple[int, int]]:
    """[(mẫu đầu, mẫu cuối)] các đoạn có tiếng nói, mỗi đoạn ≤ max_s; đoạn gần nhau được gộp (ít cắt giữa câu)."""
    from importlib.util import find_spec

    total = len(audio) / sr
    if find_spec("faster_whisper") is None:
        return _even_spans(audio, sr, max_s)
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    ts = get_speech_timestamps(audio, VadOptions(min_silence_duration_ms=400, speech_pad_ms=200, max_speech_duration_s=max_s))
    kept = sum(t["end"] - t["start"] for t in ts) / sr
    if looks_like_music(audio, kept, total, sr):
        if on_music:
            on_music()
        return _even_spans(audio, sr, max_s)
    spans: list[tuple[int, int]] = []
    for t in ts:
        a, b = int(t["start"]), int(t["end"])
        if spans and a - spans[-1][1] < sr * 1.0 and b - spans[-1][0] <= max_s * sr:
            spans[-1] = (spans[-1][0], b)
        else:
            spans.append((a, b))
    return spans


def sentence_case(item: dict[str, Any]) -> dict[str, Any]:
    """Model trả toàn chữ thường → viết hoa chữ đầu câu cho phụ đề; câu đã có chữ hoa thì giữ nguyên."""
    t = item["text"]
    if not t or t != t.lower() or not t[0].isalpha():
        return item
    out = {**item, "text": t[0].upper() + t[1:]}
    if item.get("children"):
        first = item["children"][0]
        out["children"] = [{**first, "text": first["text"][:1].upper() + first["text"][1:]}, *item["children"][1:]]
    return out


def to_lines(words: list[dict[str, Any]], max_chars: int = 0) -> list[dict[str, Any]]:
    """Từ có thời gian (một đoạn) → câu (tách tại chỗ ngắt hơi, `timed.split_pauses`) → viết hoa đầu câu → dòng ≤ max_chars."""
    if not words:
        return []
    item = {"start": words[0]["start"], "end": words[-1]["end"], "text": " ".join(w["text"] for w in words), "children": words}
    out: list[dict[str, Any]] = []
    for sent in timed.split_pauses(item):
        out.extend(timed.split_lines(sentence_case(sent), max_chars))
    return out


def write_outputs(workdir: Path, items: list[dict[str, Any]], meta: dict[str, Any]) -> tuple[SubtitleFile, TextFile, Transcript]:
    """Ghi ba output chung của mọi tool chép lời: .srt, .txt (mỗi dòng một câu) và TimedData JSON (`meta` + items)."""
    srt = workdir / "subtitle.srt"
    srt.write_text(timed.to_srt(items), encoding="utf-8")
    txt = workdir / "transcript.txt"
    txt.write_text("".join(i["text"] + "\n" for i in items), encoding="utf-8")
    tr = Transcript.write(workdir / "transcript.json", {**meta, "items": items})
    return SubtitleFile(path=srt), TextFile(path=txt), tr


class ZipFormer:
    """Model ZipFormer / transducer (k2-fsa icefall) chạy bằng sherpa-onnx. `model_dir` chứa encoder.int8.onnx, decoder.onnx,
    joiner.int8.onnx, tokens.txt."""

    def __init__(self, model_dir: Path, threads: int = 0):
        import sherpa_onnx

        n = threads or int(os.environ.get("MEDIATOOL_ASR_THREADS", "0") or 0) or min(8, max(1, (os.cpu_count() or 4) // 2))
        d = Path(model_dir)
        self.rec = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=str(d / "encoder.int8.onnx"), decoder=str(d / "decoder.onnx"), joiner=str(d / "joiner.int8.onnx"),
            tokens=str(d / "tokens.txt"), num_threads=n, sample_rate=SR, feature_dim=80,
            decoding_method="modified_beam_search", max_active_paths=4)

    def words(self, audio: "np.ndarray", offset: float) -> list[dict[str, Any]]:
        """Một đoạn âm thanh → [{start, end, text}] (chữ thường). Token bắt đầu bằng khoảng trắng mở một từ mới; model chỉ cho
        lúc bắt đầu token, nên từ kết thúc khi từ sau bắt đầu, tối đa 0,6 giây (khoảng lặng không bị tính vào từ)."""
        s = self.rec.create_stream()
        s.accept_waveform(SR, audio)
        self.rec.decode_stream(s)
        r = s.result
        groups: list[list[Any]] = []
        for tok, t in zip(r.tokens, r.timestamps):
            if tok.startswith(" ") or tok.startswith("▁") or not groups:
                groups.append([tok.strip(" ▁"), t])
            else:
                groups[-1][0] += tok
        end_of = len(audio) / SR
        out = []
        for i, (text, t) in enumerate(groups):
            if not text:
                continue
            nxt = groups[i + 1][1] if i + 1 < len(groups) else end_of
            out.append({"start": round(offset + t, 3), "end": round(offset + min(nxt, t + 0.6), 3), "text": text.lower()})
        return out


def run_zipformer(ctx: Any, media_path: Path, model_id: str, max_chars: int = 0) -> tuple[list[dict[str, Any]], float, int]:
    """Đường chạy chung của các tool ZipFormer: giải mã → cắt đoạn → nhận dạng từng đoạn → dòng. Trả (dòng, thời lượng, số đoạn)."""
    from . import ffmpeg

    ctx.progress(0.02, "Đang đọc âm thanh")
    audio = ffmpeg.read_pcm(media_path, SR)
    if len(audio) < SR * 0.2:
        from .errors import ToolError

        raise ToolError("NO_AUDIO", "File không có tiếng để nhận dạng")
    ctx.progress(0.05, "Đang chuẩn bị model nhận dạng")
    model = ZipFormer(ctx.models.get(model_id))
    ctx.progress(0.1, "Đang tìm đoạn có tiếng nói")
    spans = speech_spans(audio, on_music=lambda: ctx.log.warning(
        "File có vẻ là bài hát / có nhạc nền to: đang nghe cả file. Lời bài hát chép tự động hay sai — có lời sẵn thì dùng "
        "tool 'Căn lời bài hát theo nhạc' (lyrics_align)"))
    items: list[dict[str, Any]] = []
    for k, (a, b) in enumerate(spans):
        ctx.check_cancelled()
        items.extend(to_lines(model.words(audio[a:b], a / SR), max_chars))
        ctx.progress(0.12 + 0.86 * (k + 1) / len(spans), f"Đã nghe {int(b / SR)}/{int(len(audio) / SR)} giây")
    if not items:
        ctx.log.warning("Không nghe thấy lời nói nào trong file")
    return items, len(audio) / SR, len(spans)

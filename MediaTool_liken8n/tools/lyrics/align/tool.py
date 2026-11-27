"""lyrics_align — căn lời bài hát vào nhạc: thời gian bắt đầu / kết thúc của TỪNG CHỮ (karaoke).

Theo phương pháp của nguyenvulebinh/lyric-alignment (Zalo AI 2022, IoU 0,632):
1. Lời → các dòng; bỏ dòng ghi chú ("ĐK:", "[Chorus]", "Verse 1"…) và dấu lặp "x2".
2. Mỗi chữ VIẾT → cách ĐỌC (`mediatool_sdk.vi.spoken_words`: "3000" → "ba nghìn", "IronMan" → "iron man"), từng chữ một
   để còn đối chiếu ngược; ký tự ngoài bảng chữ của model bị bỏ.
3. Model CTC (wav2vec2, ONNX, CPU) → log-xác-suất ký tự mỗi 20 ms; căn ép Viterbi (`mediatool_sdk.align`).
4. Như repo gốc: mỗi từ kéo dài tới lúc từ kế tiếp bắt đầu, tối đa 3 giây (chữ sáng tới khi chữ sau được hát).
5. Ghép về chữ gốc → dòng → TimedData + Enhanced LRC; dòng có độ tin cậy thấp được cảnh báo (lời không khớp bài).

Hai model trong bảng `ENGINES` (thêm model = thêm một dòng): "song" của repo (học trên nhạc, CC-BY-NC — phi thương mại)
và "general" (XLSR-53 tiếng Việt, Apache-2.0 — phương án thay thế khi cần thương mại, theo docs/ENGINES.md).
"""
from __future__ import annotations

import importlib.util
import json
import re
from typing import Any, Literal

from pydantic import BaseModel, Field

from mediatool_sdk import (BaseTool, Context, InputError, JsonData, MediaFile, Result, SubtitleFile, TextFile, TimedLyrics,
                           ToolError)
from mediatool_sdk import align, ffmpeg, timed, vi

ENGINES: dict[str, dict[str, Any]] = {
    # model ONNX: song = log-xác-suất sẵn (chuẩn hóa đầu vào trong đồ thị); general = logits, cần tự chuẩn hóa
    "song": {"model": "lyric_align_song", "normalize": False, "log_softmax": False, "pad": "<pad>"},
    "general": {"model": "lyric_align_general", "normalize": True, "log_softmax": True, "pad": "[PAD]"},
}
MAX_WORD_S = 3.0           # một chữ sáng tối đa 3 giây (repo gốc: 150 khung)
# Độ tin cậy (xác suất ký tự trung bình) đo được: lời đúng 0,96–1,0 (song) / 0,8–0,9 (general); lời của bài KHÁC ~0,35.
LOW_CONFIDENCE = 0.5       # dòng dưới mức này: có thể không khớp bài
_SECTION = re.compile(r"^\s*(?:[\[\(].*[\]\)]|(?:đk|điệp\s*khúc|dk|verse|chorus|pre-?chorus|bridge|intro|outro|hook|rap|lời\s*\d*)"
                      r"\s*\d*\s*:?)\s*$", re.I)
_REPEAT = re.compile(r"\(?\s*[x×]\s*\d+\s*\)?\s*$", re.I)


class Inputs(BaseModel):
    media: MediaFile = Field(description="Bài hát (audio) hoặc video có bài hát")
    lyrics: TextFile | None = Field(None, description="Lời bài hát (.txt), mỗi dòng một câu hát")
    subtitle: SubtitleFile | None = Field(None, description="Hoặc file lời có sẵn (.lrc / .srt) cần căn lại cho khớp")
    data: JsonData | None = Field(None, description="Hoặc dữ liệu lời dạng JSON (TimedData)")


class Params(BaseModel):
    engine: Literal["song", "general"] = Field("song", description="Model căn lời", json_schema_extra={"x-labels": {
        "song": "Bài hát — chính xác nhất với nhạc (chỉ dùng phi thương mại)",
        "general": "Thông dụng — dùng thương mại được, kém hơn với giọng hát"}})
    offset_ms: int = Field(0, ge=-1000, le=1000, description="Dời toàn bộ thời gian (ms); số âm = chữ hiện sớm hơn (karaoke hay dùng −100)")


class Outputs(BaseModel):
    lrc: SubtitleFile = Field(description="Lời karaoke .lrc có thời gian từng chữ — dùng cho compose_bind kiểu karaoke, máy nghe nhạc")
    lyrics: TimedLyrics = Field(description="Lời kèm thời gian từng dòng / từng chữ và độ tin cậy (JSON)")


def lyric_lines(raw: list[str]) -> tuple[list[str], int]:
    """Dòng lời cần căn: bỏ dòng trống / ghi chú đoạn, bỏ dấu lặp cuối dòng. Trả (dòng, số dòng có dấu lặp)."""
    out, repeats = [], 0
    for line in raw:
        line = vi.normalize(line)
        if not line or _SECTION.match(line) or not any(c.isalnum() for c in line):
            continue  # trống, ghi chú đoạn, hoặc chỉ có ký hiệu ("♪ ♪")
        if _REPEAT.search(line):
            line, repeats = _REPEAT.sub("", line).strip(), repeats + 1
        if line:
            out.append(line)
    return out, repeats


def spoken_units(lines: list[str], charset: set[str]) -> tuple[list[list[list[str]]], list[str]]:
    """Mỗi dòng → mỗi chữ viết → các âm tiết đọc (chỉ ký tự model biết). Trả (cấu trúc lồng, danh sách phẳng âm tiết)."""
    nested: list[list[list[str]]] = []
    flat: list[str] = []
    for line in lines:
        words = line.split()
        spoken = vi.spoken_words(words)
        row = []
        for s in spoken:
            syl = ["".join(c for c in w if c in charset) for w in s.split()]
            syl = [w for w in syl if w]
            row.append(syl)
            flat.extend(syl)
        nested.append(row)
    return nested, flat


def assemble(lines: list[str], nested: list[list[list[str]]], ws: list[align.Word], n_frames: int, offset: float) -> list[dict[str, Any]]:
    """Kéo dài từ tới đầu từ kế tiếp (≤ 3 s), ghép âm tiết → chữ viết → dòng; chữ không đọc được (chỉ ký hiệu) đứng tại
    mốc của chữ trước."""
    fs = align.FRAME_S
    max_f = int(MAX_WORD_S / fs)
    spans = []
    for i, w in enumerate(ws):
        nxt = ws[i + 1].start if i + 1 < len(ws) else n_frames
        spans.append((w.start, max(w.end, min(nxt, w.start + max_f)), w.score))
    items, k, prev_end = [], 0, 0.0
    for text, row in zip(lines, nested):
        words, scores = [], []
        for word_text, syl in zip(text.split(), row):
            if syl:
                part = spans[k:k + len(syl)]
                k += len(syl)
                s, e = part[0][0] * fs + offset, part[-1][1] * fs + offset
                scores.extend(p[2] for p in part)
                prev_end = e
            else:
                s = e = prev_end
            words.append({"start": round(max(0.0, s), 3), "end": round(max(0.0, e), 3), "text": word_text})
        timed_words = [w for w in words if w["end"] > w["start"]] or words
        items.append({"start": timed_words[0]["start"], "end": timed_words[-1]["end"], "text": text, "children": words,
                      "confidence": round(sum(scores) / len(scores), 3) if scores else 0.0})
    return items


class LyricsAlignTool(BaseTool[Inputs, Params, Outputs]):
    def check(self, ctx: Context) -> None:
        ctx.require_binary("ffmpeg")
        if importlib.util.find_spec("onnxruntime") is None:
            raise ToolError("MISSING_PACKAGE", "Máy chạy tool chưa cài onnxruntime (pip install onnxruntime)")

    def validate(self, inputs: Inputs, params: Params, ctx: Context) -> None:
        given = [x for x in (inputs.lyrics, inputs.subtitle, inputs.data) if x is not None]
        if len(given) != 1:
            raise InputError("lyrics", "Hãy đưa MỘT nguồn lời: file .txt, file .lrc / .srt, hoặc dữ liệu JSON")

    @staticmethod
    def _raw_lines(inputs: Inputs) -> tuple[list[str], str]:
        if inputs.lyrics is not None:
            return inputs.lyrics.read().splitlines(), "lyrics"
        src = inputs.subtitle or inputs.data
        field = "subtitle" if inputs.subtitle else "data"
        try:
            return [str(it["text"]) for it in timed.load(src.path)], field
        except (KeyError, ValueError, TypeError, AttributeError) as e:
            raise InputError(field, "Không đọc được lời: file phải là .lrc / .srt / .vtt hoặc JSON dạng "
                                    '{"items": [{"text": …}]} (TimedData)') from e

    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        import numpy as np  # import nặng: chỉ khi chạy
        import onnxruntime as ort

        raw, field = self._raw_lines(inputs)
        lines, repeats = lyric_lines(raw)
        if not lines:
            raise InputError(field, "Không có dòng lời nào để căn")
        if repeats:
            ctx.log.warning(f"{repeats} dòng có dấu lặp (x2…): tool không tự nhân đôi — hãy chép đủ lời lặp lại để căn đúng")

        eng = ENGINES[params.engine]
        ctx.progress(0.02, "Đang nạp model căn lời")
        mdir = ctx.models.get(eng["model"])
        vocab: dict[str, int] = json.loads((mdir / "vocab.json").read_text(encoding="utf-8"))
        charset = {c for c in vocab if len(c) == 1 and c.isalpha()}
        nested, flat = spoken_units(lines, charset)
        if not flat:
            raise InputError(field, "Lời không có chữ nào đọc được")
        mute = [w for line, row in zip(lines, nested) for w, syl in zip(line.split(), row) if not syl and any(c.isalnum() for c in w)]
        if mute:
            ctx.log.warning(f"{len(mute)} chữ không đọc ra được ({', '.join(mute[:5])}) — đứng theo mốc của chữ trước")

        ctx.progress(0.05, "Đang đọc âm thanh")
        audio = ffmpeg.read_pcm(inputs.media.path, align.SR)
        if len(audio) < align.SR:
            raise InputError("media", "Bài hát quá ngắn hoặc không có tiếng")
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 0
        sess = ort.InferenceSession(str(mdir / "model.int8.onnx"), opts, providers=["CPUExecutionProvider"])
        name = sess.get_inputs()[0].name

        def run_model(x: Any) -> Any:
            ctx.check_cancelled()
            return sess.run(None, {name: x})[0]

        em = align.emissions(run_model, audio, normalize=eng["normalize"], log_softmax=eng["log_softmax"],
                             progress=lambda f: ctx.progress(0.1 + 0.75 * f, "Đang nghe giọng hát"))
        ctx.progress(0.87, "Đang căn từng chữ")
        try:
            ws = align.align(em, flat, vocab, pad=eng["pad"])
        except ValueError as e:
            raise InputError(field, f"{e}. Kiểm tra lời có đúng bài, không thừa đoạn") from e

        items = assemble(lines, nested, ws, len(em), params.offset_ms / 1000)
        low = [i for i, it in enumerate(items, 1) if it["confidence"] < LOW_CONFIDENCE]
        if low:
            shown = ", ".join(str(i) for i in low[:10]) + ("…" if len(low) > 10 else "")
            ctx.log.warning(f"{len(low)} dòng căn chưa chắc (dòng {shown}) — lời có thể khác bài hát hoặc nhạc nền quá to")

        mean = float(np.mean([it["confidence"] for it in items]))
        if mean < LOW_CONFIDENCE:
            ctx.log.warning(f"Độ tin cậy cả bài thấp ({mean:.0%}) — lời có vẻ không phải của bài hát này")
        lrc = ctx.workdir / "lyrics.lrc"
        lrc.write_text(timed.to_lrc(items), encoding="utf-8")
        out = TimedLyrics.write(ctx.workdir / "lyrics.json", {
            "engine": params.engine, "model": eng["model"], "duration": round(len(audio) / align.SR, 3),
            "confidence": round(mean, 3), "items": items})
        n_words = sum(len(it["children"]) for it in items)
        return Result(outputs=Outputs(lrc=SubtitleFile(path=lrc), lyrics=out),
                      summary=f"Đã căn {len(items)} dòng, {n_words} chữ (độ tin cậy trung bình {mean:.0%})")

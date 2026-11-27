import importlib.util
import json
from pathlib import Path

import pytest

from mediatool_sdk import timed
from mediatool_sdk.ffmpeg import find_binary
from mediatool_sdk.testing import run_example

np = pytest.importorskip("numpy")
from mediatool_sdk import asr  # noqa: E402

TOOL_DIR = Path(__file__).resolve().parent.parent
# lời gốc của samples/speech_vi.mp3 (giọng tổng hợp VieNeu)
VI_TEXT = ("xin chào các bạn hôm nay chúng ta sẽ học cách làm video có phụ đề tự động "
           "công cụ này nghe giọng nói tiếng việt và chép lại thành chữ kèm thời gian của từng từ")
needs_sherpa = pytest.mark.skipif(importlib.util.find_spec("sherpa_onnx") is None or find_binary("ffmpeg") is None,
                                  reason="cần sherpa-onnx + ffmpeg (và model, tải lần đầu)")


def test_even_spans_cut_at_quietest_point():
    sr = 16000
    loud = (0.3 * np.sin(np.arange(sr * 30) * 0.05)).astype(np.float32)
    loud[sr * 18: sr * 18 + sr // 2] = 0  # chỗ lặng ở giây 18
    spans = asr._even_spans(loud, sr, max_s=20)
    assert spans[0][0] == 0 and spans[-1][1] == len(loud)
    assert abs(spans[0][1] / sr - 18.0) < 0.6, "mép đoạn dời về chỗ lặng trong 3 s cuối"
    assert all(b - a <= 20 * sr for a, b in spans)


def test_to_lines_splits_at_pause_and_capitalizes():
    # đoạn dài > 7 s (model chép một lèo, không dấu câu) → tách đúng chỗ ngắt hơi dài nhất; đoạn ngắn giữ nguyên
    text = "xin chào các bạn thân mến của tôi ơi hôm nay chúng ta cùng nhau học một bài mới thật là vui nhé mọi người"
    words, t = [], 0.0
    for i, w in enumerate(text.split()):
        t += 1.0 if i == 9 else 0.05
        words.append({"start": round(t, 2), "end": round(t + 0.3, 2), "text": w})
        t += 0.3
    lines = asr.to_lines(words)
    assert lines[0]["text"] == "Xin chào các bạn thân mến của tôi ơi" and lines[1]["text"].startswith("Hôm nay")
    assert len(asr.to_lines(words[:9])) == 1
    assert [w["text"].lower() for l in lines for w in l["children"]] == [w["text"] for w in words]


def _wer(ref: str, hyp: str) -> float:
    r, h = ref.lower().split(), hyp.lower().split()
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
    return d[len(h)] / len(r)


@needs_sherpa
def test_vietnamese_speech_exact():
    (r,) = run_example(TOOL_DIR, 1)
    data = json.loads(r.outputs.transcript.path.read_text(encoding="utf-8"))
    assert data["model"] == "zipformer_30m_vi" and data["language"] == "vi"
    hyp = " ".join(i["text"] for i in data["items"])
    assert _wer(VI_TEXT, hyp) <= 0.05, hyp
    words = [w for i in data["items"] for w in i["children"]]
    assert all(a["start"] <= b["start"] for a, b in zip(words, words[1:])), "thời gian từng từ tăng dần"
    assert all(w["end"] - w["start"] <= 0.61 for w in words), "từ không nuốt khoảng lặng"
    assert len(timed.load(r.outputs.subtitle.path)) == len(data["items"])


@needs_sherpa
def test_short_lines_for_vertical_video():
    (r,) = run_example(TOOL_DIR, 2)
    items = timed.load(r.outputs.transcript.path)
    assert len(items) >= 4 and all(len(i["text"]) <= 18 for i in items)

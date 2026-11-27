import importlib.util
import json
import re
import unicodedata
from pathlib import Path

import pytest

from mediatool_sdk import asr, timed
from mediatool_sdk.testing import run_example

TOOL_DIR = Path(__file__).resolve().parent.parent
split_lines = timed.split_lines
_spec = importlib.util.spec_from_file_location("speech_transcribe_tool", TOOL_DIR / "tool.py")
tool = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tool)

# lời gốc của samples/speech_vi.mp3 (đọc bằng giọng tổng hợp VieNeu)
VI_TEXT = ("Xin chào các bạn. Hôm nay chúng ta sẽ học cách làm video có phụ đề tự động. "
           "Công cụ này nghe giọng nói tiếng Việt và chép lại thành chữ, kèm thời gian của từng từ.")

# chạy thật cần faster-whisper + model (tải lần đầu vào thư mục models rồi dùng lại)
needs_whisper = pytest.mark.skipif(importlib.util.find_spec("faster_whisper") is None, reason="cần faster-whisper")


def _words(s: str) -> list[str]:
    s = unicodedata.normalize("NFC", s.lower())
    return re.findall(r"\w+", s)


def wer(ref: str, hyp: str) -> float:
    """Tỉ lệ lỗi từ (word error rate) = khoảng cách sửa từ / số từ của lời gốc."""
    r, h = _words(ref), _words(hyp)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev, d[j] = d[j], cur
    return d[len(h)] / max(1, len(r))


def test_model_table_per_language():
    assert tool.model_id("vi", "base") == "phowhisper_small" and tool.model_id("vi", "small") == "phowhisper_medium"
    assert tool.model_id("en", "base") == "whisper_base" and tool.model_id("ja", "small") == "whisper_small"


def test_split_pauses_cuts_at_longest_pause():
    ws, t = [], 0.0
    for i, w in enumerate("hôm nay trời đẹp quá chúng ta đi chơi nhé mọi người ơi".split()):
        t += 0.8 if i == 5 else 0.05
        ws.append({"start": round(t, 2), "end": round(t + 0.3, 2), "text": w})
        t += 0.3
    item = {"start": ws[0]["start"], "end": ws[-1]["end"], "text": " ".join(w["text"] for w in ws), "children": ws}
    parts = timed.split_pauses(item, max_s=3)
    assert parts[0]["text"] == "hôm nay trời đẹp quá"
    assert [w for p in parts for w in p["children"]] == ws
    assert timed.split_pauses(item) == [item], "đoạn đủ ngắn giữ nguyên"


def test_split_lines_keeps_word_times():
    words = [{"start": i * 0.5, "end": i * 0.5 + 0.4, "text": w} for i, w in enumerate("một hai ba bốn năm sáu bảy tám".split())]
    item = {"start": 0.0, "end": 4.0, "text": " ".join(w["text"] for w in words), "children": words}
    lines = split_lines(item, 10)
    assert all(len(l["text"]) <= 10 for l in lines)
    assert [w for l in lines for w in l["children"]] == words
    assert lines[0]["start"] == 0.0 and lines[-1]["end"] == words[-1]["end"]
    assert split_lines(item, 0) == [item]


def test_split_lines_estimates_words_without_children():
    item = {"start": 1.0, "end": 3.0, "text": "xin chào các bạn thân mến"}
    lines = split_lines(item, 12)
    assert len(lines) >= 2 and lines[0]["start"] == 1.0 and abs(lines[-1]["end"] - 3.0) < 1e-6


def test_sentence_case_only_for_lowercase_output():
    it = {"start": 0, "end": 1, "text": "xin chào", "children": [{"start": 0, "end": 0.5, "text": "xin"}, {"start": 0.5, "end": 1, "text": "chào"}]}
    out = asr.sentence_case(it)
    assert out["text"] == "Xin chào" and out["children"][0]["text"] == "Xin" and it["text"] == "xin chào"
    assert asr.sentence_case({"start": 0, "end": 1, "text": "iPhone mới"})["text"] == "iPhone mới"


def test_music_detection():
    np = pytest.importorskip("numpy")
    loud = (0.2 * np.sin(np.arange(16000 * 60) * 0.05)).astype(np.float32)
    assert asr.looks_like_music(loud, kept_s=0.6, total_s=60), "bài hát: VAD giữ 0,6 s / 60 s mà file to"
    assert not asr.looks_like_music(np.zeros(16000 * 60, np.float32), kept_s=0.0, total_s=60), "file im lặng"
    assert not asr.looks_like_music(loud, kept_s=40, total_s=60), "lời nói bình thường"


def test_hallucination_filter_from_real_numbers():
    # số đo thật trên mẫu tiếng Việt: câu thật vs hai mẩu "ma" ở mép cuối
    assert not tool.hallucinated(7.92, -0.06, 0.0, [0.96] * 37)
    assert tool.hallucinated(0.06, -0.85, 0.0, [0.60])
    assert tool.hallucinated(0.3, -0.68, 0.0, [0.02])
    assert not tool.hallucinated(0.5, -0.3, 0.0, [0.9]), "một từ ngắn nhưng chắc chắn thì giữ"


def test_no_orphan_last_line():
    words = [{"start": i * 0.3, "end": i * 0.3 + 0.25, "text": w} for i, w in enumerate("video có phụ đề tự động".split())]
    item = {"start": 0.0, "end": words[-1]["end"], "text": " ".join(w["text"] for w in words), "children": words}
    lines = split_lines(item, 18)
    assert [l["text"] for l in lines] == ["video có phụ", "đề tự động"]


def test_wer_helper():
    assert wer("xin chào các bạn", "Xin chào, các bạn!") == 0
    assert wer("một hai ba bốn", "một hai bốn") == 0.25


@needs_whisper
def test_vietnamese_speech_phowhisper():
    (r,) = run_example(TOOL_DIR, 1)
    data = json.loads(r.outputs.transcript.path.read_text(encoding="utf-8"))
    assert data["language"] == "vi" and data["model"] == "phowhisper_small"
    hyp = " ".join(i["text"] for i in data["items"])
    assert wer(VI_TEXT, hyp) < 0.15, hyp
    assert all(i.get("children") for i in data["items"]), "phải có thời gian từng từ"
    assert all(i["end"] - i["start"] <= 7.5 for i in data["items"]), "câu dài được tách tại chỗ ngắt hơi"


@needs_whisper
def test_english_speech_whisper():
    (r,) = run_example(TOOL_DIR, 2)
    data = json.loads(r.outputs.transcript.path.read_text(encoding="utf-8"))
    assert data["language"] == "en" and data["model"] == "whisper_base"
    text = " ".join(i["text"] for i in data["items"]).lower()
    assert "subtitles" in text and "video" in text
    assert len(timed.load(r.outputs.subtitle.path)) == len(data["items"])
    assert r.outputs.text.read().count("\n") == len(data["items"])


@needs_whisper
def test_short_lines_for_vertical_video():
    (r,) = run_example(TOOL_DIR, 3)
    items = timed.load(r.outputs.transcript.path)
    assert len(items) >= 4 and all(len(i["text"]) <= 18 for i in items)

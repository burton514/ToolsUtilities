import importlib.util
import json
from pathlib import Path

import pytest

from mediatool_sdk import InputError, speech, timed
from mediatool_sdk.ffmpeg import find_binary
from mediatool_sdk.testing import run_example, run_tool

TOOL_DIR = Path(__file__).resolve().parent.parent
# đọc thật cần gói vieneu + model (~600 MB, tải lần đầu theo [[models]] rồi dùng lại)
needs_vieneu = pytest.mark.skipif(importlib.util.find_spec("vieneu") is None, reason="cần vieneu")
needs_ffmpeg = pytest.mark.skipif(find_binary("ffmpeg") is None, reason="cần ffmpeg")
np = pytest.importorskip("numpy")


def test_join_pauses_count_existing_silence():
    sr = 1000
    tone = np.ones(500, dtype=np.float32) * 0.5
    a = np.concatenate([tone, np.zeros(200, np.float32)])  # đã có 0,2 s im lặng ở đuôi
    track, spans = speech.join([a, tone], sr, ["sentence"])
    # nghỉ "sentence" = 0,5 s: 0,2 s sẵn có + 0,3 s chèn thêm
    # (sai số ≤ nửa cửa sổ đo 10 ms ở mép)
    assert abs(len(track) - (len(a) + 300 + len(tone))) <= 5
    assert spans[1][0] == pytest.approx(1.0, abs=0.02)


def test_display_text_hides_tags():
    assert speech.display_text("Chúng ta bắt đầu nhé [cười].") == "Chúng ta bắt đầu nhé."


@needs_vieneu
def test_script_units_gaps():
    u = speech.script_units("Câu một. Câu hai, chưa hết\nĐoạn mới!")
    assert [x["gap"] for x in u] == ["sentence", "para", "end"]


@needs_ffmpeg
def test_empty_text_is_input_error():
    with pytest.raises(InputError):
        run_tool(TOOL_DIR, inputs={}, params={"text": "  "})


@needs_vieneu
def test_news_example_timed_output():
    (r,) = run_example(TOOL_DIR, 1)
    tr = json.loads(r.outputs.transcript.path.read_text(encoding="utf-8"))
    items = tr["items"]
    assert tr["voice"] == "Mai Anh" and len(items) >= 2
    assert all(b["start"] >= a["end"] for a, b in zip(items, items[1:])), "các câu không chồng nhau"
    assert items[-1]["end"] <= r.outputs.audio.duration_s + 0.05
    assert len(timed.load(r.outputs.subtitle.path)) == len(items)


@needs_vieneu
def test_fast_short_lines_and_seed_repeatable():
    (r1,) = run_example(TOOL_DIR, 2)
    (r2,) = run_example(TOOL_DIR, 2)
    items = timed.load(r1.outputs.transcript.path)
    assert all(len(i["text"]) <= 18 for i in items)
    assert not any("[" in i["text"] for i in items), "thẻ cảm xúc không hiện trong phụ đề"
    assert abs(r1.outputs.audio.duration_s - r2.outputs.audio.duration_s) < 0.05, "cùng seed → đọc giống nhau"

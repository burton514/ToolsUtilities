import importlib.util
import json
from pathlib import Path

import pytest

from mediatool_sdk import InputError, timed
from mediatool_sdk.ffmpeg import probe
from mediatool_sdk.ffmpeg import find_binary
from mediatool_sdk.testing import run_example, run_tool

TOOL_DIR = Path(__file__).resolve().parent.parent
needs_vieneu = pytest.mark.skipif(importlib.util.find_spec("vieneu") is None, reason="cần vieneu")
needs_ffmpeg = pytest.mark.skipif(find_binary("ffmpeg") is None, reason="cần ffmpeg")
_spec = importlib.util.spec_from_file_location("speech_dub_tool", TOOL_DIR / "tool.py")
tool = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tool)

CUES = [{"start": 0.0, "end": 1.0, "text": "a"}, {"start": 1.0, "end": 2.0, "text": "b"}, {"start": 4.0, "end": 5.0, "text": "c"}]


def test_place_speeds_up_before_pushing():
    # câu 1 dài 1,2 s trong khung 0,92 s → tăng tốc 1,3× (trần) rồi lùi câu 2 phần còn thừa
    f, starts, st = tool.place([1.2, 0.5, 0.5], CUES, "speed", 1.3)
    assert f[0] == pytest.approx(1.3) and f[1] == 1.0
    assert starts[1] == pytest.approx(1.2 / 1.3 + tool.GAP)
    assert st["sped"] == 1 and st["pushed"] == 1


def test_place_natural_never_overlaps():
    f, starts, st = tool.place([1.5, 2.8, 0.5], CUES, "natural", 1.3)
    assert f == [1.0, 1.0, 1.0]
    ends = [s + d for s, d in zip(starts, [1.5, 2.8, 0.5])]
    assert all(starts[i + 1] >= ends[i] for i in range(2))


@needs_ffmpeg
def test_needs_one_timing_source():
    with pytest.raises(InputError):
        run_tool(TOOL_DIR, inputs={}, params={})


@needs_vieneu
def test_dub_video_keeps_timing():
    (r,) = run_example(TOOL_DIR, 1)
    info = probe(r.outputs.video.path)
    assert {s["codec_type"] for s in info["streams"]} == {"video", "audio"}
    items = json.loads(r.outputs.transcript.path.read_text(encoding="utf-8"))["items"]
    cues = timed.load(TOOL_DIR / "samples" / "dub_vi.srt")
    assert len(items) == len(cues)
    for it, c in zip(items, cues):
        assert it["start"] >= c["start"] - 0.01 and it["start"] - c["start"] < 0.6


@needs_vieneu
def test_audio_only():
    (r,) = run_example(TOOL_DIR, 2)
    assert "video" not in r.raw_outputs and r.outputs.audio.duration_s > 5

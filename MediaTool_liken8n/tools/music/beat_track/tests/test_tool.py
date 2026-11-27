import importlib.util
import json
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")

from mediatool_sdk import InputError
from mediatool_sdk.testing import run_example, run_tool

TOOL_DIR = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("music_beat_track_tool", TOOL_DIR / "tool.py")
tool = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tool)

needs_ort = pytest.mark.skipif(importlib.util.find_spec("onnxruntime") is None, reason="cần onnxruntime")


def test_log_mel_shape_and_rate():
    y = np.zeros(tool.SR * 2, dtype=np.float32)
    s = tool.log_mel(np, y)
    assert s.shape == (101, 128)  # 50 khung/giây, có đệm giữa
    assert float(s.max()) == 0.0


def test_peaks_merge_and_threshold():
    logit = np.full(200, -5.0, dtype=np.float32)
    logit[50] = 3.0
    logit[100:102] = 2.0  # hai khung liền nhau = một nhịp
    logit[150] = -1.0  # dưới 0: không tính
    t = tool.peaks(np, logit)
    assert t == pytest.approx([1.0, 2.01])


def test_grid_numbers_beats_in_bar():
    beats = [i * 0.5 for i in range(9)]
    g = tool.build_grid(np, beats, [0.02, 2.01], 0.0, 4.5)
    assert g["bpm"] == 120.0 and g["meter"] == 4
    assert [i["text"] for i in g["items"]][:5] == ["1", "2", "3", "4", "1"]
    assert [m["kind"] for m in g["markers"]][:5] == ["downbeat", "beat", "beat", "beat", "downbeat"]


@needs_ort
def test_sample_is_120_bpm():
    (r,) = run_example(TOOL_DIR, 1)
    g = json.loads(r.outputs.beats.path.read_text(encoding="utf-8"))
    assert abs(g["bpm"] - 120) < 2
    assert len(g["beats"]) >= 18 and g["meter"] == 4
    assert np.allclose(np.diff(g["downbeats"]), 2.0, atol=0.08)


@needs_ort
def test_window_offsets_times():
    (r,) = run_example(TOOL_DIR, 2)
    g = json.loads(r.outputs.beats.path.read_text(encoding="utf-8"))
    assert 2.0 <= g["beats"][0] < 2.6 and g["beats"][-1] <= 6.05


def test_missing_media_is_input_error():
    with pytest.raises(InputError):
        run_tool(TOOL_DIR, inputs={}, params={})

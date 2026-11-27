import json
import shutil
from pathlib import Path

import pytest

from mediatool_sdk import InputError, timed
from mediatool_sdk.testing import run_example, run_tool

TOOL_DIR = Path(__file__).resolve().parent.parent
needs_engine = pytest.mark.skipif(not shutil.which("mediatool-render"), reason="cần engine mediatool-render")


def test_parsers_read_samples():
    srt = timed.load(TOOL_DIR / "samples/sample.srt")
    assert [round(i["start"], 1) for i in srt] == [0.2, 1.5] and srt[1]["text"] == "Đây là phụ đề tiếng Việt"
    lrc = timed.load(TOOL_DIR / "samples/sample.lrc")
    assert len(lrc) == 2 and [w["text"] for w in lrc[0]["children"]] == ["Một", "con", "vịt", "xòe", "ra"]


@needs_engine
def test_tiktok_example_outputs_video_and_composition():
    (r,) = run_example(TOOL_DIR, 1)
    comp = json.loads(r.outputs.composition.path.read_text(encoding="utf-8"))
    texts = [l for l in comp["layers"] if l["type"] == "text"]
    assert len(texts) == 2 and texts[0]["spans"], "mỗi câu một lớp chữ, có tô màu từ đang nói"
    assert r.outputs.video.duration_s > 2.5


@needs_engine
def test_karaoke_without_video():
    (r,) = run_example(TOOL_DIR, 2)
    assert r.outputs.video.path.stat().st_size > 0


def test_needs_one_timing_source():
    with pytest.raises(InputError):
        run_tool(TOOL_DIR, inputs={"video": str(TOOL_DIR / "samples/sample_3s.mp4")}, params={})

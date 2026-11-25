from pathlib import Path

import pytest

from mediatool_sdk.ffmpeg import find_binary
from mediatool_sdk.testing import run_example, run_tool

TOOL_DIR = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(not find_binary("ffprobe"), reason="cần ffprobe")


def test_examples_pass():
    for r in run_example(TOOL_DIR):
        assert r.ok


def test_reads_video_info():
    r = run_tool(TOOL_DIR, inputs={"file": "samples/sample_3s.mp4"})
    info = r.outputs.info.load()
    assert info["has_video"] and info["has_audio"]
    assert 2.5 < info["duration_s"] < 3.5
    assert info["video"]["width"] == 320

import shutil
from pathlib import Path

import pytest

from mediatool_sdk import InputError
from mediatool_sdk.ffmpeg import probe
from mediatool_sdk.testing import run_example, run_tool

TOOL_DIR = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(not shutil.which("mediatool-render"), reason="cần engine mediatool-render")


def test_video_example_keeps_size_and_audio():
    (r,) = run_example(TOOL_DIR, 1)
    info = probe(r.outputs.video.path)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert (v["width"], v["height"]) == (320, 240)
    assert any(s["codec_type"] == "audio" for s in info["streams"])


def test_image_example_outputs_image():
    (r,) = run_example(TOOL_DIR, 2)
    assert r.outputs.image.path.stat().st_size > 0
    assert "video" not in r.raw_outputs


def test_needs_exactly_one_input():
    with pytest.raises(InputError):
        run_tool(TOOL_DIR, inputs={}, params={})

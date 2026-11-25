from pathlib import Path

import pytest

from mediatool_sdk import InputError
from mediatool_sdk.ffmpeg import find_binary
from mediatool_sdk.testing import run_example, run_tool

TOOL_DIR = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(not find_binary("ffmpeg"), reason="cần ffmpeg")


def test_examples_pass():
    for r in run_example(TOOL_DIR):
        assert r.ok


def test_wav_output():
    r = run_tool(TOOL_DIR, inputs={"video": "samples/sample_3s.mp4"}, params={"audio_format": "wav"})
    assert r.outputs.audio.path.suffix == ".wav"
    assert r.outputs.video.path.exists()


def test_subtitles_extracted():
    r = run_tool(TOOL_DIR, inputs={"video": "samples/sample_sub.mkv"})
    assert len(r.outputs.subtitles) == 1
    assert "Xin chào" in r.outputs.subtitles[0].path.read_text(encoding="utf-8")


def test_bad_audio_track():
    with pytest.raises(InputError):
        run_tool(TOOL_DIR, inputs={"video": "samples/sample_3s.mp4"}, params={"audio_track": 5})


def test_unknown_param_rejected():
    with pytest.raises(InputError):
        run_tool(TOOL_DIR, inputs={"video": "samples/sample_3s.mp4"}, params={"sourcePath": "x"})

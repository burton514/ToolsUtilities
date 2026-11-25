import json
import shutil
from pathlib import Path

import pytest

from mediatool_sdk import InputError
from mediatool_sdk.ffmpeg import probe
from mediatool_sdk.testing import run_example, run_tool

TOOL_DIR = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(not shutil.which("mediatool-render"), reason="cần engine mediatool-render")


def test_example_renders_video_with_audio():
    (r,) = run_example(TOOL_DIR, 1)
    info = probe(r.outputs.video.path)
    kinds = {s["codec_type"] for s in info["streams"]}
    assert kinds == {"video", "audio"}
    assert 2.8 < float(info["format"]["duration"]) < 3.3


def test_missing_source_is_input_error(tmp_path):
    comp = json.loads((TOOL_DIR / "samples/demo.json").read_text(encoding="utf-8"))
    p = tmp_path / "c.json"
    p.write_text(json.dumps(comp), encoding="utf-8")
    with pytest.raises(InputError):
        run_tool(TOOL_DIR, inputs={"composition": str(p), "media": []}, params={"quality": "draft"})

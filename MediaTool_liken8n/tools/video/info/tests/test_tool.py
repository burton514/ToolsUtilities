from pathlib import Path

import pytest

from mediatool_sdk.ffmpeg import find_binary
from mediatool_sdk.testing import run_example, run_tool

TOOL_DIR = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(not find_binary("ffprobe"), reason="cần ffprobe")


def test_examples_pass():
    for r in run_example(TOOL_DIR):
        assert r.ok


def test_readable_items():
    r = run_tool(TOOL_DIR, inputs={"video": "samples/sample_3s.mp4"})
    items = {i["label"]: i["value"] for i in r.outputs.info.load()["items"]}
    assert items["Thời lượng"] == "0:03"
    assert items["Kích thước khung hình"] == "320 × 240"
    assert items["Tỉ lệ khung"] == "4:3"
    assert items["Âm thanh"].startswith("Có")
    assert "0:03" in r.summary

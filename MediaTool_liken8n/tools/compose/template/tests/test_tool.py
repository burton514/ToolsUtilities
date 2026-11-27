import json
import shutil
from pathlib import Path

import pytest

from mediatool_sdk import InputError, compose
from mediatool_sdk.testing import run_example, run_tool

TOOL_DIR = Path(__file__).resolve().parent.parent
needs_engine = pytest.mark.skipif(not shutil.which("mediatool-render"), reason="cần engine mediatool-render")


def test_library_templates_are_valid():
    ts = compose.library_templates()
    assert {"title_card", "lower_third", "countdown", "quote", "thumbnail"} <= {t["id"] for t in ts}
    for t in ts:
        assert t["name"] and t["slots"] and t["composition"]["layers"], t["id"]


@needs_engine
def test_title_card_fills_slots():
    (r,) = run_example(TOOL_DIR, 1)
    comp = json.loads(r.outputs.composition.path.read_text(encoding="utf-8"))
    assert any(l.get("text") == "Chuyện như chưa bắt đầu" for l in comp["layers"])
    assert not any(l.get("source", "").startswith("{{") for l in comp["layers"]), "lớp nền thiếu ảnh/video phải bị bỏ"
    assert r.outputs.video.duration_s > 3.5


@needs_engine
def test_thumbnail_outputs_image():
    (r,) = run_example(TOOL_DIR, 2)
    assert r.outputs.image.path.stat().st_size > 0 and "video" not in r.raw_outputs


def test_unknown_template_is_input_error():
    with pytest.raises(InputError):
        run_tool(TOOL_DIR, inputs={}, params={"template": "khong_co"})

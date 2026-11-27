import json
import shutil
from pathlib import Path

import pytest

from mediatool_sdk import InputError
from mediatool_sdk.testing import run_example, run_tool

TOOL_DIR = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(not shutil.which("mediatool-render"), reason="cần engine mediatool-render")


def test_example_applies_ops():
    (r,) = run_example(TOOL_DIR, 1)
    comp = json.loads(r.outputs.composition.path.read_text(encoding="utf-8"))
    title = comp["layers"][0]
    assert title["text"] == "Chào mừng!" and title["style"]["size"] == 140
    assert title["effects"] == [{"type": "film_grain"}]


def test_unknown_op_is_input_error():
    with pytest.raises(InputError):
        run_tool(TOOL_DIR, inputs={"composition": str(TOOL_DIR / "samples/demo.json")}, params={"ops": [{"op": "xoa_het"}]})


def test_bad_target_is_input_error():
    with pytest.raises(InputError):
        run_tool(TOOL_DIR, inputs={"composition": str(TOOL_DIR / "samples/demo.json")},
                 params={"ops": [{"op": "move_layer", "target": "khong_co"}]})


def test_beat_markers_from_beat_grid():
    (_, r) = run_example(TOOL_DIR, "all")
    comp = json.loads(r.outputs.composition.path.read_text(encoding="utf-8"))
    kinds = [m["kind"] for m in comp["markers"]]
    assert kinds.count("downbeat") == 2 and kinds.count("beat") == 6


def test_needs_ops_or_markers():
    with pytest.raises(InputError):
        run_tool(TOOL_DIR, inputs={"composition": str(TOOL_DIR / "samples/demo.json")}, params={})

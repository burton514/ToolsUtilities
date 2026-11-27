import importlib.util
import json
from pathlib import Path

import pytest

from mediatool_sdk.ffmpeg import find_binary
from mediatool_sdk.testing import run_example

TOOL_DIR = Path(__file__).resolve().parent.parent
VI_TEXT = ("xin chào các bạn hôm nay chúng ta sẽ học cách làm video có phụ đề tự động "
           "công cụ này nghe giọng nói tiếng việt và chép lại thành chữ kèm thời gian của từng từ")
needs_sherpa = pytest.mark.skipif(importlib.util.find_spec("sherpa_onnx") is None or find_binary("ffmpeg") is None,
                                  reason="cần sherpa-onnx + ffmpeg (và model ~160 MB, tải lần đầu)")


@needs_sherpa
def test_vietnamese_speech_exact():
    (r,) = run_example(TOOL_DIR, 1)
    data = json.loads(r.outputs.transcript.path.read_text(encoding="utf-8"))
    assert data["model"] == "zipformer_150m_vi"
    hyp = " ".join(i["text"] for i in data["items"]).lower().split()
    ref = VI_TEXT.split()
    errors = sum(a != b for a, b in zip(ref, hyp)) + abs(len(ref) - len(hyp))
    assert errors <= 2, hyp
    assert r.outputs.text.read().count("\n") == len(data["items"])

import importlib.util
import wave
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")

from mediatool_sdk import InputError, stems  # noqa: E402
from mediatool_sdk.testing import run_example, run_tool  # noqa: E402

TOOL_DIR = Path(__file__).resolve().parent.parent
needs_ort = pytest.mark.skipif(importlib.util.find_spec("onnxruntime") is None, reason="cần onnxruntime")


def _wav(path):
    with wave.open(str(path)) as w:
        return w.getframerate(), np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").reshape(-1, 2).astype(np.float32) / 32767


def _rms(a):
    return float(np.sqrt((a ** 2).mean()))


def test_bands_cover_all_stft_bins():
    spec = importlib.util.spec_from_file_location("sw_tool", TOOL_DIR / "tool.py")
    tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tool)
    assert sum(tool.BANDS) == 1025 and len(tool.BANDS) == 62
    assert tool.SOURCES == ("bass", "drums", "other", "vocals", "guitar", "piano")


@needs_ort
def test_six_stems_and_instrumental():
    (r,) = run_example(TOOL_DIR, 1)
    sr, voc = _wav(r.outputs.vocals.path)
    parts = {k: _wav(getattr(r.outputs, k).path)[1] for k in ("instrumental", "drums", "bass", "guitar", "piano", "other")}
    assert sr == 44100 and abs(len(voc) / sr - 11.0) < 0.1
    assert all(len(v) == len(voc) for v in parts.values())
    # nhạc nền = tổng 5 phần nhạc cụ (sai số làm tròn 16-bit)
    summed = sum(parts[k] for k in ("drums", "bass", "guitar", "piano", "other"))
    assert np.abs(np.clip(summed, -1, 1) - parts["instrumental"]).max() < 5e-3
    assert _rms(voc) > _rms(parts["instrumental"])   # mẫu chủ yếu là giọng hát


def test_missing_media_is_input_error():
    with pytest.raises(InputError):
        run_tool(TOOL_DIR, inputs={}, params={})

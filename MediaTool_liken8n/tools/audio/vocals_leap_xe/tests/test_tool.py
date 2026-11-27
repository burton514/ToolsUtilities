import importlib.util
import wave
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")

from mediatool_sdk import InputError, stems  # noqa: E402
from mediatool_sdk.bs_roformer import istft, stft  # noqa: E402
from mediatool_sdk.testing import run_example, run_tool  # noqa: E402

TOOL_DIR = Path(__file__).resolve().parent.parent
needs_ort = pytest.mark.skipif(importlib.util.find_spec("onnxruntime") is None, reason="cần onnxruntime")


def _wav(path):
    with wave.open(str(path)) as w:
        return w.getframerate(), np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").reshape(-1, 2).astype(np.float32) / 32767


def _rms(a):
    return float(np.sqrt((a ** 2).mean()))


def _run(pcm, chunk, starts, weight, length=None, read=None, **kw):
    blocks = []
    stems.overlap_add(read or (lambda a, n: np.ascontiguousarray(pcm[a:a + n].T)), length or pcm.shape[0], chunk, starts,
                      lambda x: np.stack([x, -x]), weight, blocks.append, **kw)
    return np.concatenate(blocks, axis=2), blocks


def test_roformer_plan_reflect_and_trim_give_back_signal():
    """Đệm phản chiếu + cửa sổ mờ dần + cắt phần đệm: model giả trả nguyên đầu vào → ra đúng bài gốc, đủ số mẫu."""
    pcm = np.random.default_rng(1).standard_normal((70_001, 2)).astype(np.float32)
    chunk = 10_000
    for step in (chunk // 2, chunk - chunk // 10):
        border, padded, starts = stems.roformer_plan(pcm.shape[0], chunk, step)
        assert border == chunk - step and padded == pcm.shape[0] + 2 * border
        last = len(starts) - 1
        out, _ = _run(pcm, chunk, starts, lambda k: stems.fade_window(chunk, chunk // 10, k == 0, k == last), padded,
                      stems.reflect_reader(pcm, border), tail_pad=stems.roformer_tail_pad)
        trimmed = out[0][:, border:border + pcm.shape[0]]
        assert np.allclose(trimmed.T, pcm, atol=1e-4)


def test_reflect_reader_matches_numpy_pad():
    pcm = np.arange(20, dtype=np.float32).reshape(10, 2)
    r = stems.reflect_reader(pcm, 3)
    ref = np.pad(pcm.T, ((0, 0), (3, 3)), mode="reflect")
    assert np.array_equal(r(0, 16), ref)


def test_short_song_has_no_border():
    border, padded, starts = stems.roformer_plan(1000, 10_000, 5000)
    assert border == 0 and padded == 1000 and starts == [0]


def test_stft_istft_round_trip_and_frame_count():
    x = np.random.default_rng(2).standard_normal((2, 44_100)).astype(np.float32)
    s = stft(x)
    assert s.shape == (2, 1025, 1 + 44_100 // 512)
    assert np.allclose(istft(s, 44_100), x, atol=1e-4)


def test_bands_cover_all_stft_bins():
    spec = importlib.util.spec_from_file_location("leap_tool", TOOL_DIR / "tool.py")
    tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tool)
    assert sum(tool.BANDS) == 1025 and len(tool.BANDS) == 90
    assert tool.n_chunks(10 * 44100, tool.step_for("standard")) == 1          # bài ngắn: một đoạn
    assert tool.n_chunks(240 * 44100, tool.step_for("best")) > tool.n_chunks(240 * 44100, tool.step_for("standard"))


@needs_ort
def test_vocals_and_instrumental_sum_back_to_mix():
    """Nhạc nền = bài gốc − giọng: cộng hai file phải ra lại bài; mẫu chủ yếu là giọng hát."""
    (r,) = run_example(TOOL_DIR, 1)
    sr, voc = _wav(r.outputs.vocals.path)
    _, ins = _wav(r.outputs.instrumental.path)
    assert sr == 44100 and abs(len(voc) / sr - 11.0) < 0.1 and len(voc) == len(ins)
    assert _rms(voc) > 3 * _rms(ins)
    assert "Leap Xe" in r.summary


def test_missing_media_is_input_error():
    with pytest.raises(InputError):
        run_tool(TOOL_DIR, inputs={}, params={})

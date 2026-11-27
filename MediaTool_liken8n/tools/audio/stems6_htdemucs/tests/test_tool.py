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


def _run(pcm, chunk, starts, weight, length=None, read=None, **kw):
    blocks = []
    stems.overlap_add(read or (lambda a, n: np.ascontiguousarray(pcm[a:a + n].T)), length or pcm.shape[0], chunk, starts,
                      lambda x: np.stack([x, -x]), weight, blocks.append, **kw)
    return np.concatenate(blocks, axis=2), blocks


def test_overlap_add_identity_triangle_and_bounded_buffer():
    pcm = np.random.default_rng(0).standard_normal((50_000, 2)).astype(np.float32)
    chunk = 8000
    starts = list(range(0, pcm.shape[0], 6000))
    out, blocks = _run(pcm, chunk, starts, lambda k: stems.triangle_weight(chunk))
    assert out.shape == (2, 2, pcm.shape[0])
    assert np.allclose(out[0].T, pcm, atol=1e-5) and np.allclose(out[1].T, -pcm, atol=1e-5)
    assert max(b.shape[2] for b in blocks) <= chunk


def test_stem_writer_combo_skip_keep_and_energy(tmp_path):
    w = stems.StemWriter(["a", "b"], {"a": tmp_path / "a.wav", "mix": tmp_path / "m.wav"}, {"mix": ["a", "b"]}, skip=3, keep=10)
    blk = np.full((2, 2, 8), 0.25, np.float32)
    w(blk)
    w(blk)
    w.close()
    with wave.open(str(tmp_path / "m.wav")) as f:
        data = np.frombuffer(f.readframes(f.getnframes()), "<i2")
        assert f.getnframes() == 10 and f.getframerate() == 44100
    assert abs(data[0] / 32767 - 0.5) < 1e-3
    assert w.energy["a"] == pytest.approx(10 * 2 * 0.0625)


def test_mix_stats_blockwise_matches_numpy():
    spec = importlib.util.spec_from_file_location("ht_tool", TOOL_DIR / "tool.py")
    tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tool)
    pcm = np.random.default_rng(1).standard_normal((100_000, 2)).astype(np.float32) + 0.2
    mean, std = tool.mix_stats(np, pcm, block=7777)
    mono = pcm.mean(axis=1)
    assert mean == pytest.approx(float(mono.mean()), abs=1e-5)
    assert std == pytest.approx(float(mono.std()), rel=1e-4)


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


@needs_ort
def test_six_stems_from_video_flac():
    (r,) = run_example(TOOL_DIR, 2)
    for k in ("vocals", "instrumental", "drums", "bass", "guitar", "piano", "other"):
        p = getattr(r.outputs, k).path
        assert p.suffix == ".flac" and p.stat().st_size > 1000

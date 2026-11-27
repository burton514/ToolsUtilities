import importlib.util
import json
from pathlib import Path

import pytest

from mediatool_sdk import InputError, speech
from mediatool_sdk.ffmpeg import find_binary
from mediatool_sdk.testing import run_example, run_tool

TOOL_DIR = Path(__file__).resolve().parent.parent
needs_vieneu = pytest.mark.skipif(importlib.util.find_spec("vieneu") is None, reason="cần vieneu")
needs_ffmpeg = pytest.mark.skipif(find_binary("ffmpeg") is None, reason="cần ffmpeg")
np = pytest.importorskip("numpy")
_spec = importlib.util.spec_from_file_location("speech_voice_add_tool", TOOL_DIR / "tool.py")
tool = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tool)


def test_pick_window_prefers_speech_and_avoids_clipping():
    sr = 8000
    rng = np.random.default_rng(0)
    quiet = rng.normal(0, 0.001, sr * 5).astype(np.float32)
    speechy = (0.3 * np.sin(np.arange(sr * 10) * 0.05) * (np.arange(sr * 10) // 1600 % 2)).astype(np.float32)
    clipped = np.clip(speechy * 10, -1, 1)
    wav = np.concatenate([quiet, clipped, speechy, quiet])
    a, b, st = tool.pick_window(wav, sr, 10.0)
    assert 14 * sr <= a <= 16 * sr, "chọn đoạn tiếng nói không bị vỡ"
    assert st["clip_ratio"] < 0.05 and st["voiced_s"] > 4


@needs_ffmpeg
def test_consent_required():
    with pytest.raises(InputError):
        run_tool(TOOL_DIR, inputs={"audio": str(TOOL_DIR / "samples" / "voice_sample.mp3")}, params={"name": "A", "consent": False})


@needs_vieneu
def test_profile_roundtrip_and_similarity():
    (r,) = run_example(TOOL_DIR, 1)
    prof = speech.read_profile(r.outputs.voice.path)
    assert prof["name"] == "Giọng mẫu" and prof["consent"]["confirmed"]
    assert len(prof["engines"]["v3turbo"]["speaker_emb"]) == 192
    assert prof["quality"]["similarity"] > 0.5
    wav, sr = speech.decode_flac(prof["reference"]["flac"])
    assert sr == 44100 and 3 < len(wav) / sr <= 10.5
    assert r.outputs.voice.path.name.isascii()
    json.dumps(prof)  # JSON thuần, truyền qua chuỗi được

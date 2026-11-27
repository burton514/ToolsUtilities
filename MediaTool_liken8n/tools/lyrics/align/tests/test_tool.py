import importlib.util
import json
from pathlib import Path

import pytest

from mediatool_sdk import InputError, timed
from mediatool_sdk.ffmpeg import find_binary
from mediatool_sdk.testing import run_example, run_tool

np = pytest.importorskip("numpy")
from mediatool_sdk import align  # noqa: E402

TOOL_DIR = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("lyrics_align_tool", TOOL_DIR / "tool.py")
tool = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tool)

needs_ort = pytest.mark.skipif(importlib.util.find_spec("onnxruntime") is None or find_binary("ffmpeg") is None,
                               reason="cần onnxruntime + ffmpeg (và model, tải lần đầu)")
TRUTH = json.loads((TOOL_DIR / "samples" / "truth.json").read_text(encoding="utf-8"))["items"]


def _emission(frames: int, vocab: dict[str, int], spikes: dict[int, str]) -> "np.ndarray":
    """Ma trận log-xác-suất dựng tay: khung nào có trong `spikes` thì ký tự đó gần chắc chắn, còn lại là '|' (nghỉ)."""
    em = np.full((frames, len(vocab)), np.log(1e-4), dtype=np.float32)
    em[:, vocab["|"]] = np.log(0.99)
    for f, c in spikes.items():
        em[f, :] = np.log(1e-4)
        em[f, vocab[c]] = np.log(0.99)
    return em


def test_ctc_alignment_finds_exact_frames():
    vocab = {"|": 0, "a": 1, "n": 2, "h": 3, "e": 4, "m": 5, "<pad>": 6}
    em = _emission(100, vocab, {10: "a", 11: "n", 12: "h", 50: "e", 51: "m"})
    ws = align.align(em, ["anh", "em"], vocab, pad="<pad>")
    assert [(w.label, w.start) for w in ws] == [("anh", 10), ("em", 50)]
    assert all(w.score > 0.9 for w in ws)


def test_emissions_chunking_is_seamless():
    # model giả: mỗi khung trả chỉ số khung tuyệt đối (qua giá trị mẫu) → ghép đoạn phải liền, đủ khung
    audio = np.repeat(np.arange(3000, dtype=np.float32), align.HOP)  # 3000 khung = 60 s

    def fake(x):
        n = (x.shape[1] - 400) // align.HOP + 1
        return x[:, : n * align.HOP: align.HOP][..., None].repeat(3, axis=2)

    em = align.emissions(fake, audio, chunk_s=7.0, context_s=1.0)
    assert em.shape[0] == 3000
    # mọi chỗ nối giữa các đoạn 7 s liền mạch; khung cuối cùng do lớp tích chập thiếu 1 khung → lặp khung trước
    assert np.array_equal(em[:-1, 0], np.arange(2999, dtype=np.float32))
    assert em[-1, 0] == em[-2, 0]


def test_lyric_lines_drop_section_marks_and_repeats():
    lines, rep = tool.lyric_lines(["[Verse 1]", "Chiều nay gió nhẹ", "", "ĐK:", "Điệp khúc 2:", "Ngày mai gặp nhau (x2)", "Chorus"])
    assert lines == ["Chiều nay gió nhẹ", "Ngày mai gặp nhau"] and rep == 1


def test_lyric_lines_drop_symbol_only_lines():
    assert tool.lyric_lines(["♪ ♪ ♪", "...", "Ôi tình yêu"])[0] == ["Ôi tình yêu"]


def test_align_rejects_lyrics_longer_than_audio():
    vocab = {"|": 0, "a": 1}
    em = _emission(5, vocab, {})
    with pytest.raises(ValueError, match="dài hơn"):
        align.align(em, ["aaaa", "aaaa"], vocab)


@pytest.mark.skipif(importlib.util.find_spec("sea_g2p") is None, reason="cần sea-g2p")
def test_spoken_words_keep_one_to_one_and_use_context():
    from mediatool_sdk import vi

    words = "Ngày 26/11 anh/em tình-yêu Don't 3000 IronMan ♪".split()
    spoken = vi.spoken_words(words)
    assert len(spoken) == len(words)
    assert spoken[1] == "hai mươi sáu tháng mười một", "có chữ 'ngày' đứng trước → đọc là ngày tháng, không phải phân số"
    assert spoken[2:5] == ["anh em", "tình yêu", "dont"]
    assert spoken[5:] == ["ba nghìn", "iron man", "♪"], "ký hiệu giữ nguyên ở đây — tool lọc theo bảng chữ của model"


def test_assemble_extends_words_until_next_and_caps_3s():
    ws = [align.Word("a", 0, 10, 1.0), align.Word("b", 20, 25, 1.0), align.Word("c", 400, 410, 0.5)]
    items = tool.assemble(["A B", "C"], [[["a"], ["b"]], [["c"]]], ws, n_frames=1000, offset=0.0)
    a, b = items[0]["children"]
    assert a["end"] == pytest.approx(0.4), "chữ kéo tới lúc chữ sau bắt đầu"
    assert b["end"] == pytest.approx(0.4 + 3.0), "tối đa 3 giây"
    assert items[1]["start"] == pytest.approx(8.0) and items[1]["confidence"] == 0.5


@pytest.mark.skipif(find_binary("ffmpeg") is None, reason="cần ffmpeg")
def test_needs_exactly_one_lyrics_source():
    media = str(TOOL_DIR / "samples" / "vocal_mix.mp3")
    with pytest.raises(InputError):
        run_tool(TOOL_DIR, inputs={"media": media}, params={})
    with pytest.raises(InputError):
        run_tool(TOOL_DIR, inputs={"media": media, "lyrics": str(TOOL_DIR / "samples" / "lyrics.txt"),
                                   "data": str(TOOL_DIR / "samples" / "truth.json")}, params={})


@pytest.mark.skipif(find_binary("ffmpeg") is None, reason="cần ffmpeg")
def test_malformed_json_is_input_error(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text('["Chiều nay gió nhẹ", "Em đi trong nắng"]', encoding="utf-8")
    with pytest.raises(InputError):
        run_tool(TOOL_DIR, inputs={"media": str(TOOL_DIR / "samples" / "vocal_mix.mp3"), "data": str(bad)}, params={})


@needs_ort
def test_wrong_lyrics_are_flagged(tmp_path):
    wrong = tmp_path / "wrong.txt"
    wrong.write_text("Một con vịt xòe ra hai cái cánh\nNó kêu rằng cáp cáp cáp\nGặp hồ nước nó bì bà bì bõm\n", encoding="utf-8")
    r = run_tool(TOOL_DIR, inputs={"media": str(TOOL_DIR / "samples" / "vocal_mix.mp3"), "lyrics": str(wrong)}, params={})
    assert json.loads(r.outputs.lyrics.path.read_text(encoding="utf-8"))["confidence"] < 0.5
    assert any("không phải của bài" in w for w in r.warnings), r.warnings


def _line_errors(r):
    items = json.loads(r.outputs.lyrics.path.read_text(encoding="utf-8"))["items"]
    assert [it["text"] for it in items] == [t["text"] for t in TRUTH], "bỏ dòng ghi chú, giữ đúng chữ gốc (kể cả '3000')"
    return [abs(it["start"] - t["start"]) for it, t in zip(items, TRUTH)], items


@needs_ort
def test_song_engine_matches_ground_truth():
    (r,) = run_example(TOOL_DIR, 1)
    errs, items = _line_errors(r)
    assert sum(errs) / len(errs) < 0.1 and max(errs) < 0.2, errs
    assert all(it["confidence"] > 0.8 for it in items)
    assert len(timed.parse_lrc(r.outputs.lrc.path.read_text(encoding="utf-8"))) == len(items), "LRC đọc lại được"


@needs_ort
def test_general_engine_close_too():
    (r,) = run_example(TOOL_DIR, 2)
    errs, _ = _line_errors(r)
    assert sum(errs) / len(errs) < 0.15 and max(errs) < 0.3, errs

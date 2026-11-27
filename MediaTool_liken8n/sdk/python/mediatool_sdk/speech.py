"""Giọng đọc tiếng Việt (VieNeu-TTS) — một nơi cho mọi tool đọc / lồng tiếng / lưu giọng.

Tool không gọi `vieneu` trực tiếp mà dùng module này, nên cách nạp model, chọn giọng, chia câu, ghép khoảng nghỉ,
đổi tốc độ, chuẩn hóa âm lượng… chỉ viết một lần:

- `load(ctx, model)` → `Speaker`: nạp VieNeu từ các file model đã tải theo `[[models]]` (danh mục `tools/_models/vieneu.toml`,
  đã kiểm sha256). Đặt `HF_HUB_OFFLINE=1`: không bao giờ tự tải gì từ mạng.
- `Speaker.say(texts, voice)` → mỗi câu một mảng âm thanh; `voice` là tên giọng có sẵn hoặc hồ sơ giọng (`VoiceProfile`).
- `script_units(text)` chia văn bản thành câu hiển thị + loại khoảng nghỉ; `join(...)` ghép câu với khoảng nghỉ tự nhiên
  (đo phần im lặng sẵn có ở hai đầu, chỉ chèn thêm phần thiếu — giống cách VieNeu ghép chunk).
- `stretch` đổi tốc độ giữ cao độ (Rubber Band qua ffmpeg), `finish` chuẩn hóa độ to EBU R128 hai lượt rồi ghi file.
- `make_profile` / `read_profile`: hồ sơ giọng JSON (clip mẫu + đặc trưng giọng cho từng model) — một asset `voice`
  truyền qua chuỗi như mọi file khác.
"""
from __future__ import annotations

import base64
import contextlib
import io
import json
import os
import re
import subprocess
import tempfile
import time
from importlib.util import find_spec
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Iterator

from . import ffmpeg as _ff
from .errors import InputError, ToolError

if TYPE_CHECKING:  # numpy chỉ import khi chạy (quy tắc: không import nặng ở đầu file)
    import numpy as np

    from .context import Context

# ---------------------------------------------------------------- model + giọng có sẵn
MODELS = {
    "turbo": "Chất lượng cao — 48 kHz, tự nhiên nhất (khuyên dùng)",
    "turbo_fast": "Nhanh — Turbo int8, nhanh ~1,6× (cần CPU có VNNI, không có thì tự dùng bản thường)",
    "nano": "Nhẹ — cho máy yếu / VPS, 24 kHz, đọc tiếng Anh kém hơn",
}
_ENGINE_KEY = {"turbo": "v3turbo", "turbo_fast": "v3turbo", "nano": "v3nano"}  # hồ sơ giọng dùng chung giữa turbo / turbo_fast
DEFAULT_VOICE = "Hải Đăng"
GAP_S = {"para": 0.70, "sentence": 0.50, "minor": 0.30}  # khoảng nghỉ tối thiểu theo loại ranh giới (theo VieNeu v3)
_TAG = re.compile(r"\[[^\]]{1,24}\]|<\|emotion_\d+\|>|</?en>")  # thẻ cảm xúc / đánh dấu tiếng Anh: đọc nhưng không hiện


def _assets_dir() -> Path | None:
    spec = find_spec("vieneu")
    if spec is None or not spec.submodule_search_locations:
        return None
    return Path(list(spec.submodule_search_locations)[0]) / "assets"


def preset_voices(model: str = "turbo") -> dict[str, dict[str, Any]]:
    """Giọng có sẵn của model: {tên: {description, gender, featured}} — đọc thẳng file giọng của gói vieneu, không nạp model."""
    d = _assets_dir()
    f = d / ("voices_v3_nano.json" if model == "nano" else "voices_v3_turbo.json") if d else None
    if not f or not f.is_file():
        return {}
    data = json.loads(f.read_text(encoding="utf-8"))
    return {n: {"description": v.get("description", ""), "gender": v.get("gender", ""), "featured": v.get("featured"),
                "aliases": v.get("aliases") or []} for n, v in data.get("presets", {}).items()}


def voice_choices() -> tuple[list[str], dict[str, str]]:
    """(enum, nhãn) cho tham số `voice`: giọng Turbo (⭐ tuyển chọn trước) rồi giọng chỉ có ở Nano."""
    turbo, nano = preset_voices("turbo"), preset_voices("nano")
    if not turbo:  # chưa cài vieneu (máy dev): vẫn sinh được schema
        return [DEFAULT_VOICE], {DEFAULT_VOICE: DEFAULT_VOICE}
    order = sorted(turbo, key=lambda n: (turbo[n]["featured"] is None, turbo[n]["featured"] or 0))
    labels = {}
    for n in order:
        star = "⭐ " if turbo[n]["featured"] else ""
        labels[n] = f"{star}{n} — {turbo[n]['description']}"
    for n, v in nano.items():
        if n not in turbo:
            order.append(n)
            labels[n] = f"{n} — {v['description']} (chỉ model Nhẹ)"
    return order, labels


def cpu_has_vnni() -> bool:
    """CPU có lệnh VNNI không — int8 của Turbo chỉ đúng trên CPU có VNNI, thiếu thì ra tiếng méo."""
    try:
        flags = Path("/proc/cpuinfo").read_text(errors="ignore")
        return "avx512_vnni" in flags or "avx_vnni" in flags
    except OSError:
        return False


# ---------------------------------------------------------------- hồ sơ giọng
PROFILE_FORMAT = "mediatool.voice"


def _np():
    import numpy as np

    return np


def encode_flac(wav: "np.ndarray", sr: int) -> str:
    import soundfile as sf

    buf = io.BytesIO()
    sf.write(buf, wav, sr, format="FLAC", subtype="PCM_16")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def decode_flac(b64: str) -> tuple["np.ndarray", int]:
    import soundfile as sf

    wav, sr = sf.read(io.BytesIO(base64.b64decode(b64)), dtype="float32", always_2d=False)
    return wav, sr


def make_profile(name: str, ref_wav: "np.ndarray", sr: int, *, description: str = "", denoise: bool = True,
                 engines: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "format": PROFILE_FORMAT, "version": 1, "name": name, "description": description,
        "consent": {"confirmed": True, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z")},
        "reference": {"sample_rate": sr, "seconds": round(len(ref_wav) / sr, 2), "denoise": denoise, "flac": encode_flac(ref_wav, sr)},
        "engines": engines or {},
    }


def read_profile(path: str | Path) -> dict[str, Any]:
    try:
        p = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise InputError("voice_file", f"Không đọc được hồ sơ giọng: {e}") from e
    if not isinstance(p, dict) or p.get("format") != PROFILE_FORMAT:
        raise InputError("voice_file", "File không phải hồ sơ giọng của MediaTool (tạo bằng tool 'Lưu giọng đọc')")
    return p


# ---------------------------------------------------------------- nạp model
@contextlib.contextmanager
def _local_codec(codec_dir: Path) -> Iterator[None]:
    """VieNeu Turbo (ONNX) tự lấy codec MOSS từ Hugging Face và không nhận đường dẫn cục bộ cho codec: trỏ bước lấy file đó
    vào thư mục codec đã tải + kiểm sha256. Mọi file khác (đồ thị, bộ mã hóa giọng, khử nhiễu) đã nhận đường dẫn cục bộ."""
    from vieneu._v3_turbo_engine import onnx_runtime_lite as orl

    original = orl.OnnxV3LiteEngine.__dict__["_fetch"]

    def fetch(repo: str, files: list[str], subfolder: str | None) -> Path:
        if repo != orl._CODEC_REPO:
            raise ToolError("MODEL_LAYOUT", f"VieNeu đòi tải thêm '{repo}' — bản vieneu không khớp danh mục model")
        missing = [f for f in files if not (codec_dir / f).is_file() and not f.endswith(".json")]
        if missing:
            raise ToolError("MODEL_LAYOUT", f"Thiếu file codec: {', '.join(missing)}")
        return codec_dir

    orl.OnnxV3LiteEngine._fetch = staticmethod(fetch)
    try:
        yield
    finally:
        orl.OnnxV3LiteEngine._fetch = original


class Speaker:
    """VieNeu đã nạp + các thao tác cần cho tool: đọc câu, lấy đặc trưng giọng từ clip mẫu."""

    def __init__(self, tts: Any, model: str):
        self.tts, self.model = tts, model
        self.sr: int = int(tts.sample_rate)
        self.engine_key = _ENGINE_KEY[model]

    # -- giọng
    def voice(self, name: str | None = None, profile: dict[str, Any] | None = None, *, warn: Callable[[str], None] | None = None) -> Any:
        """Giọng dùng cho `say`: hồ sơ giọng (ưu tiên) hoặc tên giọng có sẵn của model đang dùng."""
        if profile is not None:
            sec = (profile.get("engines") or {}).get(self.engine_key)
            if sec is None:  # hồ sơ chưa có đặc trưng cho model này: lấy lại từ clip mẫu đi kèm (vài giây)
                ref = profile.get("reference") or {}
                if not ref.get("flac"):
                    raise InputError("voice_file", "Hồ sơ giọng không có clip mẫu để dùng với model này")
                if warn:
                    warn(f"Hồ sơ '{profile.get('name')}' chưa có sẵn đặc trưng cho model {self.model}: đang lấy từ clip mẫu")
                wav, sr = decode_flac(ref["flac"])
                sec = self.enroll(wav, sr, denoise=bool(ref.get("denoise", True)))
            return self._voice_dict(sec)
        name = name or DEFAULT_VOICE
        resolve = getattr(self.tts, "resolve_voice_name", None)
        known = resolve(name) if resolve else (name if name in getattr(self.tts, "_preset_voices", {}) else None)
        if known is None and name == DEFAULT_VOICE and getattr(self.tts, "_default_voice", None):
            known = self.tts._default_voice  # giọng mặc định chung không có ở model này: dùng giọng mặc định của model
            if warn:
                warn(f"Model {self.model} không có giọng '{name}', dùng giọng mặc định '{known}'")
        if known is None:
            have = ", ".join(n for _, n in self.tts.list_preset_voices())
            raise InputError("voice", f"Model {self.model} không có giọng '{name}'. Giọng có sẵn: {have}")
        return known

    def _voice_dict(self, sec: dict[str, Any]) -> dict[str, Any]:
        np = _np()
        emb = np.asarray(sec["speaker_emb"], dtype=np.float32)
        if self.engine_key == "v3nano":
            st = np.asarray(sec["style"], dtype=np.float32)
            return {"speaker_emb": emb, "style": st, "codes": st}
        codes = sec.get("codes")
        return {"speaker_emb": emb, "codes": None if codes is None else np.asarray(codes, dtype=np.int64)}

    def enroll(self, wav: "np.ndarray", sr: int, *, denoise: bool = True) -> dict[str, Any]:
        """Đặc trưng giọng (JSON được) từ clip mẫu: khử nhiễu (tùy chọn), cắt im lặng hai đầu, x-vector + mã tham chiếu."""
        import soundfile as sf

        np = _np()
        with tempfile.TemporaryDirectory(prefix="mt_voice_") as d:
            p = Path(d) / "ref.wav"
            sf.write(str(p), wav, sr)
            emb, codes = self.tts.encode_reference(str(p), denoise=denoise)
        sec: dict[str, Any] = {"speaker_emb": [round(float(x), 6) for x in np.asarray(emb).reshape(-1)]}
        if self.engine_key == "v3nano":
            sec["style"] = [[round(float(x), 5) for x in row] for row in np.asarray(codes)]
        else:
            sec["codes"] = None if codes is None else np.asarray(codes, dtype=int).tolist()
        return sec

    # -- đọc
    def say(self, texts: list[str], voice: Any, *, temperature: float = 0.8, speed: float = 1.0, seed: int = 0,
            on_item: Callable[[int, int], None] | None = None, should_stop: Callable[[], bool] | None = None) -> list["np.ndarray"]:
        """Mỗi câu một mảng float32 mono (`self.sr`). Turbo: lấy mẫu theo `temperature`; Nano: `speed` đổi tốc độ ngay khi sinh.
        `seed` > 0 cho kết quả lặp lại được (cùng câu, cùng giọng → cùng âm thanh)."""
        np = _np()
        out = []
        for i, t in enumerate(texts):
            if should_stop and should_stop():
                break
            if seed:
                np.random.seed((seed + i) % (2**32))
            if self.engine_key == "v3nano":
                w = self.tts.infer(t, voice=voice, speed=speed, seed=(seed + i) if seed else None)
            else:
                w = self.tts.infer(t, voice=voice, temperature=temperature, top_k=25, top_p=0.95, repetition_penalty=1.2)
            out.append(np.asarray(w, dtype=np.float32).reshape(-1))
            if on_item:
                on_item(i + 1, len(texts))
        return out


def load(ctx: "Context", model: str = "turbo") -> Speaker:
    """Nạp VieNeu từ model đã tải theo `[[models]]` (lần đầu core tải + kiểm sha256). Luôn chạy ONNX trên CPU."""
    if find_spec("vieneu") is None:
        raise ToolError("MISSING_PACKAGE", "Máy chạy tool chưa cài vieneu (pip install --no-deps vieneu + sea-g2p soundfile soxr kaldi-native-fbank tokenizers)")
    if model not in MODELS:
        raise InputError("model", f"Model không hợp lệ: {model}")
    os.environ["HF_HUB_OFFLINE"] = "1"  # chỉ dùng file đã kiểm, không tự tải
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    threads = int(os.environ.get("MEDIATOOL_TTS_THREADS", "0") or 0)
    from vieneu import Vieneu

    if model == "nano":
        d = ctx.models.get("vieneu_v3_nano")
        return Speaker(Vieneu(mode="v3nano", onnx_dir=str(d), threads=threads), model)
    if model == "turbo_fast" and not cpu_has_vnni():
        ctx.log.warning("CPU không có VNNI: bản int8 sẽ ra tiếng méo, dùng bản Turbo thường thay thế")
        model = "turbo"
    base = ctx.models.get("vieneu_v3_turbo")
    graphs = ctx.models.get("vieneu_v3_turbo_int8") / "onnx_int8" if model == "turbo_fast" else base / "onnx_update"
    with _local_codec(base / "codec"):
        tts = Vieneu(mode="v3turbo", backbone_repo=str(base), onnx_dir=str(graphs), backend="onnx", threads=threads)
    return Speaker(tts, model)


# ---------------------------------------------------------------- văn bản → câu
def display_text(s: str) -> str:
    """Chữ để hiện (phụ đề): bỏ thẻ cảm xúc / đánh dấu, gộp khoảng trắng."""
    t = re.sub(r"\s+", " ", _TAG.sub("", s)).strip()
    return re.sub(r"\s+([.,!?;:…])", r"\1", t)


def script_units(text: str) -> list[dict[str, str]]:
    """Văn bản → các câu [{text (đọc), display (hiện), gap (loại nghỉ SAU câu: para|sentence|minor|end)}].
    Tách câu bằng bộ tách của VieNeu (hiểu ngoặc kép, viết tắt); mỗi dòng trống / xuống dòng là một đoạn."""
    from vieneu_utils.core_utils import split_into_sentences

    units: list[dict[str, str]] = []
    paras = [p.strip() for p in re.split(r"\n\s*\n|\r?\n", text) if p.strip()]
    for p in paras:
        sents = [s.strip() for s in split_into_sentences(p) if s.strip()] or [p]
        for j, s in enumerate(sents):
            last = j == len(sents) - 1
            gap = "para" if last else ("sentence" if s.rstrip("\"'”’)]").endswith((".", "!", "?", "…")) else "minor")
            if display_text(s) or _TAG.search(s):
                units.append({"text": s, "display": display_text(s), "gap": gap})
    if units:
        units[-1]["gap"] = "end"
    return units


# ---------------------------------------------------------------- âm thanh
def edge_silence(wav: "np.ndarray", sr: int, thresh_db: float = -45.0) -> tuple[int, int]:
    """Số mẫu im lặng ở đầu và cuối (đường bao |x| trung bình cửa sổ 10 ms dưới ngưỡng)."""
    np = _np()
    n = max(1, int(0.01 * sr))
    if wav.size < n:
        return wav.size, 0
    env = np.convolve(np.abs(wav), np.ones(n, dtype=np.float32) / n, mode="same")
    loud = np.flatnonzero(env > 10 ** (thresh_db / 20))
    if loud.size == 0:
        return wav.size, 0
    return int(loud[0]), int(wav.size - 1 - loud[-1])


def trim(wav: "np.ndarray", sr: int, keep_s: float = 0.04, fade_s: float = 0.012) -> "np.ndarray":
    """Cắt im lặng thừa hai đầu (giữ lại keep_s) + fade cosine ngắn để mép không lách cách."""
    np = _np()
    lead, tail = edge_silence(wav, sr)
    if lead >= wav.size:
        return wav[:0]
    k = int(keep_s * sr)
    out = np.array(wav[max(0, lead - k): wav.size - max(0, tail - k)], dtype=np.float32)
    f = min(int(fade_s * sr), out.size // 2)
    if f > 0:
        ramp = (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, f))).astype(np.float32)
        out[:f] *= ramp
        out[-f:] *= ramp[::-1]
    return out


def join(wavs: list["np.ndarray"], sr: int, gaps: list[str], pause: float = 1.0) -> tuple["np.ndarray", list[tuple[float, float]]]:
    """Ghép câu, khoảng nghỉ giữa câu i và i+1 đạt GAP_S[gaps[i]] × pause (tính cả im lặng sẵn có ở đuôi / đầu hai câu,
    chỉ chèn phần còn thiếu). Trả (âm thanh, [(bắt đầu, kết thúc) phần có tiếng của từng câu, giây])."""
    np = _np()
    parts, spans, pos = [], [], 0
    for i, w in enumerate(wavs):
        if i:
            want = GAP_S.get(gaps[i - 1], GAP_S["sentence"]) * pause
            _, tail = edge_silence(wavs[i - 1], sr)
            lead, _ = edge_silence(w, sr)
            pad = max(0, int(want * sr) - tail - lead)
            if pad:
                parts.append(np.zeros(pad, dtype=np.float32))
                pos += pad
        lead, tail = edge_silence(w, sr)
        spans.append(((pos + min(lead, w.size)) / sr, (pos + max(lead, w.size - tail)) / sr))
        parts.append(w)
        pos += w.size
    return (np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)), spans


def _run(args: list[str], data: bytes | None = None) -> bytes:
    exe = _ff.find_binary("ffmpeg") or "ffmpeg"
    r = subprocess.run([exe, "-hide_banner", "-nostdin", *args], input=data, capture_output=True)
    if r.returncode != 0:
        raise ToolError("FFMPEG_FAILED", r.stderr.decode(errors="replace")[-600:])
    return r.stdout


def read_audio(path: str | Path, sr: int, start: float = 0.0, duration: float = 0.0) -> "np.ndarray":
    """Giải mã bất kỳ file audio / video nào thành mono float32 ở `sr` — dùng chung `mediatool_sdk.ffmpeg.read_pcm`."""
    return _ff.read_pcm(path, sr, start, duration)


_has_rubberband: bool | None = None


def _rubberband() -> bool:
    global _has_rubberband
    if _has_rubberband is None:
        try:
            _has_rubberband = b" rubberband " in _run(["-filters"])
        except ToolError:
            _has_rubberband = False
    return _has_rubberband


def stretch(wav: "np.ndarray", sr: int, factor: float) -> "np.ndarray":
    """Đổi tốc độ đọc `factor` lần (>1 nhanh hơn) mà giữ nguyên cao độ và âm sắc.
    Rubber Band (GPL, giữ formant — tự nhiên nhất) nếu bản FFmpeg có; không thì `atempo` của FFmpeg (LGPL) — phương án
    thay thế theo docs/ENGINES.md cho bản phân phối không kèm GPL."""
    np = _np()
    if abs(factor - 1.0) < 0.005 or wav.size == 0:
        return wav
    if _rubberband():
        f = f"rubberband=tempo={factor:.5f}:pitch=1:formant=preserved:pitchq=quality:transients=mixed:window=standard"
    else:
        f = f"atempo={factor:.5f}"  # 0,5–2,0 đủ cho mọi tool (giới hạn tốc độ 0,7–1,6)
    raw = _run(["-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "pipe:0", "-af", f, "-f", "f32le", "pipe:1"], wav.astype(np.float32).tobytes())
    return np.frombuffer(raw, dtype=np.float32).copy()


LOUDNESS = {"speech": -16.0, "broadcast": -23.0, "none": None}


def finish(wav: "np.ndarray", sr: int, out: Path, loudness: str = "speech", out_sr: int = 48000) -> Path:
    """Ghi file cuối: chuẩn hóa độ to EBU R128 hai lượt (đo rồi chỉnh tuyến tính, đỉnh thật ≤ −1,5 dBTP), đổi về `out_sr`.
    Đuôi file quyết định định dạng (.wav PCM 24-bit / .mp3 / .m4a)."""
    np = _np()
    pcm = np.clip(wav, -1.0, 1.0).astype(np.float32).tobytes()
    src = ["-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "pipe:0"]
    target = LOUDNESS.get(loudness)
    filt = f"aresample={out_sr}:resampler=soxr:precision=28"
    if target is not None and wav.size > sr * 0.4:
        base = f"loudnorm=I={target}:TP=-1.5:LRA=11"
        # lượt 1: đo (loudnorm in kết quả JSON ra stderr)
        r = subprocess.run([_ff.find_binary("ffmpeg") or "ffmpeg", "-hide_banner", "-nostdin", *src, "-af", base + ":print_format=json",
                            "-f", "null", "-"], input=pcm, capture_output=True)
        t = r.stderr.decode(errors="replace")
        try:
            m = json.loads(t[t.rindex("{"): t.rindex("}") + 1])
        except ValueError:
            m = {}
        # lượt 2: chỉnh tuyến tính theo số đo (giữ nguyên động thái giọng, không nén)
        if m and float(m.get("input_i", "-inf")) > -70:
            filt = (f"{base}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
                    f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true,{filt}")
    codec = {".mp3": ["-c:a", "libmp3lame", "-q:a", "2"], ".m4a": ["-c:a", "aac", "-b:a", "192k"]}.get(out.suffix.lower(), ["-c:a", "pcm_s24le"])
    _run(["-y", *src, "-af", filt, "-ac", "1", *codec, str(out)], pcm)
    return out

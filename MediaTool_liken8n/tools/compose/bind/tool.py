"""compose_bind — chèn chữ chạy theo thời gian (phụ đề, phụ đề TikTok, karaoke, lời bài hát) lên video.

Đọc dữ liệu có thời gian (SRT, VTT, LRC, hoặc JSON transcript/TimedData) bằng `mediatool_sdk.timed`, mỗi câu sinh
một lớp chữ với kiểu + chuyển động theo phong cách đã chọn, rồi render bằng engine (`mediatool_sdk.compose`).
Trả cả video lẫn bản dựng, để sửa tiếp (`compose_edit`) hoặc dựng lại (`compose_render`).
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from mediatool_sdk import AudioFile, BaseTool, Composition, Context, InputError, JsonData, Result, SubtitleFile, VideoFile
from mediatool_sdk import compose, timed

STYLES = {
    "subtitle": "Phụ đề thường (chữ trắng viền đen)",
    "tiktok": "Phụ đề TikTok (từng từ bật lên, từ đang nói đổi màu)",
    "karaoke": "Karaoke (chữ đổi màu chạy theo lời)",
    "lyric": "Lời bài hát nghệ thuật (chữ to, hiện từng chữ cái)",
    "cinema": "Điện ảnh (chữ có chân, nhẹ nhàng)",
}
POS = {"bottom": 0.84, "middle": 0.5, "top": 0.14}


class Inputs(BaseModel):
    video: VideoFile | None = Field(None, description="Video nền (bỏ trống thì dùng nền màu, kèm nhạc nếu có)")
    audio: AudioFile | None = Field(None, description="Tiếng thêm vào: giọng đọc / thuyết minh / nhạc nền (có video thì trộn cùng tiếng gốc)")
    subtitle: SubtitleFile | None = Field(None, description="File thời gian: phụ đề .srt/.vtt hoặc lời bài hát .lrc")
    data: JsonData | None = Field(None, description="Dữ liệu thời gian dạng JSON (kết quả phiên âm, căn lời…) thay cho file phụ đề")


class Params(BaseModel):
    style: Literal["subtitle", "tiktok", "karaoke", "lyric", "cinema"] = Field(
        "subtitle", description="Phong cách chữ", json_schema_extra={"x-labels": STYLES})
    position: Literal["bottom", "middle", "top"] = Field(
        "bottom", description="Vị trí chữ trên khung", json_schema_extra={"x-labels": {"bottom": "Dưới", "middle": "Giữa", "top": "Trên"}})
    size: int = Field(0, ge=0, le=220, description="Cỡ chữ (theo khung cao 1080); 0 = tự chọn theo phong cách")
    color: str = Field("#FFFFFF", pattern=r"^#[0-9A-Fa-f]{6}$", description="Màu chữ, dạng #RRGGBB")
    highlight: str = Field("#FFD400", pattern=r"^#[0-9A-Fa-f]{6}$", description="Màu nhấn (từ đang nói, karaoke), dạng #RRGGBB")
    ratio: Literal["16:9", "9:16", "1:1"] = Field("16:9", description="Khung hình khi không có video nền", json_schema_extra={"x-labels": {"16:9": "16:9 — ngang (YouTube)", "9:16": "9:16 — dọc (TikTok, Reels)", "1:1": "1:1 — vuông"}})
    background: str = Field("#101018", pattern=r"^#[0-9A-Fa-f]{6}$", description="Màu nền khi không có video nền")
    video_volume: int = Field(100, ge=0, le=100, description="Âm lượng tiếng gốc của video (%), ví dụ 20 khi thêm giọng thuyết minh")
    quality: Literal["draft", "standard", "high"] = Field("standard", description="Chất lượng video", json_schema_extra={"x-labels": {"draft": "Nháp — nhanh để xem thử", "standard": "Chuẩn", "high": "Cao — đẹp nhất, chậm hơn"}})


class Outputs(BaseModel):
    video: VideoFile = Field(description="Video đã chèn chữ")
    composition: Composition = Field(description="Bản dựng tương ứng — sửa tiếp bằng compose_edit hoặc mở trong trình Dựng video")


def _units(item: dict[str, Any]) -> list[dict[str, Any]]:
    """Thời gian từng từ: lấy từ dữ liệu nếu có, không thì chia đều theo số từ."""
    if item.get("children"):
        return item["children"]
    words = item["text"].split()
    if not words:
        return []
    step = (item["end"] - item["start"]) / len(words)
    return [{"start": item["start"] + i * step, "end": item["start"] + (i + 1) * step, "text": w} for i, w in enumerate(words)]


def _spans(text: str, units: list[dict[str, Any]], color: str, end: float, mode: str) -> list[dict[str, Any]]:
    """Đổi màu từng từ theo thời gian: karaoke = từ đã hát giữ màu nhấn; tiktok = chỉ từ đang nói."""
    spans, pos, chars = [], 0, list(text)
    for u in units:
        w = list(u["text"])
        # tìm từ trong chuỗi (theo ký tự Unicode) bắt đầu từ vị trí hiện tại
        i = next((k for k in range(pos, len(chars) - len(w) + 1) if chars[k:k + len(w)] == w), None)
        if i is None:
            continue
        pos = i + len(w)
        spans.append({"start": i, "end": pos, "style": {"fill": color},
                      "timing": {"start": u["start"], "end": end if mode == "karaoke" else u["end"]}})
    return spans


class ComposeBindTool(BaseTool[Inputs, Params, Outputs]):
    def check(self, ctx: Context) -> None:
        compose.require_engine()
        ctx.require_binary("ffprobe")

    def validate(self, inputs: Inputs, params: Params, ctx: Context) -> None:
        if (inputs.subtitle is None) == (inputs.data is None):
            raise InputError("subtitle", "Hãy đưa MỘT nguồn thời gian: file phụ đề/lời (.srt, .vtt, .lrc) hoặc dữ liệu JSON")

    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        src = inputs.subtitle or inputs.data
        items = [it for it in timed.load(src.path) if it.get("text") and it["end"] > it["start"]]
        if not items:
            raise InputError("subtitle" if inputs.subtitle else "data", "Không đọc được câu nào có thời gian trong file")
        ctx.progress(0.05, f"Đọc được {len(items)} câu")

        end = max(it["end"] for it in items) + 0.5
        if inputs.video:
            info = compose.probe(inputs.video.path)
            duration = max(info["duration_s"], 0.1)
            comp = compose.composition(info["width"], info["height"], fps=info["fps"] or 30, duration=duration)
            comp["layers"].append(compose.media_layer(inputs.video.path, "video", 0, duration, id="background", fit="cover",
                                                      volume=params.video_volume, muted=params.video_volume == 0))
            if inputs.audio:
                adur = compose.probe(inputs.audio.path)["duration_s"]
                if adur > duration + 0.05:
                    ctx.log.warning(f"Audio dài hơn video {adur - duration:.1f} giây — phần thừa bị cắt theo độ dài video")
                comp["layers"].append(compose.media_layer(inputs.audio.path, "audio", 0, min(adur, duration), id="voice"))
        else:
            w, h = {"16:9": (1920, 1080), "9:16": (1080, 1920), "1:1": (1080, 1080)}[params.ratio]
            duration = end
            if inputs.audio:
                duration = max(compose.probe(inputs.audio.path)["duration_s"], end)
            comp = compose.composition(w, h, duration=duration, background=params.background)
            if inputs.audio:
                comp["layers"].append(compose.media_layer(inputs.audio.path, "audio", 0, duration, id="music"))

        s = params.style
        base_size = {"subtitle": 60, "tiktok": 92, "karaoke": 78, "lyric": 110, "cinema": 56}[s]
        size = params.size or base_size
        y = POS[params.position]
        for n, it in enumerate(items):
            start, stop = max(0.0, it["start"]), min(it["end"], duration)
            if stop <= start:
                continue
            style: dict[str, Any] = {"size": size, "fill": params.color, "weight": 800}
            extra: dict[str, Any] = {"strokes": [{"color": "#000000", "width": 4}], "shadows": [{"color": "#00000099", "x": 2, "y": 3, "blur": 6}]}
            anims: list[dict[str, Any]] = [{"preset": "fade", "kind": "in", "duration": 0.15}, {"preset": "fade", "kind": "out", "duration": 0.15}]
            spans: list[dict[str, Any]] = []
            if s == "tiktok":
                style.update(weight=900, case="upper")
                extra["strokes"] = [{"color": "#000000", "width": 8}]
                anims = [{"preset": "pop", "kind": "in", "unit": "word", "duration": min(0.6, (stop - start) * 0.8)}]
                spans = _spans(it["text"].upper(), _units({**it, "text": it["text"].upper()}), params.highlight, stop, "tiktok")
            elif s == "karaoke":
                spans = _spans(it["text"], _units(it), params.highlight, stop, "karaoke")
                anims = [{"preset": "fade_up", "kind": "in", "duration": 0.25}, {"preset": "fade", "kind": "out", "duration": 0.2}]
            elif s == "lyric":
                style.update(weight=900)
                extra["shadows"] = [{"kind": "glow", "color": params.highlight + "AA", "blur": 26}]
                anims = [{"preset": "rise", "kind": "in", "unit": "char", "duration": min(1.0, (stop - start) * 0.5)},
                         {"preset": "blur_out", "kind": "out", "duration": 0.35}]
            elif s == "cinema":
                style.update(font="Noto Serif", weight=500, italic=True)
                extra = {"shadows": [{"color": "#000000CC", "x": 0, "y": 2, "blur": 8}]}
                anims = [{"preset": "fade", "kind": "in", "duration": 0.4}, {"preset": "fade", "kind": "out", "duration": 0.4}]
            layer = compose.text_layer(it["text"], start, stop - start, id=f"line{n}", style=style, y=y, animations=anims, **extra)
            if spans:
                layer["spans"] = spans
            comp["layers"].append(layer)

        comp_file = Composition.write(ctx.workdir / "composition.json", comp)
        out = compose.render(comp, ctx.workdir / "video.mp4", ctx, params.quality, progress_range=(0.08, 0.99))
        video = VideoFile(path=out)
        return Result(outputs=Outputs(video=video, composition=comp_file),
                      summary=f"Đã chèn {len(items)} câu ({STYLES[s].split(' (')[0].lower()}) vào video {video.duration_text}")

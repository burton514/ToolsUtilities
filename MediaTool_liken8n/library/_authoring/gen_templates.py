"""Sinh các mẫu dựng sẵn mặc định: library/templates/<id>/template.json.

Mẫu là DỮ LIỆU: một bản dựng (composition, khung 1920×1080) có chỗ trống `{{tên}}` + danh sách chỗ trống (`slots`).
Lớp có `"_requires": "<slot>"` bị bỏ khi chỗ trống đó không được điền (ví dụ ảnh nền). Tool `compose_template` điền
và xuất; thêm mẫu mới = thêm một thư mục, không sửa code.

    py library/_authoring/gen_templates.py
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1] / "templates"

def text(id, t, y, size, start, dur, **kw):
    style = {"font": "Noto Sans", "weight": 900, "size": size, "fill": "#FFFFFF", "align": "center", "max_width": 0.86}
    style.update(kw.pop("style", {}))
    return {"id": id, "name": id, "type": "text", "text": t, "x": kw.pop("x", 0.5), "y": y, "start": start, "duration": dur, "style": style, **kw}

def shape(id, x, y, w, h, fill, start, dur, **kw):
    return {"id": id, "name": id, "type": "shape", "shape": kw.pop("shape", "rect"), "x": x, "y": y, "w": w, "h": h, "fill": fill,
            "corner_radius": kw.pop("radius", 0), "start": start, "duration": dur, **kw}

def bg_media(dur, slot):
    return {"id": f"bg_{slot}", "name": "Nền", "type": "image" if slot == "image" else "video", "source": "{{" + slot + "}}",
            "fit": "cover", "start": 0, "duration": dur, "_requires": slot,
            **({"trim_start": 0, "volume": 100, "muted": False} if slot == "video" else {}),
            "effects": [{"type": "dim", "amount": 35}]}

def comp(dur, layers, bg="#101018"):
    return {"version": 1, "canvas": {"width": 1920, "height": 1080, "fps": 30, "background": bg}, "duration": dur, "layers": layers}

COMMON = {
    "image": {"label": "Ảnh nền", "kind": "image"},
    "video": {"label": "Video nền", "kind": "video"},
    "accent": {"label": "Màu nhấn", "default": "#FFC83D"},
}

T = []

T.append({
    "id": "title_card", "name": "Màn tiêu đề", "description": "Tiêu đề to bật lên giữa khung, dòng phụ hiện dần, vạch màu quét ngang. Hợp làm mở đầu video.",
    "output": "video", "duration": 4,
    "slots": {"title": {"label": "Tiêu đề", "default": "Tiêu đề video"}, "subtitle": {"label": "Dòng phụ", "default": "Dòng mô tả ngắn"}, **COMMON},
    "composition": comp(4, [
        shape("bg", 0.5, 0.5, 1, 1, {"type": "radial", "stops": ["#2A2350", "#0B0B14"], "cx": 0.5, "cy": 0.45, "r": 0.8}, 0, 4),
        bg_media(4, "image"), bg_media(4, "video"),
        text("title", "{{title}}", 0.44, 150, 0.2, 3.8, strokes=[{"color": "#000000", "width": 4}], shadows=[{"color": "#00000099", "x": 0, "y": 8, "blur": 16}],
             animations=[{"preset": "pop_bounce", "kind": "in", "duration": 0.7}, {"preset": "fade", "kind": "out", "duration": 0.4}]),
        shape("bar", 0.5, 0.56, 0.22, 0.008, "{{accent}}", 0.6, 3.4, radius=4,
              animations=[{"preset": "wipe_right", "kind": "in", "duration": 0.5}, {"preset": "fade", "kind": "out", "duration": 0.4}]),
        text("subtitle", "{{subtitle}}", 0.64, 56, 0.9, 3.1, style={"weight": 500, "fill": "#E8E8F0"},
             animations=[{"preset": "fade_up", "kind": "in", "duration": 0.6}, {"preset": "fade", "kind": "out", "duration": 0.4}]),
    ]),
})

T.append({
    "id": "lower_third", "name": "Dải tên (lower third)", "description": "Dải màu trượt vào góc dưới trái kèm tên và chức danh — đặt lên video phỏng vấn, giới thiệu nhân vật.",
    "output": "video", "duration": 5,
    "slots": {"title": {"label": "Tên", "default": "Nguyễn Văn A"}, "subtitle": {"label": "Chức danh", "default": "Đạo diễn"}, **COMMON},
    "composition": comp(5, [
        bg_media(5, "video"), bg_media(5, "image"),
        shape("plate", 0.27, 0.8, 0.42, 0.13, "#101018E6", 0.3, 4.4, radius=10,
              animations=[{"preset": "slide_right", "kind": "in", "duration": 0.5}, {"preset": "slide_left", "kind": "out", "duration": 0.4}]),
        shape("accent_bar", 0.065, 0.8, 0.008, 0.13, "{{accent}}", 0.45, 4.25,
              animations=[{"preset": "wipe_down", "kind": "in", "duration": 0.35}, {"preset": "fade", "kind": "out", "duration": 0.3}]),
        text("title", "{{title}}", 0.775, 54, 0.6, 4.1, x=0.29, style={"align": "left", "max_width": 0.38},
             animations=[{"preset": "fade_right", "kind": "in", "duration": 0.4}, {"preset": "fade", "kind": "out", "duration": 0.3}]),
        text("subtitle", "{{subtitle}}", 0.835, 34, 0.75, 3.95, x=0.29, style={"align": "left", "weight": 500, "fill": "{{accent}}", "max_width": 0.38},
             animations=[{"preset": "fade_right", "kind": "in", "duration": 0.4}, {"preset": "fade", "kind": "out", "duration": 0.3}]),
    ], bg="#000000"),
})

T.append({
    "id": "countdown", "name": "Đếm ngược 3-2-1", "description": "Số 3, 2, 1 đập theo từng giây trên vòng tròn màu, rồi hiện chữ bắt đầu.",
    "output": "video", "duration": 4,
    "slots": {"title": {"label": "Chữ sau khi đếm", "default": "BẮT ĐẦU!"}, **COMMON},
    "composition": comp(4, [
        shape("bg", 0.5, 0.5, 1, 1, {"type": "radial", "stops": ["#1E1B4B", "#05050A"], "cx": 0.5, "cy": 0.5, "r": 0.75}, 0, 4),
        bg_media(4, "image"),
        shape("ring", 0.5, 0.5, 0.3, 0.533, "#00000000", 0, 3, shape="circle", strokes=[{"color": "{{accent}}", "width": 10}],
              animations=[{"preset": "pulse", "kind": "loop", "period": 1.0}]),
        *[text(f"n{n}", str(n), 0.5, 300, 3 - n, 1, animations=[{"preset": "punch", "kind": "emphasis", "duration": 0.5}, {"preset": "fade", "kind": "out", "duration": 0.2}])
          for n in (3, 2, 1)],
        text("title", "{{title}}", 0.5, 160, 3, 1, strokes=[{"color": "#000000", "width": 6}], shadows=[{"kind": "glow", "color": "{{accent}}", "blur": 30}],
             animations=[{"preset": "zoom_out", "kind": "in", "duration": 0.4}]),
    ]),
})

T.append({
    "id": "quote", "name": "Trích dẫn", "description": "Câu trích dẫn chữ có chân hiện từng từ, tên tác giả bên dưới — hợp chia sẻ câu nói hay.",
    "output": "video", "duration": 7,
    "slots": {"title": {"label": "Câu trích dẫn", "default": "Hành trình vạn dặm bắt đầu từ một bước chân."}, "subtitle": {"label": "Tác giả", "default": "Lão Tử"}, **COMMON},
    "composition": comp(7, [
        shape("bg", 0.5, 0.5, 1, 1, {"type": "linear", "stops": ["#2B1D14", "#120C08"], "angle": 90}, 0, 7),
        bg_media(7, "image"),
        text("mark", "“", 0.2, 260, 0.2, 6.8, style={"font": "Noto Serif", "fill": "{{accent}}"}, animations=[{"preset": "fade", "kind": "in", "duration": 0.6}]),
        text("title", "{{title}}", 0.46, 84, 0.5, 6.3, style={"font": "Noto Serif", "weight": 600, "italic": True, "max_width": 0.74},
             animations=[{"preset": "fade_up", "kind": "in", "unit": "word", "duration": 2.0}, {"preset": "fade", "kind": "out", "duration": 0.5}]),
        text("subtitle", "— {{subtitle}}", 0.72, 44, 2.6, 4.2, style={"weight": 500, "fill": "{{accent}}"},
             animations=[{"preset": "fade", "kind": "in", "duration": 0.6}, {"preset": "fade", "kind": "out", "duration": 0.5}]),
    ]),
})

T.append({
    "id": "thumbnail", "name": "Ảnh thumbnail", "description": "Ảnh bìa video: ảnh nền làm tối, tiêu đề cực to kiểu sticker viền trắng, nhãn màu nhấn góc trên.",
    "output": "image", "duration": 1,
    "slots": {"title": {"label": "Tiêu đề", "default": "TIÊU ĐỀ SIÊU HOT"}, "subtitle": {"label": "Nhãn góc", "default": "MỚI"}, **COMMON},
    "composition": comp(1, [
        shape("bg", 0.5, 0.5, 1, 1, {"type": "linear", "stops": ["#FF3D7F", "#7C4DFF"], "angle": 30}, 0, 1),
        bg_media(1, "image"),
        shape("shade", 0.5, 0.75, 1, 0.5, {"type": "linear", "stops": ["#00000000", "#000000CC"], "angle": 90}, 0, 1),
        text("title", "{{title}}", 0.72, 170, 0, 1, x=0.5, style={"fill": "{{accent}}", "case": "upper", "max_width": 0.92},
             strokes=[{"color": "#000000", "width": 6}, {"color": "#FFFFFF", "width": 16}], shadows=[{"color": "#000000AA", "x": 8, "y": 12, "blur": 10}]),
        shape("tag", 0.12, 0.12, 0.16, 0.1, "{{accent}}", 0, 1, radius=14, rotation=-6),
        text("subtitle", "{{subtitle}}", 0.12, 56, 0, 1, x=0.12, rotation=-6, style={"fill": "#101018", "max_width": 0.15}),
    ]),
})

def main():
    for t in T:
        d = ROOT / t["id"]
        d.mkdir(parents=True, exist_ok=True)
        (d / "template.json").write_text(json.dumps(t, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(T)} mẫu → {ROOT}")

if __name__ == "__main__":
    main()

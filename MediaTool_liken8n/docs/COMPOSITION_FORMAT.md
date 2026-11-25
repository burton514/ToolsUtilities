# Composition — định dạng dựng hình, chữ nghệ thuật và animation

> Composition là "bản dựng" của một video: nhiều **lớp** (video, ảnh, chữ, hình, âm thanh) xếp chồng, mỗi lớp **hiện trong một khoảng thời gian**, có **vị trí**, **kiểu dáng** và **chuyển động**.
>
> - Là một asset `format = "composition"`, lưu dạng JSON. Là **dữ liệu**, chưa phải video: chỉ engine render (`compose_render`, xem trước của editor) biến nó thành hình.
> - Editor, tool, chuỗi tự động, MCP cho AI đều đọc/sửa **cùng một định dạng** này.
> - Nguồn chuẩn: engine Rust `core/crates/engine/src/model.rs` (kiểu dữ liệu) và `prepare.rs` (chuẩn hóa + giải mốc thời gian). Phía editor: `packages/editor/src/model.ts`.

## 0. Nguyên tắc: viết một lần, dùng mọi nơi

Các **thành phần cơ bản** dưới đây được định nghĩa **một lần** và gắn được cho **mọi loại lớp**. Thêm một kiểu bóng, một preset chuyển động… là mọi lớp và mọi nơi (editor, tool, AI) có ngay.

| Thành phần | Dùng ở |
|---|---|
| `Timing` / `TimeRef` — thời gian đầu/cuối, neo theo mốc | lớp · từng chuyển động · từng hiệu ứng · từng đoạn chữ |
| `Fill` — màu đơn, chuyển màu thẳng/tròn/xoay vòng, ảnh họa tiết | chữ · hình · viền · nền chữ |
| `Stroke[]` — nhiều lớp viền, mỗi lớp tô bằng `Fill` | mọi lớp (chữ/hình: viền vector; ảnh/video: viền theo hình dạng điểm ảnh) |
| `Shadow[]` — đổ bóng, phát sáng, neon, bóng dài, nổi khối 3D | mọi lớp |
| `Effect[]` — chỉnh màu, làm mờ… có thời gian riêng | mọi lớp |
| `Anim[]` — chuyển động: preset + thời gian + đơn vị (cả lớp / dòng / từ / chữ cái) + phần được chọn | mọi lớp (chia dòng/từ/chữ cái: lớp chữ) |
| `keyframes` theo đường dẫn bất kỳ | mọi thuộc tính số hoặc màu |

Engine chạy `prepare()` **một lần** trước khi render (xem trước, xuất video, API `POST /v1/composition/prepare` dùng chung): chuyển bản dựng dạng cũ sang dạng mới và giải mọi mốc thời gian ra giây.

---

## 1. Ví dụ

Tên bài hiện sau logo 1 giây, chữ cái trồi lên lần lượt; trong điệp khúc chữ "50%" đập theo từng beat; từ giây 12 video chuyển đen trắng trong 2 giây.

```json
{
  "version": 1,
  "canvas": { "width": 1920, "height": 1080, "fps": 30, "background": "#000000" },
  "markers": [
    { "id": "chorus", "label": "Điệp khúc", "start": 10, "end": 20, "kind": "section" },
    { "start": 10.0, "kind": "beat" }, { "start": 10.5, "kind": "beat" }, { "start": 11.0, "kind": "beat" }
  ],
  "layers": [
    { "id": "bg", "type": "video", "source": "asset:v_3", "start": 0, "duration": 30, "fit": "cover",
      "effects": [ { "type": "grayscale", "amount": 100, "timing": { "start": 12, "duration": 2 }, "ramp": 0.3 } ] },
    { "id": "logo", "type": "image", "source": "asset:i_5", "start": 0, "duration": 3, "x": 0.9, "y": 0.1, "scale": 0.15 },
    { "id": "title", "type": "text", "text": "GIẢM 50% hôm nay",
      "timing": { "start": { "ref": "layer:logo.end", "offset": 1 }, "end": { "ref": "marker:chorus.end" } },
      "style": { "font": "Noto Sans", "weight": 900, "size": 110,
                 "fill": { "type": "linear", "stops": ["#FFF6C2", "#FFC83D", "#B8860B"], "angle": 90 } },
      "spans": [ { "start": 5, "end": 8, "style": { "size": 150, "fill": "#FF1744", "underline": true } } ],
      "strokes": [ { "color": "#4E342E", "width": 5 }, { "color": "#FFFFFF", "width": 12 } ],
      "shadows": [ { "kind": "drop", "color": "#000000AA", "x": 4, "y": 6, "blur": 6 } ],
      "animations": [
        { "preset": "rise", "kind": "in", "unit": "char", "duration": 1.2 },
        { "preset": "punch", "kind": "emphasis", "unit": "word", "select": { "match": "50" },
          "timing": { "start": { "ref": "marker:chorus" }, "end": { "ref": "marker:chorus.end" }, "repeat": { "every": { "ref": "beat" } } },
          "duration": 0.3 },
        { "preset": "fade", "kind": "out", "duration": 0.4 }
      ] }
  ]
}
```

---

## 2. Khung hình và đơn vị

| Trường | Ý nghĩa |
|---|---|
| `canvas.width/height` | Kích thước khung (px). 1920×1080, 1080×1920, 1080×1080… |
| `canvas.fps`, `canvas.background` | Số hình/giây, màu nền |
| `duration` | Thời lượng tối thiểu (bản dựng dài bằng lớp kết thúc muộn nhất nếu dài hơn) |
| `markers[]` | Mốc có tên: `{id, start, end?, label?, kind?}`. `kind`: `section`, `beat`, `downbeat`, `scene` hoặc tùy ý |

- Vị trí `x, y` của lớp: **tỉ lệ 0–1** của khung (0.5, 0.5 = giữa). Tâm lớp đặt tại đó.
- Độ dài của viền, bóng, bo góc: **pixel theo khung cao 1080** (khung khác tự quy đổi). Riêng viền của chữ tính theo cỡ chữ 96 (chữ to thì viền to theo).
- Màu: `"#RRGGBB"` hoặc `"#RRGGBBAA"` (AA = độ trong suốt).

---

## 3. Thời gian: `Timing` và `TimeRef`

Mỗi lớp luôn có `start` + `duration` (giây). Muốn **neo** vào thứ khác thì thêm `timing` — engine giải ra `start`/`duration` thật.

```json
"timing": { "start": <TimeRef>, "end": <TimeRef> | null, "duration": <giây> | null, "repeat": { "every": <TimeRef>, "duration": <giây>, "count": <n> } | null }
```

**`TimeRef`** — một mốc thời gian:

| Viết | Nghĩa |
|---|---|
| `12.5` | Giây thứ 12,5 |
| `{"ref": "self.start", "offset": 0.5}` | Đầu của chính phần tử cha (lớp chứa animation/effect) + 0,5 giây. Có `self.end` |
| `{"ref": "layer:<id>.end"}` | Theo lớp khác (`.start` hoặc `.end`). Kéo lớp kia thì lớp này đi theo |
| `{"ref": "marker:<id>"}` · `{"ref": "marker:<id>.end"}` | Theo mốc có tên (id hoặc label) |
| `{"ref": "beat", "n": 16}` · `{"ref": "downbeat", "n": 4}` | Mốc thứ n có `kind` beat/downbeat (đếm từ 1) |
| `{"ref": "kind:scene", "n": 2}` | Mốc thứ n có `kind` bất kỳ |
| `{"ref": "comp.end"}` | Cuối bản dựng |

`offset` (giây, âm = sớm hơn) dùng được với mọi `ref`.

**`repeat`** — lặp trong khoảng của `timing`: `every` là số giây (`1`) hoặc mốc (`{"ref":"beat"}`, `{"ref":"downbeat"}`, `{"ref":"kind:scene"}`); mỗi lần dài `repeat.duration` (mặc định = `duration` của animation).

**Gắn được vào:** lớp (`layer.timing`) · chuyển động (`animations[].timing`) · hiệu ứng (`effects[].timing`) · đoạn chữ (`spans[].timing`).

Thời gian đã giải: API `POST /v1/composition/prepare` trả composition kèm `_windows` (chuyển động) và `_window` (hiệu ứng, đoạn chữ) — **chỉ để đọc**, engine luôn tính lại.

---

## 4. Các loại lớp

| `type` | Trường riêng |
|---|---|
| `video` | `source` ("asset:<id>"), `fit` (contain/cover), `trim_start`, `volume`, `muted` |
| `image` | `source`, `fit` |
| `text` | `text`, `style` (mục 7), `spans` (rich text) |
| `shape` | `shape` (rect/circle/star), `w`, `h` (tỉ lệ khung), `fill` (`Fill`), `corner_radius` |
| `audio` | `source`, `trim_start`, `volume`, `muted` |
| `adjust` | Lớp điều chỉnh: không có hình riêng, áp `effects` lên mọi thứ **bên dưới** trong thời gian của nó (bộ màu cả đoạn, chuyển cảnh). Xem [LIBRARY.md](LIBRARY.md) |

**Thuộc tính chung của mọi lớp**

| Trường | Ý nghĩa |
|---|---|
| `id`, `name` | Định danh, tên hiển thị |
| `start`, `duration`, `timing` | Thời gian (mục 3) |
| `x`, `y`, `scale`, `rotation`, `opacity` | Vị trí (0–1), to nhỏ, xoay (độ), độ rõ (0–100) |
| `animations[]` | Chuyển động (mục 5) |
| `keyframes` | Keyframe theo đường dẫn (mục 6) |
| `effects[]` | Hiệu ứng (mục 8) |
| `strokes[]`, `shadows[]` | Viền, bóng (mục 7.2) |
| `blend` | Hòa trộn với lớp dưới: multiply, screen, overlay, … add |
| `mask` | Mặt nạ hình học: rect/ellipse/star/heart/diamond/bars, `feather`, `invert` |
| `crop`, `flip_h`, `flip_v`, `background_fill: "blur"` | Cắt mép, lật, nền mờ lấp khung (ảnh/video) |
| `speed`, `fade_in`, `fade_out` | Tốc độ nguồn 0.1–5, âm lượng to/nhỏ dần (video/audio) |
| `hidden`, `locked` | Ẩn, khóa (editor) |

Lớp sau nằm trên lớp trước.

---

## 5. Chuyển động (`animations[]`)

Mỗi phần tử là **một** chuyển động:

```json
{ "preset": "rise", "kind": "in", "unit": "char", "duration": 1.2,
  "stagger": 0.04, "order": "forward", "ease": "back", "intensity": 1,
  "select": { "match": "50%", "range": [0, 3], "every": 2 },
  "timing": { ... }, "period": 1.0 }
```

| Trường | Ý nghĩa |
|---|---|
| `preset` | Tên chuyển động (bảng dưới) |
| `kind` | `in` xuất hiện · `out` biến mất · `loop` lặp liên tục · `emphasis` nhấn một lần |
| `duration` | Độ dài khi không có `timing`. Mặc định: in/out 0,5 s neo đầu/cuối lớp; loop suốt lớp; emphasis 0,6 s |
| `timing` | Áp từ lúc nào đến lúc nào, có thể `repeat` theo beat (mục 3) |
| `unit` | `layer` (mặc định) · `line` · `word` · `char` — chữ chia đơn vị, mỗi đơn vị chạy lệch nhau |
| `stagger`, `order` | Độ trễ giữa các đơn vị (giây; bỏ trống = tự tính), thứ tự: forward · backward · center · edges · random |
| `select` | Chỉ áp cho đơn vị thỏa: `match` (có chứa chữ này), `range` [đầu, cuối), `every` (mỗi n) |
| `ease` | linear · ease_in · ease_out · ease_in_out · back · elastic · bounce |
| `intensity` | Độ mạnh (1 = mặc định) |
| `period` | Chu kỳ (giây) cho `loop` |

Chia đơn vị lồng nhau đúng thứ bậc: dòng → từ → chữ cái (chữ cái xoay quanh tâm của nó, từ xoay quanh tâm của từ).

**Preset** (cùng một bảng cho mọi lớp; `out` là chiều ngược của `in` đối xứng):

| Loại | Preset |
|---|---|
| `in` | fade, fade_up, fade_down, fade_left, fade_right, slide_left, slide_right, slide_up, slide_down, zoom_in, zoom_out, pop, pop_bounce, elastic_in, drop, rise, blur_in, spin_in, flip_in, flip_up, stretch_in, swing_in, typewriter, glitch_in, wipe_left/right/up/down, circle_open |
| `out` | fade, fade_up, fade_down, slide_*, zoom_out, zoom_in, pop_out, blur_out, spin_out, flip_out, drop_out, typewriter (xóa từng chữ), glitch_out, wipe_*, circle_close |
| `loop` | float, pulse, breathe, shake, swing, rotate, flicker, blink, wave, jiggle, heartbeat, rainbow, bounce_loop |
| `emphasis` | punch, bounce, jump, flash, rubber, tada, wobble, headshake |

`wipe_*`/`circle_*` chỉ áp cho cả lớp. `typewriter` và `wave` mặc định chia theo chữ cái.

**Dạng cũ** `animation: { "in": {...}, "out": {...}, "loop": {...} }` vẫn đọc được — engine tự đổi sang `animations`.

---

## 6. Keyframe (`keyframes`)

Khóa là **đường dẫn thuộc tính**, giá trị là danh sách keyframe (`t` tính từ đầu lớp):

```json
"keyframes": {
  "x":               [ { "t": 0, "value": 0.2, "ease": "ease_out" }, { "t": 2, "value": 0.8 } ],
  "style.size":      [ { "t": 0, "value": 80 }, { "t": 1, "value": 140, "bezier": [0.175, 0.885, 0.32, 1.275] } ],
  "strokes.0.color": [ { "t": 0, "value": "#FF0000" }, { "t": 3, "value": "#00E5FF" } ],
  "effects.1.amount":[ { "t": 0, "value": 0 }, { "t": 1.5, "value": 100 } ]
}
```

- `value`: số hoặc màu (màu được nội suy theo RGBA).
- `ease` hoặc `bezier` (cubic-bezier kiểu CSS) của keyframe đích quyết định đoạn chuyển.
- `x, y, scale, rotation, opacity` tính cùng chuyển động; mọi đường dẫn khác (style, viền, bóng, hiệu ứng, fill…) áp trực tiếp vào dữ liệu lớp tại thời điểm đó.

---

## 7. Kiểu dáng

### 7.1 `Fill` — tô màu

```json
"#FFD54F"
{ "type": "linear", "stops": ["#FFF6C2", {"color": "#FFC83D", "pos": 0.4}, "#B8860B"], "angle": 90 }
{ "type": "radial", "stops": ["#3A2E7A", "#0D0F1E"], "cx": 0.5, "cy": 0.4, "r": 0.8 }
{ "type": "sweep",  "stops": ["#FF3B30", "#FFCC00", "#34C759", "#007AFF", "#FF3B30"], "cx": 0.5, "cy": 0.5, "angle": 0 }
{ "type": "image",  "source": "asset:<id>", "scale": 1.5 }
```

`angle`: 0 = trái→phải, 90 = trên→dưới. Tâm/bán kính theo tỉ lệ khung chứa. Gradient trải liền qua cả khối chữ (kể cả khi chữ chạy từng chữ cái).

### 7.2 `strokes[]` và `shadows[]` (mọi lớp)

```json
"strokes": [ { "color": "#FF3D7F", "width": 6 },
             { "fill": { "type": "linear", "stops": ["#00E5FF", "#7C4DFF"], "angle": 0 }, "width": 16, "join": "round", "opacity": 100 } ],
"shadows": [ { "kind": "drop", "color": "#000000AA", "x": 4, "y": 6, "blur": 8, "spread": 0 },
             { "kind": "neon", "color": "#FF2FB3", "blur": 34 },
             { "kind": "extrude", "color": "#F72585", "x": 1, "y": 1, "length": 24 } ]
```

- Viền: danh sách **từ trong ra ngoài**, mỗi `width` đo từ mép nét. Chữ/hình dùng viền vector (bo tròn chính xác); ảnh/video dùng viền theo hình dạng điểm ảnh (ảnh đã tách nền → sticker).
- Bóng `kind`: `drop` (đổ bóng, mặc định) · `glow` (phát sáng) · `neon` (sáng nhiều tầng) · `long` (bóng dài phẳng theo hướng x,y) · `extrude` (khối 3D tối dần). Hướng bóng luôn theo khung hình, không xoay theo lớp.

### 7.3 Chữ (`style` của lớp `text`)

| Trường | Ý nghĩa |
|---|---|
| `font`, `weight` (100–900), `italic` | Font, độ đậm, nghiêng. Font có sẵn: họ Noto (đủ dấu tiếng Việt) |
| `size` | Cỡ chữ theo khung cao 1080 |
| `fill` | `Fill` |
| `align` | left · center · right · justify |
| `letter_spacing`, `word_spacing`, `line_height`, `max_width` | Giãn chữ, giãn từ, giãn dòng (bội số; 0 = mặc định), rộng tối đa (0–1, tự xuống dòng) |
| `underline`, `strikethrough` | Gạch chân, gạch ngang |
| `case` | upper · lower · title (Viết Hoa Đầu Từ) |
| `warp` | `{ "type": "arc" \| "wave", "amount": -100..100 }` — uốn vòng cung / lượn sóng |
| `background` | `{ "fill" hoặc "color", "padding", "radius", "mode": "box" \| "line" }` — một khung cho cả đoạn, hoặc mỗi dòng một khung (kiểu phụ đề) |

**Rich text** — `spans[]`: `{ "start": 5, "end": 8, "style": { ...phần thay đổi... }, "timing": {...}? }`. `start/end` tính theo ký tự. `style` ghi đè lên kiểu chung (font, size, fill, weight, gạch chân, `strokes`…); có `timing` thì chỉ đổi kiểu trong khoảng đó (ví dụ chữ "SALE" đỏ từ giây 3 đến 5).

**Dạng cũ** `style.color`, `style.gradient`, `style.stroke`, `style.shadow`, `style.glow`, `style.uppercase`, `shape.stroke` vẫn đọc được — engine tự đổi sang `fill`, `strokes`, `shadows`, `case`.

**Tiếng Việt:** chữ dàn trang bằng Skia Paragraph (HarfBuzz + ICU) nên dấu luôn đúng; khi chạy từng chữ cái, engine tách theo **cụm ký tự hiển thị** (grapheme) nên dấu không bị tách khỏi chữ.

---

## 8. Hiệu ứng (`effects[]`)

```json
{ "type": "grayscale", "amount": 100, "timing": { "start": 12, "duration": 2 }, "ramp": 0.3 }
```

`type`: loại có sẵn — exposure, brightness, contrast, saturation, temperature, hue, grayscale, dim, blur (`amount` = mức) — **hoặc id của một gói trong thư viện** (hạt phim, VHS, glitch, bộ màu, xóa phông xanh, chuyển cảnh…; `amount` = độ mạnh 0..100, `params` = tham số của gói). Cách viết gói: [LIBRARY.md](LIBRARY.md).

```json
{ "type": "teal_orange", "amount": 80 }
{ "type": "chroma_key", "params": { "key": "#00FF00", "similarity": 0.4 } }
```

`timing` (tùy chọn) giới hạn thời gian áp dụng; `ramp` (giây) làm hiệu ứng mạnh dần/yếu dần ở hai đầu.

---

## 9. Cách engine render

1. `prepare()`: chuẩn hóa dạng cũ, giải `timing` của lớp (vài lượt, để lớp neo vào lớp khác), rồi giải khoảng của mọi chuyển động (kể cả `repeat`), hiệu ứng, đoạn chữ.
2. Mỗi khung, mỗi lớp đang hiện: áp keyframe theo đường dẫn → tính trạng thái (vị trí, to nhỏ, xoay, độ rõ, mờ, màu) từ keyframe + chuyển động cả lớp → vẽ nội dung (chữ: từng đơn vị khi có chuyển động theo dòng/từ/chữ cái hoặc uốn chữ) → chuỗi ImageFilter của lớp (màu → mờ → bóng/viền điểm ảnh) → mặt nạ → hòa trộn.
3. Một đường render duy nhất cho xem trước (`POST /v1/preview/frame`) và xuất video (`compose_render`).

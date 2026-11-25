# Composition — định dạng dựng hình, chữ nghệ thuật và animation

> Đây là "bản dựng" của một video nghệ thuật: nhiều **lớp** (video, ảnh, chữ, hình vẽ, hình nhảy theo nhạc…) xếp chồng lên nhau, mỗi lớp **hiện trong một khoảng thời gian**, có **vị trí**, **kiểu dáng** và **chuyển động**.
>
> - Composition là một asset có `format` = `composition`, lưu dạng JSON.
> - Composition là **dữ liệu**, chưa phải video. Các tool `compose_*` tạo và sửa nó; chỉ `compose_render` biến nó thành video thật.
> - Vì chỉ là dữ liệu nên AI (qua MCP), mini app và người dùng (kéo thả trên timeline) đều sửa được cùng một bản dựng.
>
> Tham số của các tool `compose_*`: xem [TOOL_SPECS.md](TOOL_SPECS.md), mục 9.

---

## 1. Ví dụ đầy đủ

Video lời bài hát: nền là video gốc làm mờ, tên bài hiện ở đầu với hiệu ứng nảy, logo ở góc, ngôi sao bay ngang màn hình, chữ đập theo phách ở điệp khúc.

```json
{
  "version": 1,
  "canvas": { "width": 1920, "height": 1080, "fps": 30, "background": "#000000" },
  "duration": 215.4,

  "refs": { "beats": "asset:bg_7", "lyrics": "asset:tl_3" },
  "markers": [ { "id": "chorus1", "time": 62.5, "label": "Điệp khúc 1" } ],

  "audio": [
    { "source": "asset:a_12", "start": 0, "volume": 100, "fade_out": 2 }
  ],

  "layers": [
    {
      "id": "bg", "type": "video", "source": "asset:v_3",
      "start": 0, "duration": "full", "fit": "cover",
      "effects": [ { "type": "blur", "amount": 30 }, { "type": "dim", "amount": 35 } ]
    },
    {
      "id": "title", "type": "text", "text": "Nơi Này Có Anh",
      "start": 0.5, "duration": 4,
      "position": { "x": 0.5, "y": 0.42 },
      "style": "preset:gold_luxury", "style_override": { "size": 130 },
      "animation": {
        "in":   { "preset": "letters_rise", "duration": 0.8, "split": "char", "stagger": 0.04, "ease": "back" },
        "out":  { "preset": "fade_up", "duration": 0.5 },
        "loop": { "preset": "glow_pulse", "speed": 1 }
      }
    },
    {
      "id": "logo", "type": "image", "source": "asset:i_5",
      "start": 0, "duration": "full",
      "position": { "anchor": "top_right", "margin": 0.03 }, "scale": 0.12, "opacity": 85
    },
    {
      "id": "star", "type": "shape", "shape": "star",
      "fill": { "color": "#FFD54F" }, "size": { "w": 0.05, "h": 0.05 },
      "start": { "marker": "chorus1" }, "duration": 3,
      "keyframes": {
        "position": [
          { "t": 0, "value": { "x": -0.05, "y": 0.2 }, "ease": "ease_out" },
          { "t": 3, "value": { "x": 1.05,  "y": 0.15 } }
        ],
        "rotation": [ { "t": 0, "value": 0 }, { "t": 3, "value": 720, "ease": "linear" } ]
      },
      "effects": [ { "type": "glow", "color": "#FFD54F", "amount": 60 } ]
    },
    {
      "id": "chorus_text", "type": "text", "text": "Em là tất cả",
      "start": { "marker": "chorus1" }, "duration": { "beats": 16 },
      "position": { "x": 0.5, "y": 0.75 }, "style": "preset:neon_pink",
      "animation": { "in": { "preset": "pop_bounce", "duration": 0.4 }, "out": { "preset": "blur_out", "duration": 0.4 } },
      "bindings": [ { "property": "scale", "source": "beat", "amount": 12 } ]
    }
  ]
}
```

---

## 2. Khung hình (`canvas`) và tổng thể

| Trường | Nghĩa | Ví dụ |
|---|---|---|
| `canvas.width`, `canvas.height` | Kích thước khung hình (điểm ảnh) | `1920 × 1080` ngang, `1080 × 1920` dọc |
| `canvas.fps` | Số hình mỗi giây | `30` |
| `canvas.background` | Màu nền, hoặc `"transparent"` (nền trong suốt) | `"#000000"` |
| `duration` | Tổng thời lượng (giây) | `215.4` |
| `refs` | Asset tham chiếu dùng cho **mốc thời gian**: `beats` (beat_grid), `lyrics` (timed_lyrics), `sections` (time_ranges) | |
| `markers` | Các mốc đặt tên, ví dụ "Điệp khúc 1"; lớp có thể bám theo mốc | |
| `audio` | Các track âm thanh, mỗi track gồm `source`, `start`, `volume` (%), `fade_in`, `fade_out` | |
| `layers` | Danh sách lớp. **Lớp đứng sau nằm trên** lớp đứng trước | |

### Đơn vị vị trí và kích thước: tỉ lệ 0–1

Vị trí và kích thước dùng **tỉ lệ theo khung hình**: `x = 0` là mép trái, `x = 1` là mép phải, `y = 0` là mép trên, `y = 1` là mép dưới, `0.5` là giữa. Nhờ vậy, cùng một bản dựng đổi sang dọc hay vuông vẫn đúng chỗ.

Cỡ chữ (`size`) tính theo **khung cao 1080**. Chữ cỡ 100 ở khung 1080 sẽ tự thành cỡ 200 ở khung 2160.

---

## 3. Thời gian: "hẹn giờ" cho từng lớp

Mỗi lớp có **lúc bắt đầu** (`start`) và **thời lượng** (`duration`). Hai trường này nhận **số giây** hoặc **mốc thời gian**:

### `start`: bắt đầu lúc nào

| Cách viết | Nghĩa |
|---|---|
| `12.5` | Ở giây 12.5 |
| `{ "marker": "chorus1", "offset": -0.5 }` | Nửa giây trước mốc "Điệp khúc 1" |
| `{ "beat": 32 }` | Đúng phách thứ 32 của bài (cần `refs.beats`) |
| `{ "downbeat": 8 }` | Đúng phách mạnh thứ 8 (đầu ô nhịp thứ 8) |
| `{ "lyric_line": 5 }` | Lúc bắt đầu hát câu thứ 5 (cần `refs.lyrics`) |
| `{ "lyric_word": "yêu", "occurrence": 2 }` | Lúc hát chữ "yêu" lần thứ 2 |
| `{ "section": "chorus", "occurrence": 1 }` | Đầu đoạn điệp khúc đầu tiên (cần `refs.sections`) |
| `{ "after": "title", "gap": 0.2 }` | 0.2 giây sau khi lớp `title` kết thúc |
| `{ "with": "title", "offset": 1 }` | 1 giây sau khi lớp `title` bắt đầu |

### `duration`: hiện trong bao lâu

| Cách viết | Nghĩa |
|---|---|
| `4` | 4 giây |
| `"full"` | Đến hết video |
| `{ "beats": 16 }` | Trong 16 phách |
| `{ "until": { "marker": "outro" } }` | Đến mốc "outro" |
| `{ "until": { "lyric_line": 6 } }` | Đến khi bắt đầu câu thứ 6 |
| `"source"` | Bằng độ dài của video/audio nguồn (lớp media) |

Khi render, `compose_render` đổi mọi mốc ra số giây. Đổi bài nhạc, hay căn lại beat hoặc lời, thì các lớp **tự đi theo**, không phải chỉnh tay lại.

### Thời gian riêng của lớp media

| Trường | Nghĩa |
|---|---|
| `trim_start` | Bỏ qua bao nhiêu giây đầu của video/audio nguồn |
| `speed` | Tốc độ phát của nguồn (`0.5` chậm, `2` nhanh) |
| `loop` | Hết thì phát lại từ đầu (video, GIF, sticker) |

---

## 4. Các loại lớp (`type`)

| `type` | Là gì | Trường riêng |
|---|---|---|
| `video` | Video (asset `video`) | `source`, `fit`, `trim_start`, `speed`, `loop`, `volume` |
| `image` | Ảnh tĩnh, GIF hoặc WebP động | `source`, `fit`, `loop` |
| `text` | Chữ nghệ thuật | `text`, `style`, `style_override`, `max_width` |
| `shape` | Hình vẽ: `rect`, `rounded_rect`, `circle`, `line`, `star`, `polygon`, `heart`, `arrow`, `svg_path` | `shape`, `size`, `fill`, `stroke`, `corner_radius`, `points` |
| `sticker` | Ảnh nhỏ trang trí, có sẵn chuyển động vui | `source` hoặc `sticker` (tên trong thư viện) |
| `lyrics` | Lời bài hát **tự chạy theo thời gian** từ `timed_lyrics`: tự hiện câu đang hát, tô màu từng chữ | `source`, `mode`, `lines_on_screen`, `syllable_effect`, `style` |
| `visualizer` | Hình nhảy theo nhạc | `audio`, `style` (`bars`, `waves`, `circle`, `spectrum`), `color`, `size` |
| `group` | Nhóm nhiều lớp: di chuyển, xoay, ẩn hiện cùng nhau | `children` |
| `adjustment` | Lớp "chỉnh màu/hiệu ứng" áp cho **mọi lớp nằm dưới nó** trong thời gian nó hiện | chỉ có `effects` |
| `particles` *(P1)* | Hiệu ứng hạt: `confetti` (giấy màu), `snow` (tuyết), `sparkles` (lấp lánh), `hearts`, `petals` (cánh hoa) | `preset`, `density`, `color` |

`fit` (cách đặt ảnh/video vào khung): `cover` (phủ kín, cắt bớt mép), `contain` (thấy toàn bộ, có thể dư viền), `stretch` (kéo giãn).

### Thuộc tính chung của mọi lớp

| Trường | Nghĩa | Mặc định |
|---|---|---|
| `id`, `name` | Mã lớp (dùng để tham chiếu) và tên hiển thị trên timeline | tự sinh |
| `start`, `duration` | Thời gian (mục 3) | `0`, `"full"` |
| `position` | `{x, y}` (0–1), hoặc `{anchor, margin}` với `anchor` thuộc 9 vị trí `top_left` … `bottom_right`, `center` | giữa khung |
| `anchor_point` | Điểm của lớp dùng để đặt vị trí và để xoay quanh | `center` |
| `scale` | Phóng to/thu nhỏ: một số, hoặc `{x, y}` | `1` |
| `rotation` | Góc xoay (độ, chiều kim đồng hồ) | `0` |
| `opacity` | Độ rõ, 0–100 % | `100` |
| `blend` | Cách hòa trộn với lớp dưới: `normal`, `multiply` (tối đi), `screen` (sáng lên), `overlay`, `add` (phát sáng) | `normal` |
| `effects` | Hiệu ứng của lớp (mục 7) | trống |
| `mask` *(P1)* | Chỉ hiện trong một hình: `{shape, feather (độ mờ viền), invert}` | không |
| `animation` | Chuyển động có sẵn (mục 6) | không |
| `keyframes` | Chuyển động tự tạo (mục 5) | không |
| `bindings` | Chuyển động theo nhạc (mục 6.4) | không |
| `visible`, `locked` | Ẩn lớp / khóa lớp trên timeline (chỉ dùng cho giao diện) | `true`, `false` |

---

## 5. Keyframe: tự tạo chuyển động

Keyframe là "điểm mốc": **tại thời điểm `t`, thuộc tính có giá trị `value`**. Giữa hai mốc, thuộc tính đổi dần theo kiểu `ease`. `t` tính **từ lúc lớp bắt đầu**.

```json
"keyframes": {
  "position": [ { "t": 0, "value": { "x": 0.1, "y": 0.5 }, "ease": "ease_out" },
                { "t": 2, "value": { "x": 0.9, "y": 0.5 } } ],
  "opacity":  [ { "t": 0, "value": 0 }, { "t": 0.5, "value": 100 } ],
  "scale":    [ { "t": 0, "value": 0.8 }, { "t": 2, "value": 1.2, "ease": "ease_in_out" } ]
}
```

**Thuộc tính đặt keyframe được:** `position`, `scale`, `rotation`, `opacity`, `anchor_point`, màu (`fill.color`, `stroke.color`), `blur`, `glow`, `letter_spacing` (chữ giãn ra/co lại), `text_reveal` (0–100 %: hiện dần chữ), cùng `amount` của mọi hiệu ứng.

### Kiểu chuyển (`ease`)

| `ease` | Cảm giác |
|---|---|
| `linear` | Đều đều, như máy |
| `ease_in` | Chậm lúc đầu, nhanh dần |
| `ease_out` | Nhanh lúc đầu, chậm dần rồi dừng êm (**hay dùng nhất**) |
| `ease_in_out` | Chậm – nhanh – chậm, mềm mại |
| `back` | Vượt quá đích một chút rồi lùi lại, trông "có lực" |
| `elastic` | Rung như lò xo rồi dừng |
| `bounce` | Nảy như quả bóng rơi |
| `steps(n)` | Nhảy cóc n bước, kiểu đồng hồ hoặc chữ máy đánh |

---

## 6. Animation có sẵn: chọn tên là chạy

`animation` gồm 3 phần, phần nào cũng có thể bỏ trống:

```json
"animation": {
  "in":   { "preset": "pop_bounce", "duration": 0.6, "ease": "back" },
  "out":  { "preset": "fade_down",  "duration": 0.4 },
  "loop": { "preset": "float", "speed": 1, "amount": 50 }
}
```

- **`in`**: cách lớp **xuất hiện**, chạy trong `duration` giây đầu.
- **`out`**: cách lớp **biến mất**, chạy trong `duration` giây cuối.
- **`loop`**: chuyển động **lặp liên tục** trong lúc lớp đang hiện.

### 6.1 Xuất hiện / biến mất (`in` / `out`)

| Preset | Trông như thế nào |
|---|---|
| `fade` | Hiện dần / mờ dần |
| `fade_up`, `fade_down` | Vừa hiện vừa trượt lên / xuống một chút |
| `slide_left`, `slide_right`, `slide_up`, `slide_down` | Trượt vào từ mép màn hình |
| `zoom_in`, `zoom_out` | Phóng to từ nhỏ / thu nhỏ từ lớn |
| `pop_bounce` | Bật ra và nảy nhẹ, vui mắt |
| `drop` | Rơi từ trên xuống và nảy |
| `blur_in`, `blur_out` | Từ mờ thành rõ / từ rõ thành mờ |
| `wipe_left`, `wipe_right` | Lộ ra dần như được lau từ một phía |
| `flip` | Lật như lật thẻ bài |
| `spin_in` | Xoay vòng rồi dừng đúng chỗ |
| `glitch_in` | Nhiễu sọc, giật hình rồi hiện rõ |
| `typewriter` *(chữ)* | Hiện từng chữ như máy đánh chữ, có con trỏ nhấp nháy |
| `letters_rise` *(chữ)* | Từng ký tự nhô lên từ dưới, lần lượt |
| `letters_drop` *(chữ)* | Từng ký tự rơi xuống, lần lượt |
| `scramble` *(chữ)* | Ký tự đảo lộn ngẫu nhiên rồi dừng thành chữ đúng (kiểu hacker) |
| `handwrite` *(chữ)* | Nét chữ được "viết" ra dần |

### 6.2 Lặp liên tục (`loop`)

| Preset | Trông như thế nào |
|---|---|
| `float` | Bồng bềnh lên xuống nhẹ |
| `pulse` | Phập phồng to nhỏ |
| `glow_pulse` | Ánh sáng quanh lớp sáng lên, tối đi |
| `shake` | Rung lắc |
| `swing` | Đung đưa như con lắc |
| `rotate` | Xoay tròn liên tục |
| `flicker` | Chập chờn như đèn neon sắp hỏng |
| `rainbow` | Màu đổi liên tục theo cầu vồng |
| `wave` *(chữ)* | Từng ký tự lượn lên xuống như sóng |
| `shimmer` *(chữ)* | Vệt sáng lướt ngang qua chữ (kiểu chữ vàng ánh kim) |

### 6.3 Chữ chạy theo từng ký tự, từ hoặc dòng

Thêm vào `in`, `out` hoặc `loop` để animation chạy **lần lượt** thay vì cả khối cùng lúc:

| Trường | Nghĩa | Giá trị | Mặc định |
|---|---|---|---|
| `split` | Chia chữ theo | `none` (cả khối), `char` (từng ký tự), `word` (từng từ; tiếng Việt: từng tiếng), `line` (từng dòng) | `none` |
| `stagger` | Phần tử sau chạy chậm hơn phần tử trước bao nhiêu giây | 0.01 – 0.5 | `0.05` |
| `order` | Thứ tự chạy | `forward` (trái → phải), `backward`, `center` (từ giữa ra), `random` | `forward` |

Chữ tiếng Việt được tách đúng ký tự **cùng dấu**: "ế" là một ký tự, không bị tách dấu ra khỏi chữ.

### 6.4 Chuyển động theo nhạc (`bindings`)

Gắn một thuộc tính vào nhạc để nó **tự nhảy theo nhạc**:

```json
"bindings": [
  { "property": "scale",   "source": "beat",  "amount": 12 },
  { "property": "opacity", "source": "level", "audio": "asset:a_12", "amount": 40 }
]
```

| `source` | Nghĩa |
|---|---|
| `beat` | Mỗi phách nhạc "đập" một cái rồi trở lại (cần `refs.beats`) |
| `downbeat` | Chỉ đập ở phách mạnh |
| `level` | Theo độ to tức thời của nhạc: nhạc to thì mạnh, nhạc nhỏ thì nhẹ |
| `bass` | Theo tiếng trầm (trống, bass) |

`amount` (0–100) là độ mạnh. Có thể thêm `range` để chỉ áp dụng trong một đoạn, ví dụ `{ "start": {"marker":"chorus1"}, "duration": {"beats": 32} }`.

---

## 7. Hiệu ứng của lớp (`effects`)

Mỗi hiệu ứng gồm `{ "type": ..., "amount": 0–100, ...tham số riêng }`; các hiệu ứng áp theo thứ tự trong danh sách.

| `type` | Trông như thế nào | Tham số riêng |
|---|---|---|
| `blur` | Làm mờ | |
| `dim` | Làm tối | |
| `brightness`, `contrast`, `saturation` | Sáng, tương phản, đậm màu (-100 – 100) | |
| `color_grade` | Áp màu có sẵn hoặc LUT | `preset` / `lut` |
| `glow` | Phát sáng quanh lớp | `color`, `radius` |
| `shadow` | Đổ bóng | `color`, `offset_x`, `offset_y`, `blur` |
| `outline` | Viền quanh hình/ảnh (kiểu sticker) | `color`, `width` |
| `vignette` | Tối dần ở bốn góc | |
| `grain` | Hạt phim | |
| `glitch` | Nhiễu sọc | |
| `rgb_split` | Tách màu đỏ/xanh lệch nhau (kiểu ảo giác) | `offset` |
| `mirror` | Soi gương | `axis` (`x`, `y`) |
| `chroma_key` *(P1)* | Xóa phông xanh/lá | `color`, `tolerance` |

---

## 8. Chữ nghệ thuật (`style` của lớp `text`)

`style` có thể là **tên preset** (`"preset:neon_pink"`), **asset kiểu chữ đã lưu** (`"asset:ts_9"`, format `text_style`), hoặc **mô tả đầy đủ**. `style_override` dùng để chỉnh vài trường trên nền một preset.

```json
"style": {
  "font": { "family": "Be Vietnam Pro", "weight": 800, "italic": false },
  "size": 110, "letter_spacing": 2, "line_height": 1.15, "align": "center",
  "case": "none", "max_width": 0.85,

  "fill": { "type": "gradient", "colors": ["#FFE082", "#FF8F00"], "angle": 90 },
  "strokes": [ { "color": "#3E2723", "width": 6 }, { "color": "#FFFFFF", "width": 14 } ],
  "shadows": [ { "color": "#00000099", "offset_x": 4, "offset_y": 6, "blur": 8 } ],
  "glow":    { "color": "#FFB300", "radius": 20, "amount": 50 },
  "extrude": { "depth": 8, "color": "#6D4C41", "angle": 135 },
  "warp":    { "type": "arc", "amount": 25 },
  "background": { "color": "#00000080", "padding": 0.4, "radius": 12 }
}
```

| Nhóm | Trường | Nghĩa |
|---|---|---|
| **Font** | `font.family`, `weight` (100 mảnh – 900 rất đậm), `italic` | Kiểu chữ. Chọn trong các font tiếng Việt có sẵn hoặc font người dùng tải lên (asset `font`) |
| **Cỡ và dòng** | `size`, `letter_spacing` (khoảng cách ký tự), `line_height` (khoảng cách dòng), `align` (`left`, `center`, `right`), `max_width` (0–1, dài hơn thì tự xuống dòng), `case` (`upper` IN HOA, `lower`, `none`) | |
| **Màu chữ** (`fill`) | `{type: "solid", color}` · `{type: "gradient", colors[], angle}` (chuyển màu) · `{type: "texture", image}` (lấy ảnh làm "ruột" chữ, ví dụ vân gỗ, kim tuyến) | |
| **Viền** (`strokes`) | Tối đa 3 lớp viền, mỗi lớp `{color, width}`; lớp sau nằm ngoài lớp trước | Viền nhiều lớp tạo chữ kiểu sticker hoặc truyện tranh |
| **Bóng** (`shadows`) | Nhiều bóng, mỗi bóng `{color, offset_x, offset_y, blur}` | Bóng lệch không mờ tạo chữ kiểu retro |
| **Phát sáng** (`glow`) | `{color, radius, amount}` | Chữ neon |
| **Nổi khối** (`extrude`) | `{depth, color, angle}` | Chữ 3D giả, có "thân" dày |
| **Uốn chữ** (`warp`) | `type`: `none`, `arc` (cong vòm), `wave` (lượn sóng), `bulge` (phồng giữa), `circle` (chạy vòng tròn); `amount` | |
| **Hộp nền** (`background`) | `{color, padding, radius}` | Ô màu sau chữ, dùng cho phụ đề hoặc tiêu đề |
| **Karaoke** | `color_after`, `fill_mode` (`wipe` tô dần, `per_syllable` đổi từng chữ) | Dùng cho lớp `lyrics` |

### Thư viện preset chữ (SDK cung cấp, nhóm core quản lý)

| Preset | Trông như thế nào |
|---|---|
| `classic_white` | Trắng, viền đen mảnh, bóng nhẹ; đọc rõ trên mọi nền |
| `karaoke_blue` | Trắng, đổi xanh khi hát tới (kiểu karaoke quen thuộc) |
| `neon_pink`, `neon_blue` | Chữ mảnh, phát sáng như đèn neon |
| `gold_luxury` | Chuyển màu vàng kim, viền nâu, bóng đổ, ánh kim lướt qua |
| `fire` | Chuyển đỏ – cam – vàng, phát sáng cam |
| `ice` | Trắng – xanh băng, viền xanh nhạt, lấp lánh |
| `comic_pop` | Rất đậm, viền đen dày, bóng lệch, kiểu truyện tranh |
| `sticker` | Viền trắng dày + bóng, như sticker dán |
| `retro_80s` | Chuyển tím – hồng – cam, kiểu thập niên 80, bóng sọc |
| `chalk` | Như phấn viết bảng, ruột chữ có vân |
| `handwriting` | Chữ viết tay mềm mại |
| `lower_third` | Hộp nền mờ, chữ gọn; dùng cho tên người và chú thích |
| `tet_red_gold` | Đỏ – vàng ngày Tết, viền vàng, ánh kim |

Người dùng có thể **lưu kiểu chữ** đã chỉnh thành asset `text_style` để dùng lại. Tool `compose_text_art` cũng xuất ra `text_style`.

### Tiếng Việt

- Chữ được dàn trang bằng bộ dàn chữ chuẩn (HarfBuzz qua Skia), nên **dấu tiếng Việt luôn đúng vị trí**, kể cả khi uốn chữ, dàn từng ký tự hay đổi font.
- Văn bản được chuẩn hóa Unicode (NFC) trước khi vẽ (`mediatool_sdk.vi`).
- Nếu font thiếu ký tự tiếng Việt, renderer tự dùng font dự phòng và trả `warning` để người dùng biết.

---

## 9. Kiểm tra và giới hạn

- `compose_*` kiểm tra composition theo schema: tham chiếu asset phải tồn tại, `id` không trùng, mốc thời gian phải giải được (ví dụ dùng `beat` thì phải có `refs.beats`).
- Giới hạn khuyến nghị cho máy 8 GB: tối đa 200 lớp, tối đa 8 lớp video cùng hiện một lúc ở 1080p.
- Những thứ tốn công render nhất: chữ dàn từng ký tự với đoạn văn dài, `particles`, `blur` lớn, `motion_blur`. Bản xem trước (`draft`) tự giảm chất lượng các hiệu ứng này.

## 10. Cách render (cho nhóm core)

- **Không tự viết bộ dựng.** `compose_render` dịch composition sang **MLT XML** và gọi engine **MLT** (engine của Kdenlive/Shotcut) để dựng timeline, transition, keyframe, filter, trộn tiếng; xuất qua FFmpeg. Lớp chữ nghệ thuật được vẽ bằng **Skia**, animation có sẵn chạy bằng **Lottie** (Skottie/rlottie), lời karaoke render bằng **libass**; tất cả thành lớp trong suốt để MLT ghép. Chi tiết và lý do chọn: [ENGINES.md](ENGINES.md).
- Preset animation ở mục 6 được ánh xạ sang keyframe/filter của MLT hoặc template Lottie; người dùng không phải biết engine bên dưới.
- **Một engine duy nhất:** bản xem trước (`compose_render_frame`, `compose_render` với `quality = draft`) và bản xuất cuối dùng cùng một engine, nên thấy sao thì xuất ra vậy.
- **Xem trước nhanh:** `compose_render_frame` chạy ở chế độ *warm* (process giữ sẵn, không phải khởi động lại mỗi lần), để kéo thanh thời gian trên timeline là thấy khung hình gần như ngay.
- **Lớp chuyển đổi nằm trong SDK** (`mediatool_sdk.compose`, nhóm core quản lý): đọc/ghi/kiểm tra composition, giải mốc thời gian, dịch sang MLT XML, gọi Skia/Lottie cho lớp chữ và animation. Nhiều tool cùng dùng (`compose_render`, `compose_render_frame`, `compose_text_art`) nên đặt ở SDK, đúng quy tắc các tool không import của nhau.

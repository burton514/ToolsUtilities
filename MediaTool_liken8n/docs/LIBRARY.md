# Thư viện (`library/`) — hiệu ứng là dữ liệu

> Nguyên tắc **viết một lần, dùng mọi nơi**: hiệu ứng, bộ màu, chuyển cảnh **không phải code Rust, không phải tool riêng**. Mỗi cái là một thư mục dữ liệu trong `library/`. Engine nạp một lần; editor, tool, chuỗi tự động và AI (MCP) đều dùng chung.

```
library/
  effects/
    film_grain/
      effect.toml    ← tên, nhóm, mô tả, tham số (nhãn tiếng Việt, khoảng, mặc định)
      effect.sksl    ← shader SkSL (Skia RuntimeEffect)
    tr_zoom_blur/ …
  _authoring/gen_effects.py   ← script đã sinh bộ gói có sẵn (không bắt buộc dùng)
```

- Core đọc thư mục ở biến môi trường `MEDIATOOL_LIBRARY` (Docker: `./library` mount vào `/app/library`).
- Sửa/thêm gói **không cần build lại**: gọi `POST /v1/registry/reload` (nạp lại cả tool lẫn thư viện; trả về gói lỗi nếu có).
- `GET /v1/library/effects` trả danh sách gói và tham số. Editor tự sinh thanh trượt/ô màu từ đây.
- Test `cargo test -p mediatool-engine` biên dịch **mọi** shader trong thư viện; gói lỗi làm test hỏng.

## 1. Một gói hiệu ứng

### `effect.toml`

```toml
[effect]
id = "film_grain"            # trùng tên thư mục; là giá trị `type` trong composition
name = "Hạt phim"            # nhãn tiếng Việt cho người dùng
category = "film"            # look | film | stylize | distort | light | key | transition
kind = "effect"              # effect | transition
description = "Nhiễu hạt chuyển động như phim nhựa."
sample_radius = 0            # lấy mẫu lệch xa nhất bao nhiêu px (khung 1080) — hiệu ứng làm méo/mờ phải khai báo
order = 1                    # thứ tự trong nhóm

[[param]]
key = "size"                 # tên uniform trong shader
label = "Cỡ hạt"
type = "float"               # float | color
min = 0.5
max = 5
step = 0.1
default = 1.4
unit = "px"

[[param]]
key = "tint"
label = "Màu"
type = "color"               # → uniform float4 (RGBA 0..1)
default = "#FF8A3D"
```

### `effect.sksl`

Shader nhận nội dung (`image`) và trả màu **premultiplied**. Khai báo uniform nào thì engine điền uniform đó:

| Uniform | Ý nghĩa |
|---|---|
| `uniform shader image;` | **Bắt buộc.** Nội dung của lớp (hoặc mọi thứ bên dưới, với lớp điều chỉnh). Lấy màu: `image.eval(p)` |
| `uniform float4 u_rect;` | Khung nội dung (x, y, w, h) theo tọa độ vẽ. `uv = (p - u_rect.xy) / u_rect.zw` |
| `uniform float u_px;` | Số đơn vị vẽ ứng với 1 px của khung cao 1080 — nhân với mọi kích thước (`size * u_px`) để hiệu ứng giống nhau ở mọi độ phân giải, xem trước lẫn xuất |
| `uniform float u_time;` | Giây kể từ đầu lớp (hiệu ứng chuyển động) |
| `uniform float u_progress;` | 0..1 trong khoảng áp dụng của hiệu ứng (= thời gian của lớp nếu không đặt `timing`). Chuyển cảnh dùng cái này: 0,5 là chỗ cắt |
| `uniform float u_amount;` | Độ mạnh 0..1 (thanh "Độ mạnh" × mạnh/yếu dần `ramp`) |
| `uniform float <key>;` / `uniform float4 <key>;` | Tham số khai báo trong `effect.toml` |

```glsl
uniform shader image;
uniform float u_px;
uniform float u_time;
uniform float u_amount;
uniform float size;
uniform float strength;

half4 main(float2 p) {
    float4 s = image.eval(p);
    float3 c = s.a > 0.0001 ? s.rgb / s.a : float3(0.0);          // bỏ premultiply
    float n = fract(sin(dot(floor(p / (size * u_px)) + floor(u_time * 24.0), float2(12.9898, 78.233))) * 43758.5453) - 0.5;
    c += n * strength * u_amount;
    return half4(clamp(c, 0.0, 1.0) * s.a, s.a);                     // premultiply lại
}
```

Lưu ý:
- Lấy mẫu lệch khỏi `p` (méo, mờ, tách màu) → đặt `sample_radius` ≥ độ lệch lớn nhất (px khung 1080), nếu không mép sẽ bị cắt.
- Shader chạy trên CPU (Skia raster) cho mọi khung — giữ số lần `image.eval` ít (mờ/phát sáng: ≤ 16–24 lần).
- Viết shader mới hoàn toàn. Không chép shader/manifest từ dự án có license không tương thích (ví dụ AGPL).

## 2. Dùng trong composition

Một gói là một phần tử của `effects` — **gắn được cho mọi lớp**:

```json
{ "type": "film_grain", "amount": 80, "params": { "size": 2 }, "timing": { "start": 3, "duration": 2 }, "ramp": 0.3 }
```

- `amount`: độ mạnh 0..100 (mặc định 100). `params` thiếu khóa nào thì lấy mặc định.
- `timing`/`ramp` như mọi hiệu ứng (xem [COMPOSITION_FORMAT.md](COMPOSITION_FORMAT.md) §8).
- Thứ tự áp: chỉnh màu có sẵn → làm mờ → các gói theo thứ tự trong danh sách → bóng/viền của lớp.

**Lớp điều chỉnh** (`"type": "adjust"`): không có hình riêng, áp `effects` lên **mọi thứ bên dưới** trong thời gian của nó, trộn theo độ rõ (`opacity`, có thể kèm chuyển động fade). Dùng cho bộ màu cả đoạn và **chuyển cảnh**:

```json
{ "id": "cut1", "type": "adjust", "start": 9.6, "duration": 0.8, "effects": [ { "type": "tr_zoom_blur" } ] }
```

Chuyển cảnh = lớp điều chỉnh ngắn đặt đè lên chỗ cắt giữa hai clip; gói `kind = "transition"` dùng `u_progress` (đỉnh ở giữa).

## 3. Bộ gói có sẵn (47)

| Nhóm | Gói |
|---|---|
| Bộ màu (`look`) | teal_orange, warm, cool, golden_hour, noir, mono_soft, vintage, faded_film, sepia, cyberpunk, vibrance, duotone |
| Phim (`film`) | film_grain, vignette, light_leak, vhs, old_film, scanlines |
| Nghệ thuật (`stylize`) | halftone, pixelate, posterize, mirror, kaleidoscope, sharpen, rgb_split, glitch, glow |
| Biến dạng (`distort`) | wave, swirl, fisheye, shake, zoom_pulse |
| Ánh sáng (`light`) | flash, strobe, beat_flash |
| Tách nền màu (`key`) | chroma_key, luma_key |
| Chuyển cảnh (`transition`) | tr_flash, tr_dip_black, tr_zoom_blur, tr_whip, tr_glitch, tr_blur, tr_pixelate, tr_spin, tr_light_leak, tr_rgb_split |

## 4. Các loại thư viện sắp có

Cùng cơ chế (thư mục + manifest, nạp lại không cần build): `font` (font có dấu tiếng Việt), `style` (kiểu chữ: fill + viền + bóng), `animation` (preset chuyển động), `lut` (.cube), `audio_effect` (hiệu ứng tiếng: chuỗi filter FFmpeg), `sfx`, `sticker`, `lottie`, `template` (composition có chỗ trống).

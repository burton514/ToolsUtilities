"""Sinh các gói hiệu ứng mặc định trong library/effects/<id>/ (effect.toml + effect.sksl).

Đây chỉ là công cụ soạn thảo cho bộ gói có sẵn: mỗi gói sinh ra là DỮ LIỆU độc lập, sửa tay hoặc thêm gói mới
không cần chạy lại script. Shader viết mới hoàn toàn cho MediaTool (không chép từ dự án khác).

    py library/_authoring/gen_effects.py
"""
import pathlib
import textwrap

ROOT = pathlib.Path(__file__).resolve().parents[1] / "effects"

PRELUDE = """uniform shader image;
uniform float4 u_rect;    // khung nội dung (x, y, w, h)
uniform float u_px;       // đơn vị vẽ / 1 px khung 1080
uniform float u_time;     // giây từ đầu lớp
uniform float u_progress; // 0..1 trong khoảng áp dụng
uniform float u_amount;   // độ mạnh 0..1

float hash(float2 q) { return fract(sin(dot(q, float2(12.9898, 78.233))) * 43758.5453); }
float3 unpm(float4 c) { return c.a > 0.0001 ? c.rgb / c.a : float3(0.0); }
half4 pm(float3 rgb, float a) { return half4(clamp(rgb, 0.0, 1.0) * a, a); }
float luma(float3 c) { return dot(c, float3(0.2126, 0.7152, 0.0722)); }
float3 sat(float3 c, float s) { return mix(float3(luma(c)), c, s); }
float3 con(float3 c, float k) { return (c - 0.5) * k + 0.5; }
float2 uvof(float2 p) { return (p - u_rect.xy) / u_rect.zw; }
float2 pof(float2 uv) { return u_rect.xy + uv * u_rect.zw; }
float2 center() { return u_rect.xy + u_rect.zw * 0.5; }
"""

def P(key, label, mn=0.0, mx=1.0, default=0.5, step=None, unit=None, hint=None, kind="float"):
    return dict(key=key, label=label, min=mn, max=mx, default=default, step=step, unit=unit, hint=hint, type=kind)

def C(key, label, default):
    return dict(key=key, label=label, default=default, type="color")

def look(body):
    """Bộ màu: hàm chấm màu `grade`, trộn theo độ mạnh."""
    return f"""float3 grade(float3 c) {{
{textwrap.indent(textwrap.dedent(body).strip(), '    ')}
}}
half4 main(float2 p) {{
    float4 s = image.eval(p);
    float3 c = unpm(s);
    return pm(mix(c, grade(c), u_amount), s.a);
}}"""

E = []
def fx(id, name, category, body, params=(), kind="effect", radius=0, desc="", order=0):
    E.append(dict(id=id, name=name, category=category, body=body, params=list(params), kind=kind, radius=radius, desc=desc, order=order))

# ---------------------------------------------------------------- bộ màu
fx("teal_orange", "Cam – xanh điện ảnh", "look", look("""
    float l = luma(c);
    c = mix(c, c * float3(0.82, 1.0, 1.15), (1.0 - l) * 0.7);
    c = mix(c, c * float3(1.18, 1.0, 0.8), l * 0.7);
    return con(sat(c, 1.12), 1.08);"""), desc="Vùng tối ngả xanh, vùng sáng ngả cam như phim điện ảnh.", order=1)
fx("warm", "Ấm áp", "look", look("return sat(c * float3(1.08, 1.0, 0.86) + float3(0.03, 0.01, 0.0), 1.05);"), desc="Ngả vàng ấm, hợp cảnh nắng, chân dung.", order=2)
fx("cool", "Lạnh trong", "look", look("return con(c * float3(0.9, 1.0, 1.12), 1.04);"), desc="Ngả xanh lạnh, trong trẻo.", order=3)
fx("golden_hour", "Hoàng hôn", "look", look("return sat(c * float3(1.14, 0.98, 0.78) + float3(0.05, 0.02, 0.0), 1.18);"), desc="Ánh vàng cam của giờ vàng.", order=4)
fx("noir", "Đen trắng tương phản", "look", look("float l = smoothstep(0.06, 0.94, luma(c)); return float3(l);"), desc="Đen trắng đậm, gắt như phim noir.", order=5)
fx("mono_soft", "Đen trắng dịu", "look", look("return float3(luma(c) * 0.92 + 0.04);"), desc="Đen trắng nhẹ nhàng.", order=6)
fx("vintage", "Cổ điển", "look", look("return sat(c * 0.84 + float3(0.1, 0.07, 0.03), 0.72) * float3(1.04, 0.98, 0.86);"), desc="Phai màu, ngả vàng như ảnh cũ.", order=7)
fx("faded_film", "Phim phai", "look", look("return mix(c, float3(luma(c)), 0.22) * 0.86 + float3(0.08, 0.08, 0.1);"), desc="Đen nhấc lên, màu nhạt kiểu film.", order=8)
fx("sepia", "Nâu sepia", "look", look("""
    float3 s = float3(dot(c, float3(0.393, 0.769, 0.189)), dot(c, float3(0.349, 0.686, 0.168)), dot(c, float3(0.272, 0.534, 0.131)));
    return s;"""), desc="Tông nâu ảnh xưa.", order=9)
fx("cyberpunk", "Cyberpunk", "look", look("""
    float l = luma(c);
    float3 g = float3(c.r * 1.12 + 0.08 * (1.0 - l), c.g * 0.82, c.b * 1.3 + 0.04);
    return con(sat(g, 1.25), 1.12);"""), desc="Hồng tím – xanh neon đêm thành phố.", order=10)
fx("vibrance", "Rực rỡ", "look", look("""
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
    float s = mx - mn;
    return sat(c, 1.0 + 0.8 * (1.0 - s));"""), desc="Tăng độ đậm cho màu nhạt, giữ màu đã đậm.", order=11)
fx("duotone", "Hai tông màu", "look", """uniform float4 dark;
uniform float4 light;
half4 main(float2 p) {
    float4 s = image.eval(p);
    float3 c = unpm(s);
    float3 d = mix(dark.rgb, light.rgb, smoothstep(0.0, 1.0, luma(c)));
    return pm(mix(c, d, u_amount), s.a);
}""", [C("dark", "Màu vùng tối", "#2B1055"), C("light", "Màu vùng sáng", "#FFD23F")], desc="Tô cả hình bằng hai màu theo độ sáng.", order=12)

# ---------------------------------------------------------------- phim
fx("film_grain", "Hạt phim", "film", """uniform float size;
uniform float strength;
half4 main(float2 p) {
    float4 s = image.eval(p);
    float3 c = unpm(s);
    float2 cell = floor(p / max(size * u_px, 0.5));
    float n = hash(cell + floor(u_time * 24.0) * 17.31) - 0.5;
    return pm(c + n * strength * u_amount, s.a);
}""", [P("size", "Cỡ hạt", 0.5, 5, 1.4, 0.1, "px"), P("strength", "Độ rõ hạt", 0, 1, 0.3, 0.01)], desc="Nhiễu hạt chuyển động như phim nhựa.", order=1)
fx("vignette", "Tối viền", "film", """uniform float strength;
uniform float softness;
uniform float4 tint;
half4 main(float2 p) {
    float4 s = image.eval(p);
    float3 c = unpm(s);
    float2 uv = uvof(p) - 0.5;
    float d = length(uv * float2(1.0, u_rect.w / u_rect.z)) * 1.4;
    float v = smoothstep(0.35, 0.35 + softness * 1.2, d) * strength;
    return pm(mix(c, tint.rgb, v * u_amount), s.a);
}""", [P("strength", "Độ đậm", 0, 1, 0.65, 0.01), P("softness", "Độ mềm", 0.05, 1, 0.5, 0.01), C("tint", "Màu viền", "#000000")], desc="Làm tối bốn góc, hướng mắt vào giữa.", order=2)
fx("light_leak", "Lọt sáng", "film", """uniform float4 tint;
uniform float speed;
half4 main(float2 p) {
    float4 s = image.eval(p);
    float3 c = unpm(s);
    float2 uv = uvof(p);
    float2 a = float2(0.15 + 0.5 * sin(u_time * speed * 1.7), 0.2 + 0.4 * cos(u_time * speed * 1.1));
    float2 b = float2(0.85 + 0.3 * cos(u_time * speed * 1.3), 0.8 + 0.3 * sin(u_time * speed * 0.9));
    float g = exp(-length(uv - a) * 3.2) + 0.7 * exp(-length(uv - b) * 3.8);
    float3 l = tint.rgb * g * u_amount;
    return pm(1.0 - (1.0 - c) * (1.0 - l), s.a);
}""", [C("tint", "Màu ánh sáng", "#FF8A3D"), P("speed", "Tốc độ trôi", 0, 2, 0.4, 0.05)], desc="Vệt sáng ấm trôi qua khung hình như máy film cũ.", order=3)
fx("vhs", "Băng VHS", "film", """uniform float jitter;
uniform float bleed;
half4 main(float2 p) {
    float2 uv = uvof(p);
    float line = floor(uv.y * 240.0);
    float j = (hash(float2(line, floor(u_time * 30.0))) - 0.5) * jitter * 6.0 * u_px * u_amount;
    float band = 1.0 - smoothstep(0.0, 0.03, abs(fract(uv.y - u_time * 0.12) - 0.5));
    j += band * 14.0 * u_px * u_amount;
    float o = bleed * 4.0 * u_px * u_amount;
    float4 r = image.eval(p + float2(j + o, 0.0));
    float4 g = image.eval(p + float2(j, 0.0));
    float4 b = image.eval(p + float2(j - o, 0.0));
    float3 c = float3(unpm(r).r, unpm(g).g, unpm(b).b);
    float scan = 0.92 + 0.08 * sin(uv.y * u_rect.w / (2.0 * u_px) * 3.14159);
    float n = (hash(p + u_time) - 0.5) * 0.08 * u_amount;
    c = mix(c, sat(c, 0.8) * scan + n, u_amount);
    return pm(c, g.a);
}""", [P("jitter", "Rung dòng quét", 0, 3, 1, 0.05), P("bleed", "Lem màu", 0, 3, 1, 0.05)], radius=30, desc="Rung dòng, lem màu, vệt nhiễu của băng video cũ.", order=4)
fx("old_film", "Phim cũ", "film", """uniform float scratches;
half4 main(float2 p) {
    float4 s = image.eval(p);
    float3 c = unpm(s);
    float2 uv = uvof(p);
    float3 sp = float3(dot(c, float3(0.393, 0.769, 0.189)), dot(c, float3(0.349, 0.686, 0.168)), dot(c, float3(0.272, 0.534, 0.131)));
    float fl = 1.0 + (hash(float2(floor(u_time * 18.0), 3.0)) - 0.5) * 0.18;
    float col = floor(uv.x * 400.0);
    float sc = step(1.0 - 0.004 * scratches, hash(float2(col, floor(u_time * 10.0))));
    float dust = step(0.9993, hash(floor(p / (3.0 * u_px)) + floor(u_time * 12.0)));
    float3 o = sp * fl * (1.0 - 0.6 * sc) * (1.0 - 0.8 * dust);
    return pm(mix(c, o, u_amount), s.a);
}""", [P("scratches", "Vết xước", 0, 3, 1, 0.1)], desc="Nâu cũ, nhấp nháy, vết xước và bụi.", order=5)
fx("scanlines", "Sọc màn hình", "film", """uniform float spacing;
uniform float strength;
half4 main(float2 p) {
    float4 s = image.eval(p);
    float3 c = unpm(s);
    float k = 0.5 + 0.5 * sin((p.y - u_rect.y) / (spacing * u_px) * 6.28318);
    return pm(c * (1.0 - strength * k * u_amount), s.a);
}""", [P("spacing", "Khoảng sọc", 2, 16, 4, 0.5, "px"), P("strength", "Độ đậm", 0, 1, 0.35, 0.01)], desc="Sọc ngang kiểu màn hình CRT.", order=6)

# ---------------------------------------------------------------- nghệ thuật
fx("halftone", "Chấm in báo", "stylize", """uniform float size;
uniform float4 paper;
half4 main(float2 p) {
    float cell = max(size * u_px, 2.0);
    float2 q = p - u_rect.xy;
    float2 local = mod(q, cell) - cell * 0.5;
    float2 ctr = p - local;
    float4 s = image.eval(ctr);
    float3 c = unpm(s);
    float r = sqrt(1.0 - luma(c)) * cell * 0.62;
    float ink = 1.0 - smoothstep(r - u_px, r + u_px, length(local));
    float3 o = mix(paper.rgb, c * 0.85, ink);
    float4 orig = image.eval(p);
    return pm(mix(unpm(orig), o, u_amount), orig.a);
}""", [P("size", "Cỡ chấm", 4, 48, 12, 1, "px"), C("paper", "Màu giấy", "#F5F1E6")], radius=30, desc="Ảnh thành chấm tròn như tranh in báo, pop-art.", order=1)
fx("pixelate", "Ô vuông pixel", "stylize", """uniform float size;
half4 main(float2 p) {
    float cell = max(size * u_px * u_amount, 1.0);
    float2 q = (floor((p - u_rect.xy) / cell) + 0.5) * cell + u_rect.xy;
    return image.eval(q);
}""", [P("size", "Cỡ ô", 2, 96, 18, 1, "px")], radius=100, desc="Hình vỡ thành ô vuông kiểu game 8-bit.", order=2)
fx("posterize", "Ít màu (poster)", "stylize", """uniform float levels;
half4 main(float2 p) {
    float4 s = image.eval(p);
    float3 c = unpm(s);
    float n = max(levels, 2.0);
    float3 o = floor(c * n) / (n - 1.0);
    return pm(mix(c, o, u_amount), s.a);
}""", [P("levels", "Số mức màu", 2, 12, 4, 1)], desc="Giảm số màu, ra tranh phẳng kiểu poster.", order=3)
fx("mirror", "Soi gương", "stylize", """uniform float axis;
half4 main(float2 p) {
    float2 uv = uvof(p);
    if (axis < 0.5) { uv.x = uv.x > 0.5 ? 1.0 - uv.x : uv.x; } else { uv.y = uv.y > 0.5 ? 1.0 - uv.y : uv.y; }
    return image.eval(pof(uv));
}""", [P("axis", "Trục (0 ngang · 1 dọc)", 0, 1, 0, 1)], radius=2200, desc="Nửa hình phản chiếu sang nửa kia.", order=4)
fx("kaleidoscope", "Kính vạn hoa", "stylize", """uniform float segments;
half4 main(float2 p) {
    float2 c = center();
    float2 d = p - c;
    float r = length(d);
    float seg = 6.28318 / max(segments, 2.0);
    float a = atan(d.y, d.x) + u_time * 0.2;
    a = mod(a, seg);
    a = abs(a - seg * 0.5);
    return image.eval(c + r * float2(cos(a), sin(a)));
}""", [P("segments", "Số cánh", 3, 16, 6, 1)], radius=2200, desc="Hình lặp đối xứng xoay tròn như kính vạn hoa.", order=5)
fx("sharpen", "Làm nét", "stylize", """uniform float strength;
half4 main(float2 p) {
    float o = 1.2 * u_px;
    float4 s = image.eval(p);
    float3 c = unpm(s);
    float3 n = unpm(image.eval(p + float2(0, -o))) + unpm(image.eval(p + float2(0, o))) + unpm(image.eval(p + float2(-o, 0))) + unpm(image.eval(p + float2(o, 0)));
    float k = strength * u_amount;
    return pm(c * (1.0 + 4.0 * k) - n * k, s.a);
}""", [P("strength", "Độ nét", 0, 2, 0.6, 0.05)], radius=3, desc="Làm rõ chi tiết, cạnh.", order=6)
fx("rgb_split", "Tách màu RGB", "stylize", """uniform float offset;
uniform float angle;
half4 main(float2 p) {
    float a = radians(angle);
    float2 d = float2(cos(a), sin(a)) * offset * u_px * u_amount;
    float4 r = image.eval(p + d);
    float4 g = image.eval(p);
    float4 b = image.eval(p - d);
    float al = max(g.a, max(r.a, b.a));
    return pm(float3(unpm(r).r * r.a, unpm(g).g * g.a, unpm(b).b * b.a) / max(al, 0.0001), al);
}""", [P("offset", "Độ lệch", 0, 60, 10, 0.5, "px"), P("angle", "Hướng", 0, 360, 0, 1, "°")], radius=70, desc="Ba kênh màu lệch nhau (quang sai).", order=7)
fx("glitch", "Glitch", "stylize", """uniform float speed;
half4 main(float2 p) {
    float2 uv = uvof(p);
    float tt = floor(u_time * speed * 10.0);
    float by = floor(uv.y * 18.0 + hash(float2(tt, 1.0)) * 6.0);
    float on = step(1.0 - 0.35 * u_amount, hash(float2(by, tt)));
    float sh = (hash(float2(by, tt + 7.0)) - 0.5) * 0.18 * u_rect.z * on;
    float o = 6.0 * u_px * u_amount * (0.5 + on);
    float4 r = image.eval(p + float2(sh + o, 0.0));
    float4 g = image.eval(p + float2(sh, 0.0));
    float4 b = image.eval(p + float2(sh - o, 0.0));
    float al = max(g.a, max(r.a, b.a));
    return pm(float3(unpm(r).r * r.a, unpm(g).g * g.a, unpm(b).b * b.a) / max(al, 0.0001), al);
}""", [P("speed", "Tốc độ nhiễu", 0.2, 4, 1, 0.1)], radius=400, desc="Hình giật, xé ngang, lệch màu như lỗi tín hiệu.", order=8)
fx("glow", "Phát sáng (bloom)", "stylize", """uniform float radius;
uniform float threshold;
half4 main(float2 p) {
    float4 s = image.eval(p);
    float3 c = unpm(s);
    float3 acc = float3(0.0);
    for (int i = 0; i < 12; i++) {
        float a = float(i) * 0.5236;
        float2 d = float2(cos(a), sin(a)) * radius * u_px;
        float3 x1 = unpm(image.eval(p + d));
        float3 x2 = unpm(image.eval(p + d * 0.5));
        acc += max(x1 - threshold, 0.0) + max(x2 - threshold, 0.0);
    }
    acc /= 24.0;
    return pm(c + acc * 2.2 * u_amount, max(s.a, clamp(luma(acc) * 2.0 * u_amount, 0.0, 1.0)));
}""", [P("radius", "Độ lan", 2, 48, 16, 1, "px"), P("threshold", "Ngưỡng sáng", 0, 1, 0.6, 0.01)], radius=50, desc="Vùng sáng tỏa hào quang mềm.", order=9)

# ---------------------------------------------------------------- biến dạng
fx("wave", "Gợn sóng", "distort", """uniform float amplitude;
uniform float frequency;
uniform float speed;
half4 main(float2 p) {
    float2 uv = uvof(p);
    float dx = sin(uv.y * frequency * 6.28318 + u_time * speed * 6.28318) * amplitude * u_px * u_amount;
    float dy = cos(uv.x * frequency * 4.0 + u_time * speed * 5.0) * amplitude * 0.4 * u_px * u_amount;
    return image.eval(p + float2(dx, dy));
}""", [P("amplitude", "Biên độ", 0, 60, 12, 0.5, "px"), P("frequency", "Số gợn", 1, 20, 5, 0.5), P("speed", "Tốc độ", 0, 3, 0.6, 0.05)], radius=70, desc="Hình lượn sóng như nhìn qua mặt nước.", order=1)
fx("swirl", "Xoáy", "distort", """uniform float strength;
uniform float size;
half4 main(float2 p) {
    float2 c = center();
    float2 d = p - c;
    float R = size * min(u_rect.z, u_rect.w);
    float r = length(d);
    float k = r < R ? (1.0 - r / R) : 0.0;
    float a = strength * k * k * u_amount;
    float cs = cos(a), sn = sin(a);
    return image.eval(c + float2(d.x * cs - d.y * sn, d.x * sn + d.y * cs));
}""", [P("strength", "Độ xoáy", -12, 12, 4, 0.1), P("size", "Vùng xoáy", 0.1, 1, 0.5, 0.01)], radius=2200, desc="Xoáy hình quanh tâm.", order=2)
fx("fisheye", "Mắt cá", "distort", """uniform float strength;
half4 main(float2 p) {
    float2 c = center();
    float2 d = (p - c) / (0.5 * min(u_rect.z, u_rect.w));
    float r = length(d);
    float k = strength * u_amount;
    float2 q = d * (1.0 + k * r * r) / (1.0 + k);
    return image.eval(c + q * 0.5 * min(u_rect.z, u_rect.w));
}""", [P("strength", "Độ phồng", -0.8, 1.5, 0.5, 0.01)], radius=2200, desc="Phồng / chụm giữa khung như ống kính mắt cá.", order=3)
fx("shake", "Rung máy", "distort", """uniform float amount;
uniform float speed;
half4 main(float2 p) {
    float t = u_time * speed;
    float dx = sin(t * 1.7) * 0.6 + sin(t * 3.9 + 1.3) * 0.4;
    float dy = cos(t * 2.3) * 0.6 + sin(t * 4.7 + 0.7) * 0.4;
    return image.eval(p + float2(dx, dy) * amount * u_px * u_amount);
}""", [P("amount", "Độ rung", 0, 60, 14, 0.5, "px"), P("speed", "Tốc độ", 1, 40, 14, 0.5)], radius=70, desc="Khung hình rung như cầm máy tay, động đất.", order=4)
fx("zoom_pulse", "Đập theo nhịp", "distort", """uniform float bpm;
uniform float zoom;
half4 main(float2 p) {
    float f = fract(u_time * bpm / 60.0);
    float z = 1.0 + zoom * exp(-f * 7.0) * u_amount;
    float2 c = center();
    return image.eval(c + (p - c) / z);
}""", [P("bpm", "Nhịp (BPM)", 40, 220, 120, 1), P("zoom", "Độ phóng", 0, 0.3, 0.06, 0.005)], radius=300, desc="Khung phóng to theo nhịp nhạc. Đặt lớp bắt đầu đúng phách đầu.", order=5)

# ---------------------------------------------------------------- ánh sáng
fx("flash", "Chớp sáng", "light", """uniform float4 tint;
half4 main(float2 p) {
    float4 s = image.eval(p);
    float k = sin(u_progress * 3.14159) * u_amount;
    return pm(mix(unpm(s), tint.rgb, k), max(s.a, k));
}""", [C("tint", "Màu chớp", "#FFFFFF")], desc="Lóe sáng rồi tắt trong thời gian của hiệu ứng.", order=1)
fx("strobe", "Nhấp nháy", "light", """uniform float rate;
half4 main(float2 p) {
    float4 s = image.eval(p);
    float on = step(0.5, fract(u_time * rate));
    return pm(unpm(s) * (1.0 + on * 0.9 * u_amount), s.a);
}""", [P("rate", "Số lần / giây", 1, 20, 6, 0.5)], desc="Sáng tối liên tục như đèn sân khấu.", order=2)
fx("beat_flash", "Lóe theo nhịp", "light", """uniform float bpm;
uniform float strength;
half4 main(float2 p) {
    float4 s = image.eval(p);
    float f = fract(u_time * bpm / 60.0);
    float k = exp(-f * 9.0) * strength * u_amount;
    return pm(unpm(s) + k, s.a);
}""", [P("bpm", "Nhịp (BPM)", 40, 220, 120, 1), P("strength", "Độ sáng", 0, 1, 0.5, 0.01)], desc="Sáng bừng ở mỗi phách. Đặt lớp bắt đầu đúng phách đầu.", order=3)

# ---------------------------------------------------------------- tách nền màu
fx("chroma_key", "Xóa phông xanh", "key", """uniform float4 key;
uniform float similarity;
uniform float smoothness;
uniform float spill;
float2 cbcr(float3 c) { return float2(-0.1687 * c.r - 0.3313 * c.g + 0.5 * c.b, 0.5 * c.r - 0.4187 * c.g - 0.0813 * c.b); }
half4 main(float2 p) {
    float4 s = image.eval(p);
    float3 c = unpm(s);
    float d = distance(cbcr(c), cbcr(key.rgb));
    float a = smoothstep(similarity * 0.5, similarity * 0.5 + smoothness * 0.5 + 0.001, d);
    float g = max(0.0, c.g - max(c.r, c.b));
    c.g -= g * spill;
    float al = s.a * mix(1.0, a, u_amount);
    return pm(c, al);
}""", [C("key", "Màu phông", "#00FF00"), P("similarity", "Độ giống", 0, 1, 0.4, 0.01), P("smoothness", "Mềm viền", 0, 1, 0.1, 0.01), P("spill", "Khử ám màu", 0, 1, 0.6, 0.01)], desc="Xóa phông xanh lá / xanh dương, giữ người và vật.", order=1)
fx("luma_key", "Xóa nền đen / trắng", "key", """uniform float threshold;
uniform float softness;
uniform float invert;
half4 main(float2 p) {
    float4 s = image.eval(p);
    float3 c = unpm(s);
    float a = smoothstep(threshold, threshold + softness + 0.001, luma(c));
    if (invert > 0.5) { a = 1.0 - a; }
    return pm(c, s.a * mix(1.0, a, u_amount));
}""", [P("threshold", "Ngưỡng", 0, 1, 0.12, 0.01), P("softness", "Mềm viền", 0, 0.5, 0.1, 0.01), P("invert", "Xóa nền trắng (0/1)", 0, 1, 0, 1)], desc="Xóa nền đen (khói, lửa, hạt bụi) hoặc nền trắng.", order=2)

# ---------------------------------------------------------------- chuyển cảnh (đặt lớp điều chỉnh đè lên chỗ cắt)
def tr(id, name, body, params=(), radius=0, desc="", order=0):
    fx(id, name, "transition", body, params, kind="transition", radius=radius, desc=desc, order=order)

tr("tr_flash", "Chớp trắng", """half4 main(float2 p) {
    float4 s = image.eval(p);
    float k = pow(sin(u_progress * 3.14159), 3.0) * u_amount;
    return pm(mix(unpm(s), float3(1.0), k), max(s.a, k));
}""", desc="Lóe trắng che chỗ cắt.", order=1)
tr("tr_dip_black", "Tối rồi sáng", """half4 main(float2 p) {
    float4 s = image.eval(p);
    float k = sin(u_progress * 3.14159) * u_amount;
    return pm(unpm(s) * (1.0 - k), max(s.a, k));
}""", desc="Tối dần về đen rồi sáng lại.", order=2)
tr("tr_zoom_blur", "Zoom nhòe", """half4 main(float2 p) {
    float k = sin(u_progress * 3.14159) * u_amount;
    float2 c = center();
    float2 d = (p - c) / (1.0 + 0.5 * k);
    float3 acc = float3(0.0); float al = 0.0;
    for (int i = 0; i < 10; i++) {
        float f = 1.0 - float(i) * 0.02 * k * 2.0;
        float4 x = image.eval(c + d * f);
        acc += unpm(x) * x.a; al += x.a;
    }
    return pm(acc / max(al, 0.0001), al / 10.0);
}""", radius=900, desc="Phóng nhanh vào giữa kèm nhòe chuyển động.", order=3)
tr("tr_whip", "Lia nhanh", """uniform float direction;
half4 main(float2 p) {
    float k = pow(sin(u_progress * 3.14159), 2.0) * u_amount;
    float dir = direction < 0.5 ? 1.0 : -1.0;
    float shift = (u_progress - 0.5) * u_rect.z * 0.25 * dir * u_amount;
    float3 acc = float3(0.0); float al = 0.0;
    for (int i = 0; i < 12; i++) {
        float o = (float(i) / 11.0 - 0.5) * u_rect.z * 0.22 * k;
        float4 x = image.eval(p + float2(o + shift, 0.0));
        acc += unpm(x) * x.a; al += x.a;
    }
    return pm(acc / max(al, 0.0001), al / 12.0);
}""", [P("direction", "Hướng (0 trái · 1 phải)", 0, 1, 0, 1)], radius=1200, desc="Lia máy thật nhanh sang ngang (whip pan).", order=4)
tr("tr_glitch", "Glitch chuyển cảnh", """half4 main(float2 p) {
    float k = sin(u_progress * 3.14159) * u_amount;
    float2 uv = uvof(p);
    float tt = floor(u_progress * 40.0);
    float by = floor(uv.y * 14.0 + hash(float2(tt, 2.0)) * 4.0);
    float on = step(1.0 - 0.6 * k, hash(float2(by, tt)));
    float sh = (hash(float2(by, tt + 3.0)) - 0.5) * 0.3 * u_rect.z * on;
    float o = 20.0 * u_px * k;
    float4 r = image.eval(p + float2(sh + o, 0.0));
    float4 g = image.eval(p + float2(sh, 0.0));
    float4 b = image.eval(p + float2(sh - o, 0.0));
    float al = max(g.a, max(r.a, b.a));
    return pm(float3(unpm(r).r * r.a, unpm(g).g * g.a, unpm(b).b * b.a) / max(al, 0.0001), al);
}""", radius=700, desc="Xé hình, lệch màu ngay chỗ cắt.", order=5)
tr("tr_blur", "Nhòe mờ", """half4 main(float2 p) {
    float k = sin(u_progress * 3.14159) * u_amount;
    float r = 28.0 * u_px * k;
    float3 acc = float3(0.0); float al = 0.0;
    for (int i = 0; i < 16; i++) {
        float a = float(i) * 0.3927;
        float rr = r * (0.35 + 0.65 * fract(float(i) * 0.618));
        float4 x = image.eval(p + float2(cos(a), sin(a)) * rr);
        acc += unpm(x) * x.a; al += x.a;
    }
    return pm(acc / max(al, 0.0001), al / 16.0);
}""", radius=32, desc="Nhòe mềm rồi rõ lại.", order=6)
tr("tr_pixelate", "Vỡ ô vuông", """half4 main(float2 p) {
    float k = sin(u_progress * 3.14159) * u_amount;
    float cell = max(1.0, 70.0 * u_px * k);
    float2 q = (floor((p - u_rect.xy) / cell) + 0.5) * cell + u_rect.xy;
    return image.eval(q);
}""", radius=80, desc="Hình vỡ thành ô vuông rồi ghép lại.", order=7)
tr("tr_spin", "Xoay nhòe", """half4 main(float2 p) {
    float k = sin(u_progress * 3.14159) * u_amount;
    float2 c = center();
    float2 d = p - c;
    float base = (u_progress - 0.5) * 1.2 * u_amount;
    float3 acc = float3(0.0); float al = 0.0;
    for (int i = 0; i < 10; i++) {
        float a = base + (float(i) / 9.0 - 0.5) * 0.5 * k;
        float cs = cos(a), sn = sin(a);
        float4 x = image.eval(c + float2(d.x * cs - d.y * sn, d.x * sn + d.y * cs));
        acc += unpm(x) * x.a; al += x.a;
    }
    return pm(acc / max(al, 0.0001), al / 10.0);
}""", radius=2200, desc="Xoay tròn nhanh qua chỗ cắt.", order=8)
tr("tr_light_leak", "Lóe nắng", """uniform float4 tint;
half4 main(float2 p) {
    float4 s = image.eval(p);
    float3 c = unpm(s);
    float2 uv = uvof(p);
    float k = sin(u_progress * 3.14159) * u_amount;
    float g = exp(-length(uv - float2(u_progress * 1.2 - 0.1, 0.3)) * (3.0 - 2.0 * k)) * 1.6 * k;
    float3 l = tint.rgb * g;
    return pm(1.0 - (1.0 - c) * (1.0 - l), max(s.a, k));
}""", [C("tint", "Màu nắng", "#FFB04A")], desc="Vệt nắng ấm quét qua chỗ cắt.", order=9)
tr("tr_rgb_split", "Tách màu chuyển cảnh", """half4 main(float2 p) {
    float k = sin(u_progress * 3.14159) * u_amount;
    float2 d = float2(40.0 * u_px * k, 0.0);
    float4 r = image.eval(p + d);
    float4 g = image.eval(p);
    float4 b = image.eval(p - d);
    float al = max(g.a, max(r.a, b.a));
    return pm(float3(unpm(r).r * r.a, unpm(g).g * g.a, unpm(b).b * b.a) / max(al, 0.0001), al);
}""", radius=45, desc="Ba kênh màu tách ra rồi nhập lại.", order=10)

CATEGORY_NOTE = {
    "look": "Bộ màu", "film": "Phim", "stylize": "Nghệ thuật", "distort": "Biến dạng",
    "light": "Ánh sáng", "key": "Tách nền màu", "transition": "Chuyển cảnh",
}

def toml_val(v):
    if isinstance(v, str):
        return '"' + v.replace('"', '\\"') + '"'
    if isinstance(v, bool):
        return "true" if v else "false"
    return repr(float(v)) if isinstance(v, float) else str(v)

def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    for e in E:
        d = ROOT / e["id"]
        d.mkdir(parents=True, exist_ok=True)
        lines = ["# Gói hiệu ứng MediaTool — xem docs/LIBRARY.md", "", "[effect]",
                 f'id = {toml_val(e["id"])}', f'name = {toml_val(e["name"])}', f'category = {toml_val(e["category"])}',
                 f'kind = {toml_val(e["kind"])}', f'description = {toml_val(e["desc"])}',
                 f'sample_radius = {e["radius"]}', f'order = {e["order"]}']
        for p in e["params"]:
            lines += ["", "[[param]]"]
            for k in ("key", "label", "type", "min", "max", "step", "default", "unit", "hint"):
                if p.get(k) is not None and not (p["type"] == "color" and k in ("min", "max")):
                    lines.append(f"{k} = {toml_val(p[k])}")
        (d / "effect.toml").write_text("\n".join(lines) + "\n", encoding="utf-8")
        (d / "effect.sksl").write_text(f"// {e['name']} — {e['desc']}\n" + PRELUDE + "\n" + e["body"].strip() + "\n", encoding="utf-8")
    print(f"{len(E)} gói → {ROOT}")

if __name__ == "__main__":
    main()

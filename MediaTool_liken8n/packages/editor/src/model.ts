// Composition (bản dựng) — khớp với engine Rust `mediatool-engine::model`. Xem docs/COMPOSITION_FORMAT.md.
// Thời gian tính bằng giây; vị trí/kích thước theo tỉ lệ 0..1 của khung hình; độ dài (viền, bóng) theo khung cao 1080.
//
// "Viết một lần, dùng mọi nơi": Timing, Fill, Stroke, Shadow, Effect, Anim là thành phần chung cho MỌI loại lớp.
// Engine là nguồn chuẩn duy nhất (chuẩn hóa dạng cũ, giải mốc thời gian) — editor không tự tính lại.

export type Ease = "linear" | "ease_in" | "ease_out" | "ease_in_out" | "back" | "elastic" | "bounce";
export type AnimProp = "x" | "y" | "scale" | "rotation" | "opacity";

export interface Keyframe {
  t: number; // giây, tính từ lúc lớp bắt đầu
  /** số, hoặc màu "#RRGGBB[AA]" */
  value: number | string;
  ease?: Ease;
  /** easing tùy chỉnh kiểu CSS cubic-bezier(x1, y1, x2, y2) — ưu tiên hơn `ease` */
  bezier?: [number, number, number, number] | null;
}

/** Preset easing dạng cubic-bezier (bê từ OpenCut `graph-editor/easing-presets.ts`, MIT). */
export const BEZIER_PRESETS: { id: string; label: string; value: [number, number, number, number] }[] = [
  { id: "smooth", label: "Mượt", value: [0.25, 0.1, 0.25, 1] },
  { id: "ease-out", label: "Chậm dần", value: [0, 0, 0.2, 1] },
  { id: "ease-in", label: "Nhanh dần", value: [0.8, 0, 1, 1] },
  { id: "ease-in-out", label: "Chậm–nhanh–chậm", value: [0.4, 0, 0.2, 1] },
  { id: "pop", label: "Bật (vượt đích)", value: [0.175, 0.885, 0.32, 1.275] },
  { id: "linear", label: "Đều", value: [0, 0, 1, 1] },
];

export type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | "color_dodge" | "color_burn"
  | "hard_light" | "soft_light" | "difference" | "exclusion" | "hue" | "saturation" | "color" | "luminosity" | "add";
export const BLEND_MODES: BlendMode[] = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color_dodge", "color_burn",
  "hard_light", "soft_light", "difference", "exclusion", "hue", "saturation", "color", "luminosity", "add"];

export interface Mask {
  shape: "rect" | "ellipse" | "star" | "heart" | "diamond" | "bars";
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
  feather: number;
  radius: number;
  invert: boolean;
}
export const MASK_SHAPES: Mask["shape"][] = ["rect", "ellipse", "star", "heart", "diamond", "bars"];
export const defaultMask = (shape: Mask["shape"] = "ellipse"): Mask => ({ shape, cx: 0, cy: 0, w: 0.6, h: 0.6, rotation: 0, feather: 20, radius: 0, invert: false });

export interface Crop { left: number; top: number; right: number; bottom: number }

/** Giới hạn tốc độ (theo OpenCut `retime/rate.ts`, MIT; engine giới hạn 0.1..5). */
export const SPEED = { min: 0.1, max: 5, presets: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] };

// ------------------------------------------------------------------ thời gian
/** Mốc thời gian: số giây, hoặc neo vào thứ khác (+ lệch `offset`). Xem docs/COMPOSITION_FORMAT.md §3. */
export type TimeRef = number | { ref: string; offset?: number; n?: number };
export interface Timing {
  start?: TimeRef | null;
  end?: TimeRef | null;
  duration?: number | null;
  repeat?: { every: TimeRef; duration?: number | null; count?: number | null } | null;
}
export interface Marker { id: string; start: number; end?: number | null; label?: string | null; kind?: string | null }

// ------------------------------------------------------------------ tô màu, viền, bóng (dùng cho mọi lớp)
export type Stop = string | { color: string; pos: number };
export type Fill =
  | string
  | { type: "solid"; color: string }
  | { type: "linear"; stops: Stop[]; angle: number }
  | { type: "radial"; stops: Stop[]; cx: number; cy: number; r: number }
  | { type: "sweep"; stops: Stop[]; cx: number; cy: number; angle: number }
  | { type: "image"; source: string; scale: number };
export interface Stroke { color?: string | null; fill?: Fill | null; width: number; join?: "round" | "miter" | "bevel" | null; opacity?: number }
export type ShadowKind = "drop" | "glow" | "neon" | "long" | "extrude";
export interface Shadow { kind?: ShadowKind | null; color: string; x: number; y: number; blur: number; spread?: number; length?: number; opacity?: number }

// ------------------------------------------------------------------ chuyển động
export type AnimKind = "in" | "out" | "loop" | "emphasis";
export type AnimUnit = "layer" | "line" | "word" | "char";
export interface Anim {
  preset: string;
  kind: AnimKind;
  timing?: Timing | null;
  duration?: number | null;
  unit?: AnimUnit | null;
  stagger?: number | null;
  order?: "forward" | "backward" | "center" | "edges" | "random" | null;
  ease?: Ease | null;
  select?: { range?: [number, number] | null; match?: string | null; every?: number | null } | null;
  intensity?: number;
  period?: number | null;
  /** engine tự tính (chỉ đọc) */
  _windows?: [number, number][];
}

/** Bảng preset — khớp engine `anim.rs`. Nhãn tiếng Việt cho người dùng. */
export const ANIMS: { id: string; label: string; kind: AnimKind }[] = [
  { id: "fade", label: "Hiện dần", kind: "in" }, { id: "fade_up", label: "Hiện dần, đi lên", kind: "in" },
  { id: "fade_down", label: "Hiện dần, đi xuống", kind: "in" }, { id: "slide_left", label: "Trượt từ phải", kind: "in" },
  { id: "slide_right", label: "Trượt từ trái", kind: "in" }, { id: "slide_up", label: "Trượt từ dưới", kind: "in" },
  { id: "slide_down", label: "Trượt từ trên", kind: "in" }, { id: "zoom_in", label: "Phóng to dần", kind: "in" },
  { id: "zoom_out", label: "Thu nhỏ dần", kind: "in" }, { id: "pop", label: "Bật lên", kind: "in" },
  { id: "pop_bounce", label: "Bật nảy", kind: "in" }, { id: "elastic_in", label: "Đàn hồi", kind: "in" },
  { id: "drop", label: "Rơi nảy", kind: "in" }, { id: "rise", label: "Trồi lên", kind: "in" },
  { id: "blur_in", label: "Rõ dần", kind: "in" }, { id: "spin_in", label: "Xoay vào", kind: "in" },
  { id: "flip_in", label: "Lật ngang", kind: "in" }, { id: "flip_up", label: "Lật dọc", kind: "in" },
  { id: "stretch_in", label: "Co giãn", kind: "in" }, { id: "swing_in", label: "Đu vào", kind: "in" },
  { id: "typewriter", label: "Gõ chữ", kind: "in" }, { id: "glitch_in", label: "Nhiễu glitch", kind: "in" },
  { id: "wipe_left", label: "Quét sang trái", kind: "in" }, { id: "wipe_right", label: "Quét sang phải", kind: "in" },
  { id: "wipe_up", label: "Quét lên", kind: "in" }, { id: "wipe_down", label: "Quét xuống", kind: "in" },
  { id: "circle_open", label: "Mở hình tròn", kind: "in" },
  { id: "fade", label: "Mờ dần", kind: "out" }, { id: "fade_up", label: "Mờ dần, bay lên", kind: "out" },
  { id: "fade_down", label: "Mờ dần, rơi xuống", kind: "out" }, { id: "slide_left", label: "Trượt sang trái", kind: "out" },
  { id: "slide_right", label: "Trượt sang phải", kind: "out" }, { id: "slide_up", label: "Bay lên", kind: "out" },
  { id: "slide_down", label: "Rơi xuống", kind: "out" }, { id: "zoom_out", label: "Thu nhỏ", kind: "out" },
  { id: "zoom_in", label: "Phóng to biến mất", kind: "out" }, { id: "pop_out", label: "Xẹp", kind: "out" },
  { id: "blur_out", label: "Nhòe đi", kind: "out" }, { id: "spin_out", label: "Xoay ra", kind: "out" },
  { id: "flip_out", label: "Lật ra", kind: "out" }, { id: "drop_out", label: "Rơi ra", kind: "out" },
  { id: "typewriter", label: "Xóa từng chữ", kind: "out" }, { id: "glitch_out", label: "Nhiễu glitch", kind: "out" },
  { id: "wipe_left", label: "Quét sang trái", kind: "out" }, { id: "wipe_right", label: "Quét sang phải", kind: "out" },
  { id: "circle_close", label: "Đóng hình tròn", kind: "out" },
  { id: "float", label: "Bồng bềnh", kind: "loop" }, { id: "pulse", label: "Phập phồng", kind: "loop" },
  { id: "breathe", label: "Thở", kind: "loop" }, { id: "shake", label: "Rung", kind: "loop" },
  { id: "swing", label: "Đung đưa", kind: "loop" }, { id: "rotate", label: "Xoay tròn", kind: "loop" },
  { id: "flicker", label: "Chập chờn", kind: "loop" }, { id: "blink", label: "Nhấp nháy", kind: "loop" },
  { id: "wave", label: "Lượn sóng", kind: "loop" }, { id: "jiggle", label: "Lắc lư", kind: "loop" },
  { id: "heartbeat", label: "Nhịp tim", kind: "loop" }, { id: "rainbow", label: "Đổi màu cầu vồng", kind: "loop" },
  { id: "bounce_loop", label: "Nảy liên tục", kind: "loop" },
  { id: "punch", label: "Đập (theo nhịp)", kind: "emphasis" }, { id: "bounce", label: "Nảy", kind: "emphasis" },
  { id: "jump", label: "Nhảy", kind: "emphasis" }, { id: "flash", label: "Chớp", kind: "emphasis" },
  { id: "rubber", label: "Dây thun", kind: "emphasis" }, { id: "tada", label: "Ta-da", kind: "emphasis" },
  { id: "wobble", label: "Lắc", kind: "emphasis" }, { id: "headshake", label: "Lắc đầu", kind: "emphasis" },
];
export const ANIM_KIND_LABEL: Record<AnimKind, string> = { in: "Xuất hiện", out: "Biến mất", loop: "Lặp liên tục", emphasis: "Nhấn" };
export const UNIT_LABEL: Record<AnimUnit, string> = { layer: "Cả lớp", line: "Từng dòng", word: "Từng từ", char: "Từng chữ cái" };
export const animLabel = (a: Anim) => ANIMS.find((x) => x.id === a.preset && x.kind === a.kind)?.label ?? a.preset;

// ------------------------------------------------------------------ chữ
export interface Warp { type: "arc" | "wave"; amount: number }
export interface TextBackground { color: string; fill?: Fill | null; padding: number; radius: number; mode?: "box" | "line" | null }
export interface TextStyle {
  font: string;
  weight: number;
  size: number; // theo khung cao 1080
  fill: Fill;
  background?: TextBackground | null;
  align: "left" | "center" | "right" | "justify";
  letter_spacing: number;
  word_spacing?: number;
  max_width: number; // 0..1
  line_height?: number; // bội số cỡ chữ, 0 = mặc định
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  case?: "none" | "upper" | "lower" | "title" | null;
  warp?: Warp | null;
  /** chỉ dùng trong span để ghi đè viền */
  strokes?: Stroke[];
}
/** Đoạn chữ có kiểu riêng; start/end theo vị trí ký tự. */
export interface Span { start: number; end: number; style: Partial<TextStyle>; timing?: Timing | null }

/** Hiệu ứng có sẵn trong engine. Ngoài ra `type` có thể là id của một gói thư viện (library/effects/<id>). */
export type BuiltinEffect = "blur" | "dim" | "brightness" | "saturation" | "grayscale" | "contrast" | "exposure" | "temperature" | "hue";
export const BUILTIN_EFFECTS: BuiltinEffect[] = ["exposure", "brightness", "contrast", "saturation", "temperature", "hue", "grayscale", "dim", "blur"];
export interface Effect {
  type: BuiltinEffect | string;
  /** có sẵn: mức; gói thư viện: độ mạnh 0..100 (mặc định 100) */
  amount?: number;
  /** tham số của gói thư viện */
  params?: Record<string, number | string>;
  timing?: Timing | null;
  ramp?: number;
}

interface LayerBase {
  id: string;
  name: string;
  start: number;
  duration: number;
  /** thời gian theo mốc (ưu tiên hơn start/duration) */
  timing?: Timing | null;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number; // 0..100
  animations?: Anim[];
  /** keyframe theo đường dẫn bất kỳ: "x", "style.size", "effects.0.amount", "strokes.0.color"… */
  keyframes?: Record<string, Keyframe[]>;
  effects?: Effect[];
  /** viền nhiều lớp — mọi loại lớp */
  strokes?: Stroke[];
  /** bóng / phát sáng nhiều lớp — mọi loại lớp */
  shadows?: Shadow[];
  hidden?: boolean;
  locked?: boolean;
  blend?: BlendMode | null;
  mask?: Mask | null;
  crop?: Crop | null;
  flip_h?: boolean;
  flip_v?: boolean;
  /** tốc độ nguồn (video/audio) 0.1..5 */
  speed?: number;
  /** âm lượng to dần / nhỏ dần (giây) */
  fade_in?: number;
  fade_out?: number;
  background_fill?: "none" | "blur" | null;
}

export interface VideoLayer extends LayerBase {
  type: "video";
  source: string; // "asset:<id>"
  filename?: string;
  fit: "contain" | "cover";
  trim_start: number;
  source_duration?: number;
  volume: number; // 0..100
  muted: boolean;
}
export interface ImageLayer extends LayerBase {
  type: "image";
  source: string;
  filename?: string;
  fit: "contain" | "cover";
}
export interface TextLayer extends LayerBase {
  type: "text";
  text: string;
  style: TextStyle;
  spans?: Span[];
}
export interface ShapeLayer extends LayerBase {
  type: "shape";
  shape: "rect" | "circle" | "star";
  w: number;
  h: number;
  fill: Fill;
  corner_radius: number;
}
/** Lớp điều chỉnh: không có hình riêng, áp `effects` lên mọi thứ bên dưới trong thời gian của nó (bộ màu, chuyển cảnh…). */
export interface AdjustLayer extends LayerBase {
  type: "adjust";
}
export interface AudioLayer extends LayerBase {
  type: "audio";
  source: string;
  filename?: string;
  trim_start: number;
  source_duration?: number;
  volume: number;
  muted: boolean;
}

export type Layer = VideoLayer | ImageLayer | TextLayer | ShapeLayer | AudioLayer | AdjustLayer;

export interface Composition {
  version: 1;
  canvas: { width: number; height: number; fps: number; background: string };
  duration: number;
  markers?: Marker[];
  layers: Layer[]; // phần tử sau nằm trên
}

export const EASES: Ease[] = ["linear", "ease_in", "ease_out", "ease_in_out", "back", "elastic", "bounce"];

/** Kiểu chữ có sẵn: phần áp cho style + viền + bóng của lớp. (Sẽ chuyển thành dữ liệu thư viện `style`.) */
export const TEXT_PRESETS: Record<string, { label: string; style: Partial<TextStyle>; strokes: Stroke[]; shadows: Shadow[] }> = {
  classic: { label: "Trắng viền đen", style: { fill: "#FFFFFF", weight: 800 }, strokes: [{ color: "#000000", width: 4 }], shadows: [{ color: "#00000099", x: 3, y: 4, blur: 6 }] },
  sticker: { label: "Sticker", style: { fill: "#FFFFFF", weight: 900 }, strokes: [{ color: "#FF3D7F", width: 6 }, { color: "#FFFFFF", width: 14 }], shadows: [{ color: "#00000066", x: 4, y: 6, blur: 8 }] },
  neon: { label: "Neon hồng", style: { fill: "#FFE6F6", weight: 600 }, strokes: [], shadows: [{ kind: "neon", color: "#FF2FB3", x: 0, y: 0, blur: 30 }] },
  neon_blue: { label: "Neon xanh", style: { fill: "#E6FBFF", weight: 600 }, strokes: [{ color: "#00E5FF", width: 2 }], shadows: [{ kind: "neon", color: "#00B8FF", x: 0, y: 0, blur: 34 }] },
  gold: { label: "Vàng kim", style: { fill: { type: "linear", stops: ["#FFF6C2", "#FFC83D", "#B8860B", "#FFE48A"], angle: 90 }, weight: 900 }, strokes: [{ color: "#4E342E", width: 5 }], shadows: [{ color: "#000000AA", x: 4, y: 6, blur: 6 }] },
  fire: { label: "Lửa", style: { fill: { type: "linear", stops: ["#FFF176", "#FF9800", "#E53935"], angle: 90 }, weight: 900 }, strokes: [], shadows: [{ kind: "glow", color: "#FF6D00", x: 0, y: 0, blur: 30 }] },
  comic: { label: "Truyện tranh", style: { fill: "#FFEB3B", weight: 900 }, strokes: [{ color: "#000000", width: 8 }], shadows: [{ kind: "long", color: "#000000", x: 1, y: 1, length: 14, blur: 0 }] },
  retro_3d: { label: "3D cổ điển", style: { fill: "#FFD23F", weight: 900 }, strokes: [{ color: "#3A0CA3", width: 3 }], shadows: [{ kind: "extrude", color: "#F72585", x: 1, y: 1, length: 22, blur: 0 }] },
  chrome: { label: "Kim loại", style: { fill: { type: "linear", stops: ["#FFFFFF", "#9EA7B3", "#F5F7FA", "#5B6573"], angle: 90 }, weight: 900 }, strokes: [{ color: "#1C1F24", width: 4 }], shadows: [{ color: "#00000099", x: 0, y: 6, blur: 10 }] },
  rainbow: { label: "Cầu vồng", style: { fill: { type: "linear", stops: ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#007AFF", "#AF52DE"], angle: 0 }, weight: 900 }, strokes: [{ color: "#FFFFFF", width: 5 }], shadows: [{ color: "#00000080", x: 3, y: 5, blur: 8 }] },
  subtitle: { label: "Phụ đề", style: { fill: "#FFFFFF", weight: 700, background: { color: "#000000B3", padding: 0.35, radius: 10, mode: "line" } }, strokes: [], shadows: [] },
  lower_third: { label: "Dải tên", style: { fill: "#FFFFFF", weight: 700, background: { color: "#2F6FED", padding: 0.45, radius: 6, mode: "box" } }, strokes: [], shadows: [{ color: "#00000066", x: 0, y: 6, blur: 12 }] },
};

export const defaultTextStyle = (): TextStyle => ({
  font: "Noto Sans", weight: 800, size: 96, fill: "#FFFFFF", align: "center", letter_spacing: 0, max_width: 0.9,
});

/** Bản dựng còn dạng cũ (animation in/out/loop, style.color/stroke/shadow/glow, shape.stroke) → nâng cấp qua engine. */
export function isLegacy(c: Composition): boolean {
  return c.layers.some((l) => {
    const x = l as unknown as Record<string, unknown>;
    const st = (x.style ?? {}) as Record<string, unknown>;
    return "animation" in x || "stroke" in x || ["color", "gradient", "stroke", "shadow", "glow", "uppercase"].some((k) => k in st);
  });
}

let seq = 0;
export const newId = (p: string) => `${p}_${Date.now().toString(36)}${(++seq).toString(36)}`;

export function newComposition(ratio: "16:9" | "9:16" | "1:1" = "16:9"): Composition {
  const size = ratio === "16:9" ? [1920, 1080] : ratio === "9:16" ? [1080, 1920] : [1080, 1080];
  return { version: 1, canvas: { width: size[0], height: size[1], fps: 30, background: "#000000" }, duration: 10, markers: [], layers: [] };
}

const base = (name: string, start: number, duration: number) => ({
  id: newId("l"), name, start, duration, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 100,
  animations: [] as Anim[], keyframes: {}, effects: [] as Effect[], strokes: [] as Stroke[], shadows: [] as Shadow[],
});

export function textLayer(start: number, text = "Chữ nghệ thuật"): TextLayer {
  const p = TEXT_PRESETS.classic;
  return {
    ...base("Chữ", start, 4), type: "text", text, style: { ...defaultTextStyle(), ...p.style }, strokes: p.strokes, shadows: p.shadows,
    animations: [{ preset: "pop_bounce", kind: "in", duration: 0.6 }, { preset: "fade", kind: "out", duration: 0.4 }],
  };
}
export function shapeLayer(start: number, shape: ShapeLayer["shape"] = "rect"): ShapeLayer {
  return { ...base("Hình", start, 4), type: "shape", shape, w: 0.3, h: 0.2, fill: "#2F6FED", corner_radius: 16 };
}
/** Lớp điều chỉnh mang một hiệu ứng thư viện (chuyển cảnh: đặt đè lên chỗ cắt). */
export function adjustLayer(start: number, duration: number, name: string, effect?: Effect): AdjustLayer {
  return { ...base(name, Math.max(0, start), duration), type: "adjust", effects: effect ? [effect] : [] };
}
export function mediaLayer(start: number, asset: { asset_id: string; format: string; filename?: string }, sourceDuration?: number): Layer {
  const src = `asset:${asset.asset_id}`;
  const dur = sourceDuration && sourceDuration > 0 ? sourceDuration : 5;
  if (asset.format === "audio")
    return { ...base(asset.filename ?? "Âm thanh", start, dur), type: "audio", source: src, filename: asset.filename, trim_start: 0, source_duration: sourceDuration, volume: 100, muted: false };
  if (asset.format === "image")
    return { ...base(asset.filename ?? "Ảnh", start, 5), type: "image", source: src, filename: asset.filename, fit: "contain" };
  return { ...base(asset.filename ?? "Video", start, dur), type: "video", source: src, filename: asset.filename, fit: "contain", trim_start: 0, source_duration: sourceDuration, volume: 100, muted: false };
}

export const layerEnd = (l: Layer) => l.start + l.duration;
export const compEnd = (c: Composition) => Math.max(1, ...c.layers.map(layerEnd));

/** Tách lớp tại thời điểm t (giây tuyệt đối). Trả [phần trước, phần sau] hoặc null nếu t không nằm trong lớp. */
export function splitLayer(l: Layer, t: number): [Layer, Layer] | null {
  if (t <= l.start + 0.05 || t >= layerEnd(l) - 0.05) return null;
  const anims = l.animations ?? [];
  const left = { ...l, timing: null, duration: t - l.start, animations: anims.filter((a) => a.kind !== "out") } as Layer;
  const right = { ...l, timing: null, id: newId("l"), start: t, duration: layerEnd(l) - t, animations: anims.filter((a) => a.kind !== "in") } as Layer;
  if ("trim_start" in right) (right as VideoLayer).trim_start = (l as VideoLayer).trim_start + (t - l.start) * (l.speed ?? 1);
  return [left, right];
}

/** Giá trị nội suy tuyến tính của keyframe số (dùng hiển thị ở inspector; engine tự nội suy khi render). */
export function valueAt(l: Layer, prop: AnimProp, t: number): number {
  const kfs = l.keyframes?.[prop];
  const fallback = prop === "opacity" ? l.opacity : (l[prop] as number);
  if (!kfs?.length) return fallback;
  const local = t - l.start;
  const sorted = [...kfs].sort((a, b) => a.t - b.t);
  const num = (k: Keyframe) => Number(k.value);
  if (local <= sorted[0].t) return num(sorted[0]);
  for (let i = 1; i < sorted.length; i++) {
    if (local <= sorted[i].t) {
      const a = sorted[i - 1], b = sorted[i];
      const k = (local - a.t) / Math.max(1e-6, b.t - a.t);
      return num(a) + (num(b) - num(a)) * k;
    }
  }
  return num(sorted[sorted.length - 1]);
}

/** Danh sách asset id mà composition dùng (để truyền cho tool compose_render) — gồm cả ảnh dùng để tô màu. */
export function referencedAssets(c: Composition): string[] {
  const ids = new Set<string>();
  const add = (src?: string) => { if (src?.startsWith("asset:")) ids.add(src.slice(6)); };
  const fillSrc = (f?: Fill | null) => (f && typeof f === "object" && f.type === "image" ? f.source : undefined);
  for (const l of c.layers) {
    if ("source" in l) add(l.source);
    if (l.type === "text") add(fillSrc(l.style.fill));
    if (l.type === "shape") add(fillSrc(l.fill));
    for (const s of l.strokes ?? []) add(fillSrc(s.fill));
  }
  return [...ids];
}

/** Đổi tốc độ nhưng giữ nguyên đoạn nguồn đang dùng: thời lượng trên timeline co/giãn theo. */
export function retime(l: Layer, speed: number): Partial<Layer> {
  const s = Math.min(SPEED.max, Math.max(SPEED.min, speed));
  const span = l.duration * (l.speed ?? 1);
  return { speed: s, duration: +(span / s).toFixed(3) };
}

/** Sao chép lớp với id mới (dán/nhân bản). */
export function cloneLayer(l: Layer, start?: number): Layer {
  return { ...structuredClone(l), id: newId("l"), start: start ?? l.start, timing: null } as Layer;
}

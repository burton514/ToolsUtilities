// Composition (bản dựng) — khớp với engine Rust `mediatool-engine::model`. Xem docs/COMPOSITION_FORMAT.md.
// Thời gian tính bằng giây; vị trí/kích thước theo tỉ lệ 0..1 của khung hình.

export type Ease = "linear" | "ease_in" | "ease_out" | "ease_in_out" | "back" | "elastic" | "bounce";
export type AnimProp = "x" | "y" | "scale" | "rotation" | "opacity";

export interface Keyframe {
  t: number; // giây, tính từ lúc lớp bắt đầu
  value: number;
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

export interface AnimPreset {
  preset: string;
  duration: number;
}

export interface TextStyle {
  font: string;
  weight: number;
  size: number; // theo khung cao 1080
  color: string;
  gradient?: { colors: string[]; angle: number } | null;
  stroke?: { color: string; width: number } | null;
  shadow?: { color: string; x: number; y: number; blur: number } | null;
  glow?: { color: string; radius: number } | null;
  background?: { color: string; padding: number; radius: number } | null;
  align: "left" | "center" | "right";
  letter_spacing: number;
  max_width: number; // 0..1
  line_height?: number; // bội số cỡ chữ, 0 = mặc định
  italic?: boolean;
  uppercase?: boolean;
}

export interface Effect {
  type: "blur" | "dim" | "brightness" | "saturation" | "grayscale" | "contrast" | "exposure" | "temperature" | "hue";
  amount: number;
}

interface LayerBase {
  id: string;
  name: string;
  start: number;
  duration: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number; // 0..100
  animation?: { in?: AnimPreset | null; out?: AnimPreset | null; loop?: AnimPreset | null };
  keyframes?: Partial<Record<AnimProp, Keyframe[]>>;
  effects?: Effect[];
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
}
export interface ShapeLayer extends LayerBase {
  type: "shape";
  shape: "rect" | "circle" | "star";
  w: number;
  h: number;
  fill: string;
  stroke?: { color: string; width: number } | null;
  corner_radius: number;
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

export type Layer = VideoLayer | ImageLayer | TextLayer | ShapeLayer | AudioLayer;

export interface Composition {
  version: 1;
  canvas: { width: number; height: number; fps: number; background: string };
  duration: number;
  layers: Layer[]; // phần tử sau nằm trên
}

export const ANIM_IN = ["none", "fade", "fade_up", "slide_left", "slide_right", "slide_up", "zoom_in", "pop_bounce", "drop", "blur_in", "typewriter", "spin_in", "wipe_left", "wipe_right", "wipe_up", "wipe_down", "circle_open"];
export const ANIM_OUT = ["none", "fade", "fade_down", "slide_left", "slide_right", "zoom_out", "blur_out", "spin_out", "wipe_left", "wipe_right", "wipe_up", "wipe_down", "circle_close"];
export const ANIM_LOOP = ["none", "float", "pulse", "shake", "swing", "rotate", "flicker"];
export const EASES: Ease[] = ["linear", "ease_in", "ease_out", "ease_in_out", "back", "elastic", "bounce"];

export const TEXT_PRESETS: Record<string, Partial<TextStyle>> = {
  classic_white: { color: "#FFFFFF", stroke: { color: "#000000", width: 4 }, shadow: { color: "#00000099", x: 2, y: 3, blur: 4 }, gradient: null, glow: null, background: null },
  neon_pink: { color: "#FFE6F6", stroke: null, glow: { color: "#FF2FB3", radius: 18 }, gradient: null, shadow: null, background: null, weight: 600 },
  gold_luxury: { color: "#FFD54F", gradient: { colors: ["#FFF3B0", "#FFB300", "#B8860B"], angle: 90 }, stroke: { color: "#4E342E", width: 5 }, shadow: { color: "#000000AA", x: 4, y: 6, blur: 6 }, glow: null, background: null, weight: 800 },
  fire: { gradient: { colors: ["#FFF176", "#FF9800", "#E53935"], angle: 90 }, glow: { color: "#FF6D00", radius: 16 }, stroke: null, shadow: null, background: null, weight: 800 },
  comic_pop: { color: "#FFEB3B", stroke: { color: "#000000", width: 10 }, shadow: { color: "#000000", x: 8, y: 8, blur: 0 }, glow: null, gradient: null, background: null, weight: 900 },
  lower_third: { color: "#FFFFFF", background: { color: "#000000B3", padding: 0.35, radius: 10 }, stroke: null, shadow: null, glow: null, gradient: null, weight: 600 },
};

export const defaultTextStyle = (): TextStyle => ({
  font: "Noto Sans", weight: 700, size: 96, color: "#FFFFFF", align: "center", letter_spacing: 0, max_width: 0.9,
  ...TEXT_PRESETS.classic_white,
} as TextStyle);

let seq = 0;
export const newId = (p: string) => `${p}_${Date.now().toString(36)}${(++seq).toString(36)}`;

export function newComposition(ratio: "16:9" | "9:16" | "1:1" = "16:9"): Composition {
  const size = ratio === "16:9" ? [1920, 1080] : ratio === "9:16" ? [1080, 1920] : [1080, 1080];
  return { version: 1, canvas: { width: size[0], height: size[1], fps: 30, background: "#000000" }, duration: 10, layers: [] };
}

const base = (name: string, start: number, duration: number) => ({
  id: newId("l"), name, start, duration, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 100,
  animation: { in: null, out: null, loop: null }, keyframes: {}, effects: [],
});

export function textLayer(start: number, text = "Chữ nghệ thuật"): TextLayer {
  return { ...base("Chữ", start, 4), type: "text", text, style: defaultTextStyle(), animation: { in: { preset: "pop_bounce", duration: 0.6 }, out: { preset: "fade", duration: 0.4 }, loop: null } };
}
export function shapeLayer(start: number, shape: ShapeLayer["shape"] = "rect"): ShapeLayer {
  return { ...base("Hình", start, 4), type: "shape", shape, w: 0.3, h: 0.2, fill: "#2F6FED", stroke: null, corner_radius: 16 };
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
  const left = { ...l, duration: t - l.start, animation: { ...l.animation, out: null } } as Layer;
  const right = { ...l, id: newId("l"), start: t, duration: layerEnd(l) - t, animation: { ...l.animation, in: null } } as Layer;
  if ("trim_start" in right) (right as VideoLayer).trim_start = (l as VideoLayer).trim_start + (t - l.start) * (l.speed ?? 1);
  return [left, right];
}

/** Giá trị nội suy tuyến tính của keyframe (dùng hiển thị ở inspector; engine tự nội suy khi render). */
export function valueAt(l: Layer, prop: AnimProp, t: number): number {
  const kfs = l.keyframes?.[prop];
  const fallback = prop === "opacity" ? l.opacity : (l[prop] as number);
  if (!kfs?.length) return fallback;
  const local = t - l.start;
  const sorted = [...kfs].sort((a, b) => a.t - b.t);
  if (local <= sorted[0].t) return sorted[0].value;
  for (let i = 1; i < sorted.length; i++) {
    if (local <= sorted[i].t) {
      const a = sorted[i - 1], b = sorted[i];
      const k = (local - a.t) / Math.max(1e-6, b.t - a.t);
      return a.value + (b.value - a.value) * k;
    }
  }
  return sorted[sorted.length - 1].value;
}

/** Danh sách asset id mà composition dùng (để truyền cho tool compose_render). */
export function referencedAssets(c: Composition): string[] {
  const ids = new Set<string>();
  for (const l of c.layers) if ("source" in l && l.source.startsWith("asset:")) ids.add(l.source.slice(6));
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
  return { ...structuredClone(l), id: newId("l"), start: start ?? l.start } as Layer;
}

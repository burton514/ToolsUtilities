// Control dùng chung cho MỌI loại lớp — viết một lần: màu, Fill, danh sách (viền/bóng/hiệu ứng/animation),
// mốc thời gian (TimeRef/Timing). Inspector chỉ ghép các control này lại.
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { Field, NumberInput, Select, Slider, TextInput } from "./prop";
import type { EffectInfo } from "@mediatool/api-client";
import { CATEGORY_LABEL, defaultParams } from "./fxlib";
import {
  ANIM_KIND_LABEL, ANIMS, EASES, UNIT_LABEL,
  type Anim, type AnimKind, type AnimUnit, type Composition, type Effect, type Fill, type Shadow, type ShadowKind, type Stop, type Stroke,
  type TimeRef, type Timing,
} from "./model";

// ------------------------------------------------------------------ màu
/** Ô màu: ô xem màu (bấm để chọn) + mã màu gõ được + độ rõ (%). Lưu dạng #RRGGBB hoặc #RRGGBBAA. */
export function ColorInput({ label, value, onChange }: { label?: ReactNode; value: string; onChange: (v: string) => void }) {
  const v = value || "#000000";
  const hex = v.slice(0, 7).toUpperCase();
  const alpha = v.length === 9 ? Math.round((parseInt(v.slice(7), 16) / 255) * 100) : 100;
  const withAlpha = (h: string, a: number) => (a >= 100 ? h : h + Math.round((a / 100) * 255).toString(16).padStart(2, "0").toUpperCase());
  const [draft, setDraft] = useState<string | null>(null);
  const el = (
    <div className="ip-color">
      <label className="ip-swatch" style={{ background: v.length === 9 ? `linear-gradient(${v},${v}), repeating-conic-gradient(#888 0 25%, #ccc 0 50%) 50%/8px 8px` : v }} title="Chọn màu">
        <input type="color" value={hex.toLowerCase()} onChange={(e) => onChange(withAlpha(e.target.value.toUpperCase(), alpha))} />
      </label>
      <input className="ip-hex" value={draft ?? hex.slice(1)} maxLength={6} aria-label="Mã màu"
        onFocus={(e) => { setDraft(hex.slice(1)); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9a-fA-F]/g, ""))}
        onBlur={() => { if (draft && /^[0-9a-fA-F]{6}$/.test(draft)) onChange(withAlpha("#" + draft.toUpperCase(), alpha)); setDraft(null); }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      <NumberInput value={alpha} min={0} max={100} step={1} unit="%" onChange={(a) => onChange(withAlpha(hex, Math.max(0, Math.min(100, a))))} />
    </div>
  );
  return label ? <Field label={label}>{el}</Field> : el;
}

// ------------------------------------------------------------------ Fill
const stopColor = (s: Stop) => (typeof s === "string" ? s : s.color);
type FillType = "solid" | "linear" | "radial" | "sweep" | "image";
const fillType = (f: Fill): FillType => (typeof f === "string" ? "solid" : f.type);

/** Xem trước Fill bằng CSS (chỉ để nhìn; engine mới là nơi vẽ thật). */
export function fillCss(f: Fill): string {
  if (typeof f === "string") return f;
  if (f.type === "solid") return f.color;
  if (f.type === "image") return "repeating-linear-gradient(45deg,#888 0 6px,#bbb 6px 12px)";
  const cols = f.stops.map(stopColor).join(", ");
  if (f.type === "linear") return `linear-gradient(${f.angle + 90}deg, ${cols})`;
  if (f.type === "radial") return `radial-gradient(circle at ${f.cx * 100}% ${f.cy * 100}%, ${cols})`;
  return `conic-gradient(from ${f.angle}deg at ${f.cx * 100}% ${f.cy * 100}%, ${cols})`;
}

export const GRADIENT_PRESETS: Stop[][] = [
  ["#FFF6C2", "#FFC83D", "#B8860B", "#FFE48A"], ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#007AFF", "#AF52DE"],
  ["#FF5F6D", "#FFC371"], ["#00C6FF", "#0072FF"], ["#F72585", "#7209B7", "#3A0CA3"], ["#B2FF59", "#00E676"],
  ["#FFFFFF", "#9EA7B3", "#F5F7FA", "#5B6573"], ["#FF9A9E", "#FECFEF"], ["#43E97B", "#38F9D7"], ["#FA709A", "#FEE140"],
];

/** Chọn cách tô: màu đơn · chuyển màu (thẳng / tròn / xoay vòng) · ảnh họa tiết. */
export function FillEditor({ label, value, onChange, images }: { label: ReactNode; value: Fill; onChange: (f: Fill, merge?: string) => void; images?: { id: string; name: string }[] }) {
  const t = fillType(value);
  const stops: Stop[] = typeof value === "object" && "stops" in value ? value.stops : [typeof value === "string" ? value : value.type === "solid" ? value.color : "#FFFFFF", "#FF8F00"];
  const setType = (nt: FillType) => {
    const first = stopColor(stops[0]);
    if (nt === "solid") return onChange(first);
    if (nt === "linear") return onChange({ type: "linear", stops, angle: 90 });
    if (nt === "radial") return onChange({ type: "radial", stops, cx: 0.5, cy: 0.5, r: 0.6 });
    if (nt === "sweep") return onChange({ type: "sweep", stops, cx: 0.5, cy: 0.5, angle: 0 });
    onChange({ type: "image", source: images?.[0] ? `asset:${images[0].id}` : "", scale: 1 });
  };
  const setStops = (s: Stop[], merge?: string) => typeof value === "object" && "stops" in value && onChange({ ...value, stops: s }, merge);
  return (
    <div className="ed-fill">
      <div className="ed-fill-head">
        <span className="ip-label-text">{label}</span>
        <span className="ed-swatch" style={{ background: fillCss(value) }} />
      </div>
      <div className="ip-seg">
        {([["solid", "Màu"], ["linear", "Thẳng"], ["radial", "Tròn"], ["sweep", "Vòng"], ["image", "Ảnh"]] as [FillType, string][]).map(([k, l]) => (
          <button key={k} className={t === k ? "on" : ""} onClick={() => setType(k)}>{l}</button>
        ))}
      </div>
      {t === "solid" && <ColorInput value={typeof value === "string" ? value : (value as { color: string }).color} onChange={(c) => onChange(c, "fill-c")} />}
      {(t === "linear" || t === "radial" || t === "sweep") && typeof value === "object" && "stops" in value && (
        <>
          <div className="ed-stops">
            {stops.map((s, i) => (
              <div key={i} className="ed-stop">
                <ColorInput value={stopColor(s)} onChange={(c) => setStops(stops.map((x, j) => (j === i ? c : x)), `stop-${i}`)} />
                {stops.length > 2 && <button className="ed-ibtn" aria-label="Bỏ màu này" title="Bỏ màu này" onClick={() => setStops(stops.filter((_, j) => j !== i))}><Trash2 size={13} /></button>}
              </div>
            ))}
            <button className="ed-addbtn" onClick={() => setStops([...stops, stopColor(stops[stops.length - 1])])}><Plus size={13} /> Thêm màu</button>
          </div>
          <div className="ed-presets">
            {GRADIENT_PRESETS.map((g, i) => (
              <button key={i} className="ed-gradchip" title="Dùng dải màu này" style={{ background: `linear-gradient(90deg, ${g.map(stopColor).join(",")})` }} onClick={() => setStops(g)} />
            ))}
          </div>
          {"angle" in value && <Slider label="Góc" value={value.angle} min={0} max={360} format={(v) => `${Math.round(v)}°`} onChange={(angle) => onChange({ ...value, angle } as Fill, "fill-a")} />}
          {"cx" in value && (
            <div className="ed-grid2">
              <Slider label="Tâm ngang" value={value.cx} min={0} max={1} step={0.01} onChange={(cx) => onChange({ ...value, cx } as Fill, "fill-cx")} />
              <Slider label="Tâm dọc" value={value.cy} min={0} max={1} step={0.01} onChange={(cy) => onChange({ ...value, cy } as Fill, "fill-cy")} />
            </div>
          )}
          {"r" in value && <Slider label="Bán kính" value={value.r} min={0.05} max={1.5} step={0.01} onChange={(r) => onChange({ ...value, r } as Fill, "fill-r")} />}
        </>
      )}
      {t === "image" && typeof value === "object" && value.type === "image" && (
        <>
          <Select label="Ảnh họa tiết" value={value.source} options={[{ value: "", label: "— chọn ảnh trong thư viện —" }, ...(images ?? []).map((im) => ({ value: `asset:${im.id}`, label: im.name }))]}
            onChange={(source) => onChange({ ...value, source })} />
          <Slider label="Phóng họa tiết" value={value.scale} min={0.2} max={5} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(scale) => onChange({ ...value, scale }, "fill-s")} />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ danh sách chung
/** Danh sách có thêm / xóa / đổi thứ tự / thu gọn — dùng cho viền, bóng, hiệu ứng, animation, đoạn chữ. */
export function ListEditor<T>({ title, items, onChange, make, render, summary, hint, addLabel = "Thêm" }: {
  title: ReactNode; items: T[]; onChange: (v: T[], merge?: string) => void; make: () => T;
  render: (item: T, set: (patch: Partial<T>, merge?: string) => void, i: number) => ReactNode;
  summary: (item: T, i: number) => ReactNode; hint?: ReactNode; addLabel?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const n = [...items];
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
    setOpen(j);
  };
  return (
    <div className="ed-list">
      <div className="ed-list-head">
        <span className="ed-list-title">{title}</span>
        <button className="ip-icon add" title={addLabel} aria-label={addLabel} onClick={() => { onChange([...items, make()]); setOpen(items.length); }}><Plus size={15} /></button>
      </div>
      {hint && !items.length && <div className="mt-hint">{hint}</div>}
      {items.map((it, i) => (
        <div key={i} className={`ed-item ${open === i ? "open" : ""}`}>
          <div className="ed-item-head" onClick={() => setOpen(open === i ? null : i)}>
            {open === i ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="ed-item-sum">{summary(it, i)}</span>
            <button className="ed-ibtn" aria-label="Lên" title="Lên" onClick={(e) => { e.stopPropagation(); move(i, -1); }}><ArrowUp size={13} /></button>
            <button className="ed-ibtn" aria-label="Xuống" title="Xuống" onClick={(e) => { e.stopPropagation(); move(i, 1); }}><ArrowDown size={13} /></button>
            <button className="ed-ibtn" aria-label="Xóa" title="Xóa" onClick={(e) => { e.stopPropagation(); onChange(items.filter((_, j) => j !== i)); setOpen(null); }}><Trash2 size={13} /></button>
          </div>
          {open === i && <div className="ed-item-body">{render(it, (patch, merge) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)), merge && `${merge}-${i}`), i)}</div>}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ viền, bóng
export function StrokeList({ items, onChange, unitHint, images }: { items: Stroke[]; onChange: (v: Stroke[], merge?: string) => void; unitHint: string; images?: { id: string; name: string }[] }) {
  return (
    <ListEditor<Stroke> title="Viền" items={items} onChange={onChange} addLabel="Thêm viền"
      hint="Thêm nhiều lớp viền chồng nhau (lớp trên cùng là viền trong cùng) để làm kiểu sticker."
      make={() => ({ color: "#000000", width: items.length ? (items[items.length - 1].width + 8) : 4 })}
      summary={(s) => <><span className="ed-swatch sm" style={{ background: fillCss(s.fill ?? s.color ?? "#000") }} /> Dày {s.width}</>}
      render={(s, set) => (
        <>
          <FillEditor label="Màu viền" value={s.fill ?? s.color ?? "#000000"} images={images} onChange={(f, m) => set({ fill: typeof f === "string" ? null : f, color: typeof f === "string" ? f : s.color }, m)} />
          <Slider label="Độ dày" value={s.width} min={0.5} max={60} step={0.5} hint={unitHint} onChange={(width) => set({ width }, "sw")} />
          <Slider label="Độ rõ" value={s.opacity ?? 100} min={0} max={100} unit="%" onChange={(opacity) => set({ opacity }, "so")} />
          <Select label="Góc viền" value={s.join ?? "round"} options={[{ value: "round", label: "Tròn" }, { value: "miter", label: "Nhọn" }, { value: "bevel", label: "Vát" }]} onChange={(join) => set({ join })} />
        </>
      )} />
  );
}

const SHADOW_LABEL: Record<ShadowKind, string> = { drop: "Đổ bóng", glow: "Phát sáng", neon: "Neon", long: "Bóng dài", extrude: "Nổi khối 3D" };

export function ShadowList({ items, onChange }: { items: Shadow[]; onChange: (v: Shadow[], merge?: string) => void }) {
  return (
    <ListEditor<Shadow> title="Bóng · phát sáng" items={items} onChange={onChange} addLabel="Thêm bóng"
      hint="Đổ bóng, phát sáng, neon, bóng dài, nổi khối 3D — dùng được cho chữ, hình, ảnh, video."
      make={() => ({ kind: "drop", color: "#000000AA", x: 4, y: 6, blur: 8 })}
      summary={(s) => <><span className="ed-swatch sm" style={{ background: s.color }} /> {SHADOW_LABEL[s.kind ?? "drop"]}</>}
      render={(s, set) => {
        const kind = s.kind ?? "drop";
        return (
          <>
            <Select label="Kiểu" value={kind} options={(Object.keys(SHADOW_LABEL) as ShadowKind[]).map((k) => ({ value: k, label: SHADOW_LABEL[k] }))}
              onChange={(k) => set({ kind: k, ...(k === "glow" || k === "neon" ? { x: 0, y: 0, blur: s.blur || 24 } : k === "long" || k === "extrude" ? { x: 1, y: 1, length: s.length || 20 } : {}) })} />
            <ColorInput label="Màu" value={s.color} onChange={(color) => set({ color }, "shc")} />
            {(kind === "drop" || kind === "long" || kind === "extrude") && (
              <div className="ed-grid2">
                <Slider label={kind === "drop" ? "Lệch ngang" : "Hướng ngang"} value={s.x} min={-40} max={40} step={0.5} onChange={(x) => set({ x }, "shx")} />
                <Slider label={kind === "drop" ? "Lệch dọc" : "Hướng dọc"} value={s.y} min={-40} max={40} step={0.5} onChange={(y) => set({ y }, "shy")} />
              </div>
            )}
            {(kind === "long" || kind === "extrude") && <Slider label="Độ dài" value={s.length ?? 20} min={2} max={200} onChange={(length) => set({ length }, "shl")} />}
            <Slider label={kind === "glow" || kind === "neon" ? "Độ lan" : "Độ nhòe"} value={s.blur} min={0} max={120} onChange={(blur) => set({ blur }, "shb")} />
            {kind === "drop" && <Slider label="Nở bóng" value={s.spread ?? 0} min={0} max={30} onChange={(spread) => set({ spread }, "shs")} />}
            <Slider label="Độ rõ" value={s.opacity ?? 100} min={0} max={100} unit="%" onChange={(opacity) => set({ opacity }, "sho")} />
          </>
        );
      }} />
  );
}

// ------------------------------------------------------------------ mốc thời gian
type RefMode = "abs" | "self.start" | "self.end" | "marker" | "layer" | "beat" | "downbeat";
function refMode(r: TimeRef | null | undefined): RefMode {
  if (r == null || typeof r === "number") return "abs";
  if (r.ref.startsWith("marker:")) return "marker";
  if (r.ref.startsWith("layer:")) return "layer";
  if (r.ref === "beat" || r.ref.startsWith("beat:")) return "beat";
  if (r.ref === "downbeat" || r.ref.startsWith("downbeat:")) return "downbeat";
  return r.ref === "self.end" || r.ref === "end" ? "self.end" : "self.start";
}

/** Một mốc thời gian: số giây, hoặc neo vào đầu/cuối lớp, mốc có tên, lớp khác, beat thứ n — có lệch (giây). */
export function TimeRefInput({ label, value, onChange, comp, selfId, fallback }: {
  label: ReactNode; value: TimeRef | null | undefined; onChange: (v: TimeRef | null) => void; comp: Composition; selfId?: string; fallback: number;
}) {
  const mode = refMode(value);
  const offset = typeof value === "object" && value ? value.offset ?? 0 : 0;
  const refStr = typeof value === "object" && value ? value.ref : "";
  const markers = comp.markers ?? [];
  const named = markers.filter((m) => !m.kind || !["beat", "downbeat"].includes(m.kind));
  const others = comp.layers.filter((l) => l.id !== selfId);
  const setMode = (m: RefMode) => {
    if (m === "abs") return onChange(+(typeof value === "number" ? value : fallback).toFixed(2));
    if (m === "marker") return onChange({ ref: `marker:${named[0]?.id ?? ""}`, offset });
    if (m === "layer") return onChange({ ref: `layer:${others[0]?.id ?? ""}.end`, offset });
    if (m === "beat" || m === "downbeat") return onChange({ ref: m, n: 1, offset });
    onChange({ ref: m, offset });
  };
  return (
    <div className="ed-timeref">
      <Select label={label} value={mode} onChange={setMode} options={[
        { value: "abs", label: "Giây thứ…" }, { value: "self.start", label: "Đầu lớp" }, { value: "self.end", label: "Cuối lớp" },
        { value: "marker", label: "Theo mốc" }, { value: "layer", label: "Theo lớp khác" }, { value: "beat", label: "Theo beat" }, { value: "downbeat", label: "Theo phách mạnh" },
      ]} />
      {mode === "abs" && <NumberInput value={typeof value === "number" ? value : fallback} step={0.1} min={0} onChange={(v) => onChange(Math.max(0, v))} />}
      {mode === "marker" && (
        <Select value={refStr} options={named.length ? named.map((m) => ({ value: `marker:${m.id}`, label: m.label || m.id })) : [{ value: "", label: "Chưa có mốc — thêm ở thước thời gian" }]}
          onChange={(ref) => onChange({ ref, offset })} />
      )}
      {mode === "layer" && (
        <div className="ed-grid2">
          <Select value={refStr.replace(/\.(start|end)$/, "")} options={others.map((l) => ({ value: `layer:${l.id}`, label: l.name }))}
            onChange={(r) => onChange({ ref: `${r}.${refStr.endsWith(".start") ? "start" : "end"}`, offset })} />
          <Select value={refStr.endsWith(".start") ? "start" : "end"} options={[{ value: "start", label: "lúc bắt đầu" }, { value: "end", label: "lúc kết thúc" }]}
            onChange={(e) => onChange({ ref: refStr.replace(/\.(start|end)$/, "") + "." + e, offset })} />
        </div>
      )}
      {(mode === "beat" || mode === "downbeat") && (
        <NumberInput label="Thứ (đếm từ 1)" value={typeof value === "object" && value ? value.n ?? 1 : 1} min={1} step={1}
          onChange={(n) => onChange({ ...(value as object), ref: mode, n: Math.max(1, Math.round(n)) } as TimeRef)} />
      )}
      {mode !== "abs" && <NumberInput label="Lệch (giây, âm = sớm hơn)" value={offset} step={0.1} onChange={(o) => onChange({ ...(value as object), offset: o } as TimeRef)} />}
    </div>
  );
}

/** Thời gian đầu/cuối (+ lặp theo beat/mốc). `null` = dùng mặc định. */
export function TimingEditor({ value, onChange, comp, selfId, defaults, allowRepeat }: {
  value: Timing | null | undefined; onChange: (t: Timing | null) => void; comp: Composition; selfId?: string;
  defaults: { start: number; end: number }; allowRepeat?: boolean;
}) {
  const t = value ?? {};
  const useDur = t.duration != null;
  return (
    <div className="ed-timing">
      <TimeRefInput label="Bắt đầu" value={t.start} comp={comp} selfId={selfId} fallback={defaults.start} onChange={(start) => onChange({ ...t, start })} />
      <Select label="Kết thúc" value={useDur ? "dur" : "ref"} options={[{ value: "ref", label: "Theo mốc" }, { value: "dur", label: "Sau một khoảng (giây)" }]}
        onChange={(m) => onChange(m === "dur" ? { ...t, end: null, duration: +(defaults.end - defaults.start).toFixed(2) } : { ...t, duration: null })} />
      {useDur
        ? <NumberInput value={t.duration ?? 1} min={0.05} step={0.1} onChange={(duration) => onChange({ ...t, duration: Math.max(0.05, duration) })} />
        : <TimeRefInput label="Kết thúc lúc" value={t.end} comp={comp} selfId={selfId} fallback={defaults.end} onChange={(end) => onChange({ ...t, end })} />}
      {allowRepeat && (
        <>
          <Select label="Lặp lại" value={t.repeat ? (typeof t.repeat.every === "number" ? "sec" : (t.repeat.every as { ref: string }).ref) : "none"}
            options={[{ value: "none", label: "Không lặp" }, { value: "beat", label: "Mỗi beat" }, { value: "downbeat", label: "Mỗi phách mạnh" }, { value: "sec", label: "Mỗi N giây" }]}
            onChange={(m) => onChange({ ...t, repeat: m === "none" ? null : { every: m === "sec" ? 1 : { ref: m }, duration: t.repeat?.duration ?? null } })} />
          {t.repeat && typeof t.repeat.every === "number" && (
            <NumberInput label="Mỗi (giây)" value={t.repeat.every} min={0.05} step={0.1} onChange={(every) => onChange({ ...t, repeat: { ...t.repeat!, every: Math.max(0.05, every) } })} />
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ animation
const ORDER_LABEL = { forward: "Trái → phải", backward: "Phải → trái", center: "Từ giữa ra", edges: "Từ hai bên vào", random: "Ngẫu nhiên" };

export function AnimList({ items, onChange, comp, selfId, isText, layerSpan }: {
  items: Anim[]; onChange: (v: Anim[], merge?: string) => void; comp: Composition; selfId: string; isText: boolean; layerSpan: [number, number];
}) {
  return (
    <ListEditor<Anim> title="Chuyển động" items={items} onChange={onChange} addLabel="Thêm chuyển động"
      hint="Mỗi chuyển động có loại (xuất hiện, biến mất, lặp, nhấn), áp cho cả lớp hoặc từng dòng/từ/chữ cái, trong khoảng thời gian tùy chọn."
      make={() => ({ preset: "fade", kind: "in", duration: 0.5 })}
      summary={(a) => <><b className={`ed-kind k-${a.kind}`}>{ANIM_KIND_LABEL[a.kind]}</b> {ANIMS.find((x) => x.id === a.preset && x.kind === a.kind)?.label ?? a.preset}{a.unit && a.unit !== "layer" ? ` · ${UNIT_LABEL[a.unit]}` : ""}{a.timing ? " · ⏱" : ""}</>}
      render={(a, set) => (
        <>
          <div className="ip-seg">
            {(Object.keys(ANIM_KIND_LABEL) as AnimKind[]).map((k) => (
              <button key={k} className={a.kind === k ? "on" : ""} onClick={() => set({ kind: k, preset: ANIMS.find((x) => x.kind === k)!.id, duration: k === "loop" ? null : a.duration ?? 0.5 })}>{ANIM_KIND_LABEL[k]}</button>
            ))}
          </div>
          <div className="ed-presetgrid">
            {ANIMS.filter((x) => x.kind === a.kind).map((x) => (
              <button key={x.id} className={a.preset === x.id ? "on" : ""} onClick={() => set({ preset: x.id })}>{x.label}</button>
            ))}
          </div>
          {isText && (
            <Select label="Áp cho" value={a.unit ?? "layer"} options={(Object.keys(UNIT_LABEL) as AnimUnit[]).map((u) => ({ value: u, label: UNIT_LABEL[u] }))} onChange={(unit) => set({ unit })} />
          )}
          {isText && a.unit && a.unit !== "layer" && (
            <>
              <div className="ed-grid2">
                <Select label="Thứ tự" value={a.order ?? "forward"} options={Object.entries(ORDER_LABEL).map(([value, label]) => ({ value, label }))} onChange={(order) => set({ order: order as Anim["order"] })} />
                <NumberInput label="Trễ giữa các phần (giây)" value={a.stagger ?? 0} min={0} step={0.01} hint="0 = tự tính" onChange={(v) => set({ stagger: v > 0 ? v : null }, "stg")} />
              </div>
              <TextInput label="Chỉ áp cho phần có chữ" value={a.select?.match ?? ""} placeholder="vd: 50% — bỏ trống = tất cả" onChange={(m) => set({ select: m ? { ...a.select, match: m } : null }, "sel")} />
            </>
          )}
          {a.kind !== "loop" && !a.timing && <Slider label="Độ dài (giây)" value={a.duration ?? 0.5} min={0.05} max={5} step={0.05} onChange={(duration) => set({ duration }, "dur")} />}
          {a.kind === "loop" && <Slider label="Chu kỳ (giây)" value={a.period ?? 1} min={0.1} max={8} step={0.1} onChange={(period) => set({ period }, "per")} />}
          <div className="ed-grid2">
            <Slider label="Độ mạnh" value={a.intensity ?? 1} min={0.1} max={3} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(intensity) => set({ intensity }, "int")} />
            {(a.kind === "in" || a.kind === "out") && <Select label="Kiểu chuyển" value={a.ease ?? ""} options={[{ value: "", label: "Mặc định" }, ...EASES.map((e) => ({ value: e, label: e }))]} onChange={(e) => set({ ease: (e || null) as Anim["ease"] })} />}
          </div>
          <SubFold title="Thời gian áp dụng" open={!!a.timing}>
            <TimingEditor value={a.timing} comp={comp} selfId={selfId} allowRepeat={a.kind === "emphasis" || a.kind === "loop"}
              defaults={{ start: layerSpan[0], end: a.kind === "out" ? layerSpan[1] : layerSpan[0] + (a.duration ?? 0.5) }}
              onChange={(timing) => set({ timing })} />
            {a.timing && <button className="ed-addbtn" onClick={() => set({ timing: null })}>Dùng mặc định ({a.kind === "out" ? "cuối lớp" : a.kind === "loop" ? "suốt lớp" : "đầu lớp"})</button>}
          </SubFold>
        </>
      )} />
  );
}

// ------------------------------------------------------------------ hiệu ứng
export const EFFECTS: { type: Effect["type"]; label: string; min: number; max: number }[] = [
  { type: "exposure", label: "Phơi sáng", min: -100, max: 100 }, { type: "brightness", label: "Độ sáng", min: -100, max: 100 },
  { type: "contrast", label: "Tương phản", min: -100, max: 100 }, { type: "saturation", label: "Độ đậm màu", min: -100, max: 100 },
  { type: "temperature", label: "Nhiệt độ màu", min: -100, max: 100 }, { type: "hue", label: "Xoay sắc độ", min: -180, max: 180 },
  { type: "grayscale", label: "Đen trắng", min: 0, max: 100 }, { type: "dim", label: "Làm tối", min: 0, max: 100 }, { type: "blur", label: "Làm mờ", min: 0, max: 100 },
];

/** Danh sách hiệu ứng của một lớp: chỉnh màu có sẵn + mọi gói trong thư viện (tham số tự sinh từ effect.toml). */
export function EffectList({ items, onChange, comp, selfId, layerSpan, library }: {
  items: Effect[]; onChange: (v: Effect[], merge?: string) => void; comp: Composition; selfId: string; layerSpan: [number, number]; library: EffectInfo[];
}) {
  const pkg = (t: string) => library.find((x) => x.id === t);
  const label = (t: string) => EFFECTS.find((x) => x.type === t)?.label ?? pkg(t)?.name ?? t;
  const options = [
    ...EFFECTS.map((x) => ({ value: x.type as string, label: `Chỉnh màu · ${x.label}` })),
    ...library.map((x) => ({ value: x.id, label: `${CATEGORY_LABEL[x.category] ?? x.category} · ${x.name}` })),
  ];
  return (
    <ListEditor<Effect> title="Hiệu ứng" items={items} onChange={onChange} addLabel="Thêm hiệu ứng"
      hint="Chỉnh màu, bộ màu điện ảnh, hạt phim, glitch, xóa phông xanh… — có thể chỉ áp trong một khoảng thời gian."
      make={() => ({ type: "brightness", amount: 20 })}
      summary={(e) => <>{label(e.type)}{e.amount != null && !pkg(e.type) ? ` ${e.amount}` : ""}{e.timing ? " · ⏱" : ""}</>}
      render={(e, set) => {
        const meta = EFFECTS.find((x) => x.type === e.type);
        const p = pkg(e.type);
        return (
          <>
            <Select label="Loại" value={e.type} options={options}
              onChange={(type) => { const np = pkg(type); set(np ? { type, amount: 100, params: defaultParams(np) } : { type, amount: 20, params: undefined }); }} />
            {meta && <Slider label="Mức" value={e.amount ?? 0} min={meta.min} max={meta.max} onChange={(amount) => set({ amount }, "amt")} />}
            {p && (
              <>
                {p.description && <div className="mt-hint">{p.description}</div>}
                <Slider label="Độ mạnh" value={e.amount ?? 100} min={0} max={100} unit="%" onChange={(amount) => set({ amount }, "amt")} />
                <PackageParams info={p} value={e.params ?? {}} onChange={(params, m) => set({ params }, m)} />
              </>
            )}
            <SubFold title="Thời gian áp dụng" open={!!e.timing}>
              <TimingEditor value={e.timing} comp={comp} selfId={selfId} defaults={{ start: layerSpan[0], end: layerSpan[1] }} onChange={(timing) => set({ timing })} />
              <Slider label="Mạnh/yếu dần (giây)" value={e.ramp ?? 0} min={0} max={3} step={0.05} onChange={(ramp) => set({ ramp }, "ramp")} />
              {e.timing && <button className="ed-addbtn" onClick={() => set({ timing: null })}>Áp suốt lớp</button>}
            </SubFold>
          </>
        );
      }} />
  );
}

/** Giao diện tham số tự sinh từ effect.toml (số → thanh trượt, màu → ô màu). */
export function PackageParams({ info, value, onChange }: { info: EffectInfo; value: Record<string, number | string>; onChange: (v: Record<string, number | string>, merge?: string) => void }) {
  return (
    <>
      {info.params.map((pp) => {
        const v = value[pp.key] ?? pp.default;
        return pp.type === "color"
          ? <ColorInput key={pp.key} label={pp.label} value={String(v)} onChange={(c) => onChange({ ...value, [pp.key]: c }, `pp-${pp.key}`)} />
          : <Slider key={pp.key} label={pp.label} value={Number(v)} min={pp.min} max={pp.max} step={pp.step ?? (pp.max - pp.min) / 100} unit={pp.unit ?? undefined} hint={pp.hint ?? undefined}
              onChange={(n) => onChange({ ...value, [pp.key]: n }, `pp-${pp.key}`)} />;
      })}
    </>
  );
}

export function SubFold({ title, open: initial = false, children }: { title: ReactNode; open?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="ed-subfold">
      <button className="ed-subfold-head" onClick={() => setOpen(!open)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {title}</button>
      {open && <div className="ed-subfold-body">{children}</div>}
    </div>
  );
}

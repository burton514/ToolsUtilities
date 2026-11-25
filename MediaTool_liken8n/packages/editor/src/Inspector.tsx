// Bảng thuộc tính của lớp đang chọn: thời gian, tốc độ, biến đổi (keyframe + easing), crop/lật, blend, mask,
// animation, chữ nghệ thuật, màu sắc, âm thanh.
import { useState } from "react";
import { Button, Field, NumberInput, Section, Select, Slider, TextArea, Toggle } from "@mediatool/ui";
import {
  ANIM_IN, ANIM_LOOP, ANIM_OUT, BEZIER_PRESETS, BLEND_MODES, defaultMask, EASES, MASK_SHAPES, retime, SPEED, TEXT_PRESETS, valueAt,
  type AnimProp, type BlendMode, type Composition, type Crop, type Ease, type Effect, type Layer, type Mask, type TextLayer, type TextStyle,
} from "./model";
import { useEditor, type EditorStore } from "./store";

const PROPS: { prop: AnimProp; label: string; min: number; max: number; step: number }[] = [
  { prop: "x", label: "Vị trí ngang", min: -0.5, max: 1.5, step: 0.005 },
  { prop: "y", label: "Vị trí dọc", min: -0.5, max: 1.5, step: 0.005 },
  { prop: "scale", label: "To nhỏ", min: 0.02, max: 5, step: 0.01 },
  { prop: "rotation", label: "Xoay (độ)", min: -360, max: 360, step: 1 },
  { prop: "opacity", label: "Độ rõ (%)", min: 0, max: 100, step: 1 },
];

const BLEND_LABEL: Record<BlendMode, string> = {
  normal: "Bình thường", multiply: "Nhân (tối đi)", screen: "Screen (sáng lên)", overlay: "Overlay", darken: "Tối hơn", lighten: "Sáng hơn",
  color_dodge: "Color dodge", color_burn: "Color burn", hard_light: "Hard light", soft_light: "Soft light", difference: "Khác biệt",
  exclusion: "Loại trừ", hue: "Hue", saturation: "Saturation", color: "Màu", luminosity: "Độ sáng", add: "Cộng (phát sáng)",
};
const MASK_LABEL: Record<Mask["shape"], string> = { rect: "Chữ nhật", ellipse: "Elip", star: "Sao", heart: "Tim", diamond: "Kim cương", bars: "Viền phim" };

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label} value={value}>
      <input type="color" className="ed-color" value={value.slice(0, 7)} onChange={(e) => onChange(e.target.value + (value.length === 9 ? value.slice(7) : ""))} />
    </Field>
  );
}

/** Mục có thể thu gọn để inspector không quá dài. */
function Fold({ title, children, open: initial = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="mt-section">
      <h4 className="ed-fold" onClick={() => setOpen(!open)}>{open ? "▾" : "▸"} {title}</h4>
      {open && children}
    </section>
  );
}

function CanvasSettings({ store, comp }: { store: EditorStore; comp: Composition }) {
  const ratio = comp.canvas.width > comp.canvas.height ? "16:9" : comp.canvas.width < comp.canvas.height ? "9:16" : "1:1";
  return (
    <Section title="Khung hình">
      <Select label="Tỉ lệ" value={ratio} options={["16:9", "9:16", "1:1"]} onChange={(r) => {
        const size = r === "16:9" ? [1920, 1080] : r === "9:16" ? [1080, 1920] : [1080, 1080];
        store.apply((c) => ({ ...c, canvas: { ...c.canvas, width: size[0], height: size[1] } }));
      }} />
      <Select label="Số hình/giây" value={comp.canvas.fps} options={[24, 25, 30, 60]} onChange={(fps) => store.apply((c) => ({ ...c, canvas: { ...c.canvas, fps } }))} />
      <Color label="Màu nền" value={comp.canvas.background} onChange={(v) => store.apply((c) => ({ ...c, canvas: { ...c.canvas, background: v } }), "bg")} />
    </Section>
  );
}

export function Inspector({ store }: { store: EditorStore }) {
  const comp = useEditor(store, (s) => s.comp);
  const sel = useEditor(store, (s) => s.selected);
  const selection = useEditor(store, (s) => s.selection);
  const time = useEditor(store, (s) => s.time);
  const l = comp.layers.find((x) => x.id === sel);
  if (!l) return <div className="ed-inspector"><CanvasSettings store={store} comp={comp} /><div className="ed-dim ed-pad">Chọn một lớp trên timeline hoặc trên khung xem trước (Shift/Ctrl để chọn nhiều).</div></div>;

  const up = (patch: Partial<Layer>, merge?: string) => store.updateLayer(l.id, patch, merge);
  const local = +(time - l.start).toFixed(3);
  const inside = local >= 0 && local <= l.duration;
  const visual = l.type !== "audio";
  const media = l.type === "video" || l.type === "image";
  const timed = l.type === "video" || l.type === "audio";

  const setProp = (prop: AnimProp, v: number) => {
    const kfs = l.keyframes?.[prop];
    if (kfs?.length && inside) {
      const others = kfs.filter((k) => Math.abs(k.t - local) > 0.02);
      const prev = kfs.find((k) => Math.abs(k.t - local) <= 0.02);
      up({ keyframes: { ...l.keyframes, [prop]: [...others, { ...(prev ?? { ease: "ease_out" as Ease }), t: local, value: v }].sort((a, b) => a.t - b.t) } }, `kf-${prop}`);
    } else {
      up({ [prop]: v } as Partial<Layer>, `p-${prop}`);
    }
  };
  const toggleKf = (prop: AnimProp) => {
    const kfs = l.keyframes?.[prop] ?? [];
    const at = kfs.find((k) => Math.abs(k.t - local) <= 0.02);
    const next = at ? kfs.filter((k) => k !== at) : [...kfs, { t: local, value: valueAt(l, prop, time), ease: "ease_out" as Ease }].sort((a, b) => a.t - b.t);
    up({ keyframes: { ...l.keyframes, [prop]: next } });
  };
  const allKfs = Object.values(l.keyframes ?? {}).flat();
  const setAllEase = (ease: Ease | null, bezier: [number, number, number, number] | null) =>
    up({ keyframes: Object.fromEntries(Object.entries(l.keyframes ?? {}).map(([p, ks]) => [p, ks!.map((k) => ({ ...k, ease: ease ?? k.ease, bezier }))])) });

  const anim = l.animation ?? {};
  const setAnim = (slot: "in" | "out" | "loop", preset: string) =>
    up({ animation: { ...anim, [slot]: preset === "none" ? null : { preset, duration: anim[slot]?.duration ?? (slot === "loop" ? 1 : 0.5) } } });

  const effects = l.effects ?? [];
  const fx = (type: Effect["type"]) => effects.find((e) => e.type === type)?.amount ?? 0;
  const setFx = (type: Effect["type"], amount: number) =>
    up({ effects: [...effects.filter((e) => e.type !== type), ...(amount ? [{ type, amount }] : [])] }, `fx-${type}`);

  const crop: Crop = l.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const setCrop = (k: keyof Crop, v: number) => up({ crop: { ...crop, [k]: v } }, `crop-${k}`);
  const mask = l.mask;
  const setMask = (patch: Partial<Mask>, merge?: string) => up({ mask: { ...(mask ?? defaultMask()), ...patch } }, merge);

  return (
    <div className="ed-inspector">
      {selection.length > 1 && <div className="ed-multi">{selection.length} lớp đang chọn · đang hiển thị lớp cuối. Kéo trên timeline/khung xem để dời cả nhóm.</div>}
      <Section title="Lớp">
        <Field label="Tên"><input className="mt-input" value={l.name} onChange={(e) => up({ name: e.target.value }, "name")} /></Field>
        <div className="ed-grid2">
          <NumberInput label="Bắt đầu (giây)" value={l.start} min={0} step={0.1} onChange={(v) => up({ start: Math.max(0, v) }, "start")} />
          <NumberInput label="Thời lượng (giây)" value={l.duration} min={0.1} step={0.1} onChange={(v) => up({ duration: Math.max(0.1, v) }, "dur")} />
        </div>
        <div className="ed-row-btns">
          <Button small onClick={() => store.apply((c) => ({ ...c, layers: [...c.layers.filter((x) => x.id !== l.id), l] }))}>Lên trên cùng</Button>
          <Button small onClick={() => store.apply((c) => ({ ...c, layers: [l, ...c.layers.filter((x) => x.id !== l.id)] }))}>Xuống dưới cùng</Button>
          <Button small danger onClick={() => store.deleteSelected()}>Xóa</Button>
        </div>
      </Section>

      {timed && (
        <Section title="Tốc độ">
          <Slider label="Tốc độ phát" value={l.speed ?? 1} min={SPEED.min} max={SPEED.max} step={0.05} format={(v) => `${v.toFixed(2)}×`}
            hint="Thời lượng trên timeline tự co/giãn để giữ nguyên đoạn nguồn. Tiếng giữ nguyên cao độ khi xuất."
            onChange={(v) => up(retime(l, v), "speed")} />
          <div className="ed-presets">
            {SPEED.presets.map((p) => <button key={p} className={`sb-chip ${(l.speed ?? 1) === p ? "on" : ""}`} onClick={() => up(retime(l, p))}>{p}×</button>)}
          </div>
        </Section>
      )}

      {visual && (
        <Section title="Biến đổi · ◆ = keyframe tại playhead">
          {PROPS.map(({ prop, label, min, max, step }) => {
            const has = !!l.keyframes?.[prop]?.length;
            const onKf = l.keyframes?.[prop]?.some((k) => Math.abs(k.t - local) <= 0.02);
            const v = valueAt(l, prop, time);
            return (
              <div key={prop} className="ed-prop">
                <Slider label={label} value={+v.toFixed(3)} min={min} max={max} step={step} onChange={(nv) => setProp(prop, nv)} />
                <button className={`ed-kfbtn ${onKf ? "on" : has ? "has" : ""}`} disabled={!inside} title="Thêm/bỏ keyframe tại playhead" onClick={() => toggleKf(prop)}>◆</button>
              </div>
            );
          })}
          {allKfs.length > 0 && (
            <Field label="Kiểu chuyển giữa các keyframe">
              <div className="ed-presets">
                {BEZIER_PRESETS.map((b) => (
                  <button key={b.id} className={`sb-chip ${JSON.stringify(allKfs[0]?.bezier) === JSON.stringify(b.value) ? "on" : ""}`} onClick={() => setAllEase(null, b.value)}>{b.label}</button>
                ))}
                {EASES.filter((e) => ["back", "elastic", "bounce"].includes(e)).map((e) => (
                  <button key={e} className={`sb-chip ${!allKfs[0]?.bezier && allKfs[0]?.ease === e ? "on" : ""}`} onClick={() => setAllEase(e, null)}>{e}</button>
                ))}
              </div>
            </Field>
          )}
          <div className="ed-row-btns">
            <Button small onClick={() => up({ x: 0.5, y: 0.5, scale: 1, rotation: 0, keyframes: {} })}>Đặt lại vị trí</Button>
            <Button small onClick={() => up({ flip_h: !l.flip_h })}>{l.flip_h ? "✓ " : ""}Lật ngang</Button>
            <Button small onClick={() => up({ flip_v: !l.flip_v })}>{l.flip_v ? "✓ " : ""}Lật dọc</Button>
          </div>
        </Section>
      )}

      {media && (
        <Fold title="Cắt khung (crop) · đặt vào khung" open>
          <div className="ed-grid2">
            <Slider label="Trái" value={crop.left} min={0} max={0.9} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setCrop("left", v)} />
            <Slider label="Phải" value={crop.right} min={0} max={0.9} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setCrop("right", v)} />
            <Slider label="Trên" value={crop.top} min={0} max={0.9} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setCrop("top", v)} />
            <Slider label="Dưới" value={crop.bottom} min={0} max={0.9} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setCrop("bottom", v)} />
          </div>
          <Select label="Cách đặt" value={l.fit} options={[{ value: "contain", label: "Thấy toàn bộ" }, { value: "cover", label: "Phủ kín khung" }]} onChange={(fit) => up({ fit } as Partial<Layer>)} />
          <Toggle label="Nền mờ lấp chỗ trống (hợp khung dọc)" checked={l.background_fill === "blur"} onChange={(on) => up({ background_fill: on ? "blur" : null })} />
        </Fold>
      )}

      {visual && (
        <Fold title="Animation có sẵn · transition" open={!!(anim.in || anim.out || anim.loop)}>
          <Select label="Xuất hiện" value={anim.in?.preset ?? "none"} options={ANIM_IN} onChange={(v) => setAnim("in", v)} />
          {anim.in && <Slider label="… trong (giây)" value={anim.in.duration} min={0.1} max={3} step={0.1} onChange={(d) => up({ animation: { ...anim, in: { ...anim.in!, duration: d } } }, "ain")} />}
          <Select label="Biến mất" value={anim.out?.preset ?? "none"} options={ANIM_OUT} onChange={(v) => setAnim("out", v)} />
          {anim.out && <Slider label="… trong (giây)" value={anim.out.duration} min={0.1} max={3} step={0.1} onChange={(d) => up({ animation: { ...anim, out: { ...anim.out!, duration: d } } }, "aout")} />}
          <Select label="Lặp liên tục" value={anim.loop?.preset ?? "none"} options={ANIM_LOOP} onChange={(v) => setAnim("loop", v)} />
          {anim.loop && <Slider label="… chu kỳ (giây)" value={anim.loop.duration} min={0.2} max={5} step={0.1} onChange={(d) => up({ animation: { ...anim, loop: { ...anim.loop!, duration: d } } }, "aloop")} />}
        </Fold>
      )}

      {l.type === "text" && <TextPanel layer={l} up={up} />}

      {l.type === "shape" && (
        <Section title="Hình">
          <Select label="Dạng" value={l.shape} options={["rect", "circle", "star"]} onChange={(shape) => up({ shape } as Partial<Layer>)} />
          <Slider label="Rộng" value={l.w} min={0.01} max={1.5} step={0.01} onChange={(w) => up({ w } as Partial<Layer>, "w")} />
          <Slider label="Cao" value={l.h} min={0.01} max={1.5} step={0.01} onChange={(h) => up({ h } as Partial<Layer>, "h")} />
          <Slider label="Bo góc" value={l.corner_radius} min={0} max={200} onChange={(corner_radius) => up({ corner_radius } as Partial<Layer>, "cr")} />
          <Color label="Màu" value={l.fill} onChange={(fill) => up({ fill } as Partial<Layer>, "fill")} />
        </Section>
      )}

      {visual && (
        <Fold title="Hòa trộn · mask">
          <Select label="Blend mode" value={l.blend ?? "normal"} options={BLEND_MODES.map((b) => ({ value: b, label: BLEND_LABEL[b] }))}
            onChange={(b) => up({ blend: b === "normal" ? null : b })} />
          <Select label="Mask" value={mask?.shape ?? "none"} options={[{ value: "none", label: "Không" }, ...MASK_SHAPES.map((m) => ({ value: m, label: MASK_LABEL[m] }))]}
            onChange={(v) => up({ mask: v === "none" ? null : { ...(mask ?? defaultMask()), shape: v as Mask["shape"] } })} />
          {mask && (
            <>
              <div className="ed-grid2">
                <Slider label="Rộng" value={mask.w} min={0.05} max={1.5} step={0.01} onChange={(w) => setMask({ w }, "mw")} />
                <Slider label="Cao" value={mask.h} min={0.05} max={1.5} step={0.01} onChange={(h) => setMask({ h }, "mh")} />
                <Slider label="Lệch ngang" value={mask.cx} min={-0.5} max={0.5} step={0.01} onChange={(cx) => setMask({ cx }, "mx")} />
                <Slider label="Lệch dọc" value={mask.cy} min={-0.5} max={0.5} step={0.01} onChange={(cy) => setMask({ cy }, "my")} />
              </div>
              <Slider label="Làm mềm viền" value={mask.feather} min={0} max={200} onChange={(feather) => setMask({ feather }, "mf")} />
              <Slider label="Xoay mask" value={mask.rotation} min={-180} max={180} onChange={(rotation) => setMask({ rotation }, "mr")} />
              {mask.shape === "rect" && <Slider label="Bo góc" value={mask.radius} min={0} max={300} onChange={(radius) => setMask({ radius }, "mrad")} />}
              <Toggle label="Đảo ngược (khoét lỗ)" checked={mask.invert} onChange={(invert) => setMask({ invert })} />
            </>
          )}
        </Fold>
      )}

      {visual && (
        <Fold title="Màu sắc · hiệu ứng">
          <Slider label="Phơi sáng" value={fx("exposure")} min={-100} max={100} onChange={(v) => setFx("exposure", v)} />
          <Slider label="Độ sáng" value={fx("brightness")} min={-100} max={100} onChange={(v) => setFx("brightness", v)} />
          <Slider label="Tương phản" value={fx("contrast")} min={-100} max={100} onChange={(v) => setFx("contrast", v)} />
          <Slider label="Độ đậm màu" value={fx("saturation")} min={-100} max={100} onChange={(v) => setFx("saturation", v)} />
          <Slider label="Nhiệt độ màu (lạnh ↔ ấm)" value={fx("temperature")} min={-100} max={100} onChange={(v) => setFx("temperature", v)} />
          <Slider label="Xoay sắc độ (hue)" value={fx("hue")} min={-180} max={180} onChange={(v) => setFx("hue", v)} />
          <Slider label="Đen trắng" value={fx("grayscale")} min={0} max={100} onChange={(v) => setFx("grayscale", v)} />
          <Slider label="Làm tối" value={fx("dim")} min={0} max={100} onChange={(v) => setFx("dim", v)} />
          <Slider label="Làm mờ" value={fx("blur")} min={0} max={100} onChange={(v) => setFx("blur", v)} />
          <Button small onClick={() => up({ effects: [] })}>Bỏ hết hiệu ứng</Button>
        </Fold>
      )}

      {timed && (
        <Section title="Âm thanh">
          <Slider label="Âm lượng" value={l.volume} min={0} max={200} unit="%" onChange={(volume) => up({ volume } as Partial<Layer>, "vol")} />
          <Toggle label="Tắt tiếng" checked={l.muted} onChange={(muted) => up({ muted } as Partial<Layer>)} />
          <div className="ed-grid2">
            <Slider label="To dần (giây)" value={l.fade_in ?? 0} min={0} max={Math.min(10, l.duration)} step={0.1} onChange={(fade_in) => up({ fade_in }, "fin")} />
            <Slider label="Nhỏ dần (giây)" value={l.fade_out ?? 0} min={0} max={Math.min(10, l.duration)} step={0.1} onChange={(fade_out) => up({ fade_out }, "fout")} />
          </div>
          <NumberInput label="Bắt đầu từ giây (trong file gốc)" value={l.trim_start} min={0} step={0.1} onChange={(v) => up({ trim_start: Math.max(0, v) } as Partial<Layer>, "trim")} />
        </Section>
      )}
    </div>
  );
}

function TextPanel({ layer, up }: { layer: TextLayer; up: (p: Partial<Layer>, merge?: string) => void }) {
  const s = layer.style;
  const set = (patch: Partial<TextStyle>, merge?: string) => up({ style: { ...s, ...patch } } as Partial<Layer>, merge);
  return (
    <Section title="Chữ nghệ thuật">
      <TextArea value={layer.text} rows={3} onChange={(text) => up({ text } as Partial<Layer>, "text")} />
      <Field label="Kiểu có sẵn">
        <div className="ed-presets">
          {Object.keys(TEXT_PRESETS).map((k) => <button key={k} className="sb-chip" onClick={() => set(TEXT_PRESETS[k])}>{k}</button>)}
        </div>
      </Field>
      <Select label="Font" value={s.font} options={["Noto Sans", "Noto Serif", "Noto Sans Mono"]} onChange={(font) => set({ font })} />
      <div className="ed-grid2">
        <Slider label="Cỡ chữ" value={s.size} min={12} max={400} onChange={(size) => set({ size }, "size")} />
        <Slider label="Độ đậm" value={s.weight} min={100} max={900} step={100} onChange={(weight) => set({ weight }, "weight")} />
        <Slider label="Giãn chữ" value={s.letter_spacing} min={-10} max={60} onChange={(letter_spacing) => set({ letter_spacing }, "ls")} />
        <Slider label="Giãn dòng" value={s.line_height ?? 0} min={0} max={3} step={0.05} format={(v) => (v ? v.toFixed(2) : "mặc định")} onChange={(line_height) => set({ line_height }, "lh")} />
        <Slider label="Rộng tối đa" value={s.max_width} min={0.1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(max_width) => set({ max_width }, "mw")} />
      </div>
      <div className="ed-row-btns">
        {(["left", "center", "right"] as const).map((a) => (
          <Button key={a} small primary={s.align === a} onClick={() => set({ align: a })}>{a === "left" ? "⟸ Trái" : a === "center" ? "Giữa" : "Phải ⟹"}</Button>
        ))}
        <Button small primary={!!s.italic} onClick={() => set({ italic: !s.italic })}><i>Nghiêng</i></Button>
        <Button small primary={!!s.uppercase} onClick={() => set({ uppercase: !s.uppercase })}>IN HOA</Button>
      </div>
      <Color label="Màu chữ" value={s.color} onChange={(color) => set({ color, gradient: null }, "color")} />
      <Toggle label="Chuyển màu (gradient)" checked={!!s.gradient} onChange={(on) => set({ gradient: on ? { colors: [s.color, "#FF8F00"], angle: 90 } : null })} />
      {s.gradient && (
        <div className="ed-grid2">
          <Color label="Màu 1" value={s.gradient.colors[0]} onChange={(c) => set({ gradient: { ...s.gradient!, colors: [c, ...s.gradient!.colors.slice(1)] } }, "g1")} />
          <Color label="Màu 2" value={s.gradient.colors[s.gradient.colors.length - 1]} onChange={(c) => set({ gradient: { ...s.gradient!, colors: [...s.gradient!.colors.slice(0, -1), c] } }, "g2")} />
          <Slider label="Góc" value={s.gradient.angle} min={0} max={360} onChange={(angle) => set({ gradient: { ...s.gradient!, angle } }, "ga")} />
        </div>
      )}
      <Toggle label="Viền" checked={!!s.stroke} onChange={(on) => set({ stroke: on ? { color: "#000000", width: 4 } : null })} />
      {s.stroke && (
        <div className="ed-grid2">
          <Color label="Màu viền" value={s.stroke.color} onChange={(c) => set({ stroke: { ...s.stroke!, color: c } }, "sc")} />
          <Slider label="Dày" value={s.stroke.width} min={1} max={40} onChange={(w) => set({ stroke: { ...s.stroke!, width: w } }, "sw")} />
        </div>
      )}
      <Toggle label="Đổ bóng" checked={!!s.shadow} onChange={(on) => set({ shadow: on ? { color: "#000000AA", x: 4, y: 6, blur: 6 } : null })} />
      {s.shadow && (
        <div className="ed-grid2">
          <Color label="Màu bóng" value={s.shadow.color} onChange={(c) => set({ shadow: { ...s.shadow!, color: c } }, "shc")} />
          <Slider label="Độ mờ bóng" value={s.shadow.blur} min={0} max={40} onChange={(blur) => set({ shadow: { ...s.shadow!, blur } }, "shb")} />
          <Slider label="Lệch ngang" value={s.shadow.x} min={-40} max={40} onChange={(x) => set({ shadow: { ...s.shadow!, x } }, "shx")} />
          <Slider label="Lệch dọc" value={s.shadow.y} min={-40} max={40} onChange={(y) => set({ shadow: { ...s.shadow!, y } }, "shy")} />
        </div>
      )}
      <Toggle label="Phát sáng (neon)" checked={!!s.glow} onChange={(on) => set({ glow: on ? { color: "#FF2FB3", radius: 16 } : null })} />
      {s.glow && (
        <div className="ed-grid2">
          <Color label="Màu sáng" value={s.glow.color} onChange={(c) => set({ glow: { ...s.glow!, color: c } }, "glc")} />
          <Slider label="Độ lan" value={s.glow.radius} min={2} max={60} onChange={(r) => set({ glow: { ...s.glow!, radius: r } }, "glr")} />
        </div>
      )}
      <Toggle label="Hộp nền" checked={!!s.background} onChange={(on) => set({ background: on ? { color: "#000000B3", padding: 0.3, radius: 10 } : null })} />
      {s.background && (
        <div className="ed-grid2">
          <Color label="Màu hộp" value={s.background.color} onChange={(c) => set({ background: { ...s.background!, color: c } }, "bgc")} />
          <Slider label="Bo góc" value={s.background.radius} min={0} max={60} onChange={(radius) => set({ background: { ...s.background!, radius } }, "bgr")} />
        </div>
      )}
    </Section>
  );
}

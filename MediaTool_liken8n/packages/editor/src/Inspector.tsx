// Bảng thuộc tính của lớp đang chọn, chia tab: Lớp · Chữ · Kiểu · Chuyển động · Hiệu ứng.
// Chỉ ghép các control dùng chung (controls.tsx) — mọi loại lớp dùng cùng một bộ cho viền, bóng, hiệu ứng, chuyển động.
import { useEffect, useRef, useState } from "react";
import { Bold, Italic, Strikethrough, Underline } from "lucide-react";
import { Button, Field, NumberInput, Section, Select, Slider, TextArea, Toggle } from "@mediatool/ui";
import type { MediaToolClient } from "@mediatool/api-client";
import {
  BEZIER_PRESETS, BLEND_MODES, defaultMask, EASES, MASK_SHAPES, newId, retime, SPEED, TEXT_PRESETS, valueAt,
  type AnimProp, type BlendMode, type Composition, type Crop, type Ease, type Fill, type Layer, type Marker, type Mask, type Span, type TextLayer,
  type TextStyle,
} from "./model";
import { AnimList, ColorInput, EffectList, FillEditor, fillCss, ListEditor, ShadowList, StrokeList, SubFold, TimingEditor } from "./controls";
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
/** Font có sẵn trong engine (Noto, đủ dấu tiếng Việt). Thư viện font mở rộng sẽ đến từ registry thư viện. */
const FONTS = ["Noto Sans", "Noto Serif", "Noto Sans Mono", "Noto Sans Display", "Noto Serif Display"];

type Tab = "layer" | "text" | "style" | "motion" | "effects";

function MarkersPanel({ store, comp }: { store: EditorStore; comp: Composition }) {
  const time = useEditor(store, (s) => s.time);
  const markers = comp.markers ?? [];
  const set = (m: Marker[], merge?: string) => store.apply((c) => ({ ...c, markers: m }), merge);
  return (
    <Section title="Mốc thời gian">
      <ListEditor<Marker> title="Các mốc (điệp khúc, beat, cảnh…)" items={markers} onChange={set} addLabel="Thêm tại vạch phát"
        hint="Mốc có tên để neo thời gian của lớp, chuyển động, hiệu ứng (vd: chữ đập theo beat trong điệp khúc)."
        make={() => ({ id: newId("m"), start: +time.toFixed(2), label: `Mốc ${markers.length + 1}`, kind: "section" })}
        summary={(m) => <>{m.label || m.id} · {m.start.toFixed(2)}s{m.kind ? ` · ${m.kind}` : ""}</>}
        render={(m, s) => (
          <>
            <Field label="Tên"><input className="mt-input" value={m.label ?? ""} onChange={(e) => s({ label: e.target.value }, "ml")} /></Field>
            <div className="ed-grid2">
              <NumberInput label="Bắt đầu (giây)" value={m.start} min={0} step={0.05} onChange={(start) => s({ start: Math.max(0, start) }, "ms")} />
              <NumberInput label="Kết thúc (giây)" value={m.end ?? m.start} min={0} step={0.05} onChange={(end) => s({ end: end > m.start ? end : null }, "me")} />
            </div>
            <Select label="Loại" value={m.kind ?? "section"} options={[{ value: "section", label: "Đoạn (điệp khúc, verse…)" }, { value: "beat", label: "Beat" }, { value: "downbeat", label: "Phách mạnh" }, { value: "scene", label: "Cảnh" }]}
              onChange={(kind) => s({ kind })} />
          </>
        )} />
    </Section>
  );
}

function CanvasSettings({ store, comp }: { store: EditorStore; comp: Composition }) {
  const ratio = comp.canvas.width > comp.canvas.height ? "16:9" : comp.canvas.width < comp.canvas.height ? "9:16" : "1:1";
  return (
    <>
      <Section title="Khung hình">
        <Select label="Tỉ lệ" value={ratio} options={["16:9", "9:16", "1:1"]} onChange={(r) => {
          const size = r === "16:9" ? [1920, 1080] : r === "9:16" ? [1080, 1920] : [1080, 1080];
          store.apply((c) => ({ ...c, canvas: { ...c.canvas, width: size[0], height: size[1] } }));
        }} />
        <Select label="Số hình/giây" value={comp.canvas.fps} options={[24, 25, 30, 60]} onChange={(fps) => store.apply((c) => ({ ...c, canvas: { ...c.canvas, fps } }))} />
        <ColorInput label="Màu nền" value={comp.canvas.background} onChange={(v) => store.apply((c) => ({ ...c, canvas: { ...c.canvas, background: v } }), "bg")} />
      </Section>
      <MarkersPanel store={store} comp={comp} />
    </>
  );
}

export function Inspector({ store, client }: { store: EditorStore; client: MediaToolClient }) {
  const comp = useEditor(store, (s) => s.comp);
  const sel = useEditor(store, (s) => s.selected);
  const selection = useEditor(store, (s) => s.selection);
  const time = useEditor(store, (s) => s.time);
  const resolved = useEditor(store, (s) => s.resolved);
  const [tab, setTab] = useState<Tab>("layer");
  const [images, setImages] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    client.listAssets().then((a) => setImages(a.filter((x) => x.format === "image").map((x) => ({ id: x.id, name: x.filename })))).catch(() => undefined);
  }, [client, sel]);
  const l = comp.layers.find((x) => x.id === sel);
  useEffect(() => {
    if (l && tab === "text" && l.type !== "text") setTab("layer");
  }, [l, tab]);
  if (!l) return <div className="ed-inspector"><CanvasSettings store={store} comp={comp} /><div className="ed-dim ed-pad">Chọn một lớp trên timeline hoặc trên khung xem trước (Shift/Ctrl để chọn nhiều).</div></div>;

  const up = (patch: Partial<Layer>, merge?: string) => store.updateLayer(l.id, patch, merge);
  const span: [number, number] = [resolved[l.id]?.start ?? l.start, (resolved[l.id]?.start ?? l.start) + (resolved[l.id]?.duration ?? l.duration)];
  const visual = l.type !== "audio";
  const tabs: { value: Tab; label: string }[] = [
    { value: "layer", label: "Lớp" },
    ...(l.type === "text" ? [{ value: "text" as Tab, label: "Chữ" }] : []),
    ...(visual ? [{ value: "style" as Tab, label: "Kiểu" }, { value: "motion" as Tab, label: "Chuyển động" }, { value: "effects" as Tab, label: "Hiệu ứng" }] : []),
  ];
  const unitHint = l.type === "text" ? "Theo cỡ chữ 96" : "Pixel theo khung cao 1080";

  return (
    <div className="ed-inspector">
      {selection.length > 1 && <div className="ed-multi">{selection.length} lớp đang chọn · đang hiển thị lớp cuối. Kéo trên timeline/khung xem để dời cả nhóm.</div>}
      <div className="ed-insp-tabs ed-seg" role="tablist">
        {tabs.map((t) => <button key={t.value} role="tab" aria-selected={tab === t.value} className={tab === t.value ? "on" : ""} onClick={() => setTab(t.value)}>{t.label}</button>)}
      </div>

      {tab === "layer" && <LayerTab l={l} up={up} store={store} comp={comp} time={time} span={span} />}
      {tab === "text" && l.type === "text" && <TextTab l={l} up={up} comp={comp} span={span} />}
      {tab === "style" && visual && (
        <>
          {l.type === "text" && (
            <Section title="Kiểu có sẵn">
              <div className="ed-stylegrid">
                {Object.entries(TEXT_PRESETS).map(([k, p]) => (
                  <button key={k} className="ed-stylechip" onClick={() => up({ style: { ...l.style, ...p.style }, strokes: p.strokes, shadows: p.shadows } as Partial<Layer>)}>
                    <span style={{ background: fillCss(p.style.fill ?? "#fff"), WebkitBackgroundClip: "text", color: "transparent", WebkitTextStroke: p.strokes[0] ? `1px ${p.strokes[0].color}` : undefined }}>Aa</span>
                    {p.label}
                  </button>
                ))}
              </div>
            </Section>
          )}
          <Section title="Tô màu · viền · bóng">
            {l.type === "text" && <FillEditor label="Màu chữ" value={l.style.fill} images={images} onChange={(fill, m) => up({ style: { ...l.style, fill } } as Partial<Layer>, m)} />}
            {l.type === "shape" && <FillEditor label="Màu hình" value={l.fill} images={images} onChange={(fill, m) => up({ fill } as Partial<Layer>, m)} />}
            <StrokeList items={l.strokes ?? []} images={images} unitHint={unitHint} onChange={(strokes, m) => up({ strokes }, m)} />
            <ShadowList items={l.shadows ?? []} onChange={(shadows, m) => up({ shadows }, m)} />
          </Section>
          {l.type === "text" && <TextBackgroundPanel l={l} up={up} images={images} />}
          <BlendMaskPanel l={l} up={up} />
        </>
      )}
      {tab === "motion" && visual && (
        <Section title="Chuyển động">
          <AnimList items={l.animations ?? []} comp={comp} selfId={l.id} isText={l.type === "text"} layerSpan={span} onChange={(animations, m) => up({ animations }, m)} />
          <KeyframeEase l={l} up={up} />
        </Section>
      )}
      {tab === "effects" && visual && (
        <Section title="Hiệu ứng">
          <EffectList items={l.effects ?? []} comp={comp} selfId={l.id} layerSpan={span} onChange={(effects, m) => up({ effects }, m)} />
        </Section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ tab Lớp
function LayerTab({ l, up, store, comp, time, span }: { l: Layer; up: (p: Partial<Layer>, m?: string) => void; store: EditorStore; comp: Composition; time: number; span: [number, number] }) {
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
  const crop: Crop = l.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const setCrop = (k: keyof Crop, v: number) => up({ crop: { ...crop, [k]: v } }, `crop-${k}`);
  return (
    <>
      <Section title="Lớp">
        <Field label="Tên"><input className="mt-input" value={l.name} onChange={(e) => up({ name: e.target.value }, "name")} /></Field>
        {l.timing ? (
          <div className="mt-hint">Đang neo thời gian theo mốc: {span[0].toFixed(2)}s → {span[1].toFixed(2)}s</div>
        ) : (
          <div className="ed-grid2">
            <NumberInput label="Bắt đầu (giây)" value={l.start} min={0} step={0.1} onChange={(v) => up({ start: Math.max(0, v) }, "start")} />
            <NumberInput label="Thời lượng (giây)" value={l.duration} min={0.1} step={0.1} onChange={(v) => up({ duration: Math.max(0.1, v) }, "dur")} />
          </div>
        )}
        <SubFold title="Neo thời gian theo mốc / lớp khác / beat" open={!!l.timing}>
          <TimingEditor value={l.timing} comp={comp} selfId={l.id} defaults={{ start: l.start, end: l.start + l.duration }} onChange={(timing) => up({ timing })} />
          {l.timing && <button className="ed-addbtn" onClick={() => up({ timing: null, start: span[0], duration: span[1] - span[0] })}>Bỏ neo (giữ thời gian hiện tại)</button>}
        </SubFold>
        <div className="ed-row-btns">
          <Button small onClick={() => store.apply((c) => ({ ...c, layers: [...c.layers.filter((x) => x.id !== l.id), l] }))}>Lên trên cùng</Button>
          <Button small onClick={() => store.apply((c) => ({ ...c, layers: [l, ...c.layers.filter((x) => x.id !== l.id)] }))}>Xuống dưới cùng</Button>
          <Button small danger onClick={() => store.deleteSelected()}>Xóa</Button>
        </div>
      </Section>
      {timed && (
        <Section title="Tốc độ">
          <Slider label="Tốc độ phát" value={l.speed ?? 1} min={SPEED.min} max={SPEED.max} step={0.05} format={(v) => `${v.toFixed(2)}×`}
            hint="Thời lượng trên timeline tự co/giãn để giữ nguyên đoạn nguồn. Tiếng giữ nguyên cao độ khi xuất." onChange={(v) => up(retime(l, v), "speed")} />
          <div className="ed-presets">
            {SPEED.presets.map((p) => <button key={p} className={`sb-chip ${(l.speed ?? 1) === p ? "on" : ""}`} onClick={() => up(retime(l, p))}>{p}×</button>)}
          </div>
        </Section>
      )}
      {visual && (
        <Section title="Biến đổi · ◆ = keyframe tại vạch phát">
          {PROPS.map(({ prop, label, min, max, step }) => {
            const has = !!l.keyframes?.[prop]?.length;
            const onKf = l.keyframes?.[prop]?.some((k) => Math.abs(k.t - local) <= 0.02);
            const v = valueAt(l, prop, time);
            return (
              <div key={prop} className="ed-prop">
                <Slider label={label} value={+v.toFixed(3)} min={min} max={max} step={step} onChange={(nv) => setProp(prop, nv)} />
                <button className={`ed-kfbtn ${onKf ? "on" : has ? "has" : ""}`} disabled={!inside} title="Thêm/bỏ keyframe tại vạch phát" onClick={() => toggleKf(prop)}>◆</button>
              </div>
            );
          })}
          <div className="ed-row-btns">
            <Button small onClick={() => up({ x: 0.5, y: 0.5, scale: 1, rotation: 0, keyframes: {} })}>Đặt lại vị trí</Button>
            <Button small onClick={() => up({ flip_h: !l.flip_h })}>{l.flip_h ? "✓ " : ""}Lật ngang</Button>
            <Button small onClick={() => up({ flip_v: !l.flip_v })}>{l.flip_v ? "✓ " : ""}Lật dọc</Button>
          </div>
        </Section>
      )}
      {media && (
        <Section title="Cắt khung · đặt vào khung">
          <div className="ed-grid2">
            {(["left", "right", "top", "bottom"] as const).map((k) => (
              <Slider key={k} label={{ left: "Trái", right: "Phải", top: "Trên", bottom: "Dưới" }[k]} value={crop[k]} min={0} max={0.9} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setCrop(k, v)} />
            ))}
          </div>
          <Select label="Cách đặt" value={l.fit} options={[{ value: "contain", label: "Thấy toàn bộ" }, { value: "cover", label: "Phủ kín khung" }]} onChange={(fit) => up({ fit } as Partial<Layer>)} />
          <Toggle label="Nền mờ lấp chỗ trống (hợp khung dọc)" checked={l.background_fill === "blur"} onChange={(on) => up({ background_fill: on ? "blur" : null })} />
        </Section>
      )}
      {l.type === "shape" && (
        <Section title="Hình">
          <Select label="Dạng" value={l.shape} options={[{ value: "rect", label: "Chữ nhật" }, { value: "circle", label: "Tròn" }, { value: "star", label: "Sao" }]} onChange={(shape) => up({ shape } as Partial<Layer>)} />
          <div className="ed-grid2">
            <Slider label="Rộng" value={l.w} min={0.01} max={1.5} step={0.01} onChange={(w) => up({ w } as Partial<Layer>, "w")} />
            <Slider label="Cao" value={l.h} min={0.01} max={1.5} step={0.01} onChange={(h) => up({ h } as Partial<Layer>, "h")} />
          </div>
          <Slider label="Bo góc" value={l.corner_radius} min={0} max={200} onChange={(corner_radius) => up({ corner_radius } as Partial<Layer>, "cr")} />
        </Section>
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
    </>
  );
}

// ------------------------------------------------------------------ tab Chữ
const toChars = (s: string, utf16: number) => Array.from(s.slice(0, utf16)).length;

function TextTab({ l, up, comp, span }: { l: TextLayer; up: (p: Partial<Layer>, m?: string) => void; comp: Composition; span: [number, number] }) {
  const s = l.style;
  const set = (patch: Partial<TextStyle>, merge?: string) => up({ style: { ...s, ...patch } } as Partial<Layer>, merge);
  const areaRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const spans = l.spans ?? [];
  const chars = Array.from(l.text);
  const readSel = () => {
    const ta = areaRef.current?.querySelector("textarea");
    if (!ta) return;
    const a = toChars(l.text, ta.selectionStart), b = toChars(l.text, ta.selectionEnd);
    setSel(b > a ? [a, b] : null);
  };
  /** Định dạng nhanh cho phần đang bôi đen (tạo một đoạn riêng). */
  const formatSel = (patch: Partial<TextStyle>) => sel && up({ spans: [...spans, { start: sel[0], end: sel[1], style: patch }] } as Partial<Layer>);
  return (
    <>
      <Section title="Nội dung">
        <div ref={areaRef} onMouseUp={readSel} onKeyUp={readSel}>
          <TextArea value={l.text} rows={3} onChange={(text) => up({ text } as Partial<Layer>, "text")} />
        </div>
        <div className="ed-fmtbar">
          <span className="mt-hint">{sel ? `Đang chọn: “${chars.slice(sel[0], sel[1]).join("")}”` : "Bôi đen một phần chữ để định dạng riêng"}</span>
          <button className="ed-ibtn" disabled={!sel} title="Đậm" aria-label="Đậm" onClick={() => formatSel({ weight: 900 })}><Bold size={14} /></button>
          <button className="ed-ibtn" disabled={!sel} title="Nghiêng" aria-label="Nghiêng" onClick={() => formatSel({ italic: true })}><Italic size={14} /></button>
          <button className="ed-ibtn" disabled={!sel} title="Gạch chân" aria-label="Gạch chân" onClick={() => formatSel({ underline: true })}><Underline size={14} /></button>
          <button className="ed-ibtn" disabled={!sel} title="Gạch ngang" aria-label="Gạch ngang" onClick={() => formatSel({ strikethrough: true })}><Strikethrough size={14} /></button>
          <button className="ed-addbtn" disabled={!sel} onClick={() => formatSel({ fill: "#FF3D3D", size: Math.round(s.size * 1.3) })}>Nhấn mạnh</button>
        </div>
        <ListEditor<Span> title="Đoạn có kiểu riêng" items={spans} onChange={(v, m) => up({ spans: v } as Partial<Layer>, m)} addLabel="Thêm từ phần chọn"
          hint="Bôi đen chữ rồi bấm nút định dạng ở trên, hoặc “Thêm từ phần chọn”, để làm chữ khác màu/cỡ/font trong cùng một dòng."
          make={() => ({ start: sel?.[0] ?? 0, end: sel?.[1] ?? Math.min(chars.length, 3), style: { fill: "#FFEB3B" } })}
          summary={(sp) => <>“{chars.slice(sp.start, sp.end).join("")}”{sp.timing ? " · ⏱" : ""}</>}
          render={(sp, setSp) => {
            const st = sp.style;
            const ss = (patch: Partial<TextStyle>, m?: string) => setSp({ style: { ...st, ...patch } }, m);
            return (
              <>
                <div className="ed-grid2">
                  <NumberInput label="Từ ký tự" value={sp.start} min={0} step={1} onChange={(v) => setSp({ start: Math.max(0, Math.round(v)) })} />
                  <NumberInput label="Đến ký tự" value={sp.end} min={1} step={1} onChange={(v) => setSp({ end: Math.max(sp.start + 1, Math.round(v)) })} />
                </div>
                <FillEditor label="Màu" value={st.fill ?? s.fill} onChange={(fill, m) => ss({ fill }, m)} />
                <div className="ed-grid2">
                  <Slider label="Cỡ chữ" value={st.size ?? s.size} min={12} max={400} onChange={(size) => ss({ size }, "sz")} />
                  <Slider label="Độ đậm" value={st.weight ?? s.weight} min={100} max={900} step={100} onChange={(weight) => ss({ weight }, "wt")} />
                </div>
                <Select label="Font" value={st.font ?? s.font} options={FONTS} onChange={(font) => ss({ font })} />
                <div className="ed-row-btns">
                  <Button small primary={!!st.italic} onClick={() => ss({ italic: !st.italic })}>Nghiêng</Button>
                  <Button small primary={!!st.underline} onClick={() => ss({ underline: !st.underline })}>Gạch chân</Button>
                  <Button small primary={!!st.strikethrough} onClick={() => ss({ strikethrough: !st.strikethrough })}>Gạch ngang</Button>
                </div>
                <SubFold title="Chỉ áp trong khoảng thời gian" open={!!sp.timing}>
                  <TimingEditor value={sp.timing} comp={comp} selfId={l.id} defaults={{ start: span[0], end: span[1] }} onChange={(timing) => setSp({ timing })} />
                  {sp.timing && <button className="ed-addbtn" onClick={() => setSp({ timing: null })}>Áp suốt lớp</button>}
                </SubFold>
              </>
            );
          }} />
      </Section>
      <Section title="Font · cỡ chữ">
        <Select label="Font" value={s.font} options={FONTS} onChange={(font) => set({ font })} />
        <div className="ed-grid2">
          <Slider label="Cỡ chữ" value={s.size} min={12} max={400} onChange={(size) => set({ size }, "size")} />
          <Slider label="Độ đậm" value={s.weight} min={100} max={900} step={100} onChange={(weight) => set({ weight }, "weight")} />
          <Slider label="Giãn chữ" value={s.letter_spacing} min={-10} max={60} onChange={(letter_spacing) => set({ letter_spacing }, "ls")} />
          <Slider label="Giãn từ" value={s.word_spacing ?? 0} min={-20} max={120} onChange={(word_spacing) => set({ word_spacing }, "ws")} />
          <Slider label="Giãn dòng" value={s.line_height ?? 0} min={0} max={3} step={0.05} format={(v) => (v ? v.toFixed(2) : "mặc định")} onChange={(line_height) => set({ line_height }, "lh")} />
          <Slider label="Rộng tối đa" value={s.max_width} min={0.1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(max_width) => set({ max_width }, "mw")} />
        </div>
        <div className="ed-seg">
          {([["left", "Trái"], ["center", "Giữa"], ["right", "Phải"], ["justify", "Đều"]] as const).map(([a, lb]) => (
            <button key={a} className={s.align === a ? "on" : ""} onClick={() => set({ align: a })}>{lb}</button>
          ))}
        </div>
        <div className="ed-row-btns">
          <Button small primary={!!s.italic} onClick={() => set({ italic: !s.italic })}>Nghiêng</Button>
          <Button small primary={!!s.underline} onClick={() => set({ underline: !s.underline })}>Gạch chân</Button>
          <Button small primary={!!s.strikethrough} onClick={() => set({ strikethrough: !s.strikethrough })}>Gạch ngang</Button>
        </div>
        <Select label="Hoa / thường" value={s.case ?? "none"} options={[{ value: "none", label: "Giữ nguyên" }, { value: "upper", label: "IN HOA" }, { value: "lower", label: "chữ thường" }, { value: "title", label: "Viết Hoa Đầu Từ" }]}
          onChange={(c) => set({ case: c === "none" ? null : c })} />
      </Section>
      <Section title="Uốn chữ">
        <div className="ed-seg">
          {([["none", "Thẳng"], ["arc", "Vòng cung"], ["wave", "Sóng"]] as const).map(([k, lb]) => (
            <button key={k} className={(s.warp?.type ?? "none") === k ? "on" : ""} onClick={() => set({ warp: k === "none" ? null : { type: k, amount: s.warp?.amount || 40 } })}>{lb}</button>
          ))}
        </div>
        {s.warp && <Slider label="Độ uốn" value={s.warp.amount} min={-100} max={100} onChange={(amount) => set({ warp: { ...s.warp!, amount } }, "warp")} />}
      </Section>
    </>
  );
}

function TextBackgroundPanel({ l, up, images }: { l: TextLayer; up: (p: Partial<Layer>, m?: string) => void; images: { id: string; name: string }[] }) {
  const s = l.style;
  const bg = s.background;
  const set = (patch: Partial<TextStyle>, m?: string) => up({ style: { ...s, ...patch } } as Partial<Layer>, m);
  return (
    <Section title="Nền chữ">
      <div className="ed-seg">
        {([["none", "Không"], ["box", "Một khung"], ["line", "Mỗi dòng"]] as const).map(([k, lb]) => (
          <button key={k} className={(bg ? bg.mode ?? "box" : "none") === k ? "on" : ""}
            onClick={() => set({ background: k === "none" ? null : { color: bg?.color ?? "#000000B3", fill: bg?.fill ?? null, padding: bg?.padding ?? 0.3, radius: bg?.radius ?? 10, mode: k } })}>{lb}</button>
        ))}
      </div>
      {bg && (
        <>
          <FillEditor label="Màu nền" value={(bg.fill ?? bg.color) as Fill} images={images} onChange={(f, m) => set({ background: { ...bg, fill: typeof f === "string" ? null : f, color: typeof f === "string" ? f : bg.color } }, m)} />
          <div className="ed-grid2">
            <Slider label="Lề" value={bg.padding} min={0} max={1.5} step={0.05} onChange={(padding) => set({ background: { ...bg, padding } }, "bgp")} />
            <Slider label="Bo góc" value={bg.radius} min={0} max={80} onChange={(radius) => set({ background: { ...bg, radius } }, "bgr")} />
          </div>
        </>
      )}
    </Section>
  );
}

function BlendMaskPanel({ l, up }: { l: Layer; up: (p: Partial<Layer>, m?: string) => void }) {
  const mask = l.mask;
  const setMask = (patch: Partial<Mask>, merge?: string) => up({ mask: { ...(mask ?? defaultMask()), ...patch } }, merge);
  return (
    <Section title="Hòa trộn · mặt nạ">
      <Select label="Hòa trộn với lớp dưới" value={l.blend ?? "normal"} options={BLEND_MODES.map((b) => ({ value: b, label: BLEND_LABEL[b] }))}
        onChange={(b) => up({ blend: b === "normal" ? null : b })} />
      <Select label="Mặt nạ" value={mask?.shape ?? "none"} options={[{ value: "none", label: "Không" }, ...MASK_SHAPES.map((m) => ({ value: m, label: MASK_LABEL[m] }))]}
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
          <Slider label="Xoay mặt nạ" value={mask.rotation} min={-180} max={180} onChange={(rotation) => setMask({ rotation }, "mr")} />
          {mask.shape === "rect" && <Slider label="Bo góc" value={mask.radius} min={0} max={300} onChange={(radius) => setMask({ radius }, "mrad")} />}
          <Toggle label="Đảo ngược (khoét lỗ)" checked={mask.invert} onChange={(invert) => setMask({ invert })} />
        </>
      )}
    </Section>
  );
}

function KeyframeEase({ l, up }: { l: Layer; up: (p: Partial<Layer>, m?: string) => void }) {
  const allKfs = Object.values(l.keyframes ?? {}).flat();
  if (!allKfs.length) return <div className="mt-hint">Muốn tự tạo chuyển động riêng: ở tab Lớp, đặt vạch phát rồi bấm ◆ cạnh vị trí/to nhỏ/xoay/độ rõ.</div>;
  const setAllEase = (ease: Ease | null, bezier: [number, number, number, number] | null) =>
    up({ keyframes: Object.fromEntries(Object.entries(l.keyframes ?? {}).map(([p, ks]) => [p, ks.map((k) => ({ ...k, ease: ease ?? k.ease, bezier }))])) });
  return (
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
  );
}

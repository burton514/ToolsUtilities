// Xem trước: khung hình do engine native (Rust: FFmpeg + Skia) render.
// Zoom/pan, đường gióng (lưới, vùng an toàn, khung TikTok/Reels/Shorts), chọn/kéo/xoay/phóng to lớp trực tiếp.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LayerBounds, MediaToolClient, PreviewFrame } from "@mediatool/api-client";
import { Camera, Crosshair, Grid3x3, RectangleHorizontal, Repeat, ZoomIn, ZoomOut } from "lucide-react";
import { startDrag as beginDrag } from "./pointer";
import { type Platform, useEditor, type EditorStore } from "./store";
import { valueAt, type Composition, type Layer } from "./model";

// preset zoom theo OpenCut `preview/zoom.ts` (MIT)
const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8];
const ZOOM = { min: 0.1, max: 8, step: 1.25 };

/** Khung giao diện ứng dụng (vùng bị nút/chữ của nền tảng che), tỉ lệ 0..1 — ý tưởng từ OpenCut `guides`. */
const PLATFORM_ZONES: Record<Exclude<Platform, "none">, { label: string; x: number; y: number; w: number; h: number }[]> = {
  tiktok: [
    { label: "Tab trên", x: 0.2, y: 0.03, w: 0.6, h: 0.05 },
    { label: "Nút tương tác", x: 0.84, y: 0.42, w: 0.14, h: 0.42 },
    { label: "Tên + chú thích", x: 0.03, y: 0.78, w: 0.76, h: 0.14 },
    { label: "Thanh dưới", x: 0, y: 0.93, w: 1, h: 0.07 },
  ],
  reels: [
    { label: "Nút tương tác", x: 0.85, y: 0.5, w: 0.13, h: 0.38 },
    { label: "Tên + chú thích", x: 0.03, y: 0.8, w: 0.78, h: 0.12 },
    { label: "Thanh dưới", x: 0, y: 0.93, w: 1, h: 0.07 },
  ],
  shorts: [
    { label: "Nút tương tác", x: 0.84, y: 0.45, w: 0.14, h: 0.42 },
    { label: "Tiêu đề + kênh", x: 0.03, y: 0.8, w: 0.78, h: 0.13 },
  ],
};

export function Preview({ store, client }: { store: EditorStore; client: MediaToolClient }) {
  const comp = useEditor(store, (s) => s.comp);
  const time = useEditor(store, (s) => s.time);
  const playing = useEditor(store, (s) => s.playing);
  const selection = useEditor(store, (s) => s.selection);
  const selected = useEditor(store, (s) => s.selected);
  const view = useEditor(store, (s) => s.view);
  const guides = useEditor(store, (s) => s.guides);
  const rate = useEditor(store, (s) => s.rate);
  const loop = useEditor(store, (s) => s.loop);
  const [frame, setFrame] = useState<PreviewFrame | null>(null);
  // bản dựng + thời điểm của khung đang hiển thị → khung chọn tự bù phần đã thay đổi từ đó (không đợi render xong)
  const frameSrc = useRef<{ comp: Composition; time: number } | null>(null);
  const interacting = useEditor(store, (s) => s.interacting);
  const [error, setError] = useState<string | null>(null);
  const [box, setBox] = useState({ w: 800, h: 450 });
  const [spaceDown, setSpaceDown] = useState(false);
  const busy = useRef(false);
  const wanted = useRef<{ comp: unknown; time: number; width: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // kích thước vùng xem
  useLayoutEffect(() => {
    const el = viewportRef.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cw = comp.canvas.width, ch = comp.canvas.height;
  const fitScale = Math.min((box.w - 24) / cw, (box.h - 24) / ch);
  const scale = view.zoom === "fit" ? fitScale : view.zoom;
  const stageW = cw * scale, stageH = ch * scale;
  const left = (box.w - stageW) / 2 + (view.zoom === "fit" ? 0 : view.panX);
  const top = (box.h - stageH) / 2 + (view.zoom === "fit" ? 0 : view.panY);

  // Luôn tối đa 1 request; khi đang bận thì giữ yêu cầu mới nhất (bỏ khung trung gian khi phát).
  const request = (c: unknown, t: number, width: number) => {
    wanted.current = { comp: c, time: t, width };
    if (busy.current) return;
    void (async () => {
      while (wanted.current) {
        const w = wanted.current;
        wanted.current = null;
        busy.current = true;
        try {
          const f = await client.previewFrame(w.comp, w.time, w.width);
          frameSrc.current = { comp: w.comp as Composition, time: w.time };
          setFrame(f);
          if (f.resolved) store.set({ resolved: f.resolved });
          setError(null);
        } catch (e) {
          const msg = (e as Error).message;
          if (!msg.includes("Bỏ qua")) setError(msg);
        } finally {
          busy.current = false;
        }
      }
    })();
  };

  // độ phân giải xin engine: theo kích thước đang hiển thị × mật độ điểm ảnh (khi phát thì giảm để mượt)
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  // đang phát hoặc đang kéo: render độ phân giải thấp hơn để khung về nhanh, thả chuột là render nét lại
  const wantW = Math.min(cw, Math.max(160, Math.round(stageW * dpr * (playing ? 0.5 : interacting ? 0.6 : 1))));
  const bucketW = Math.min(cw, Math.ceil(wantW / 160) * 160);
  useEffect(() => {
    const id = setTimeout(() => request(comp, time, bucketW), playing || interacting ? 0 : 30);
    return () => clearTimeout(id);
  }, [comp, time, playing, interacting, bucketW]);

  // phím Space để pan (khi không phát)
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.code === "Space" && e.altKey && setSpaceDown(true);
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceDown(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const setZoom = (z: number | "fit", anchor?: { x: number; y: number }) => {
    if (z === "fit") return store.set({ view: { zoom: "fit", panX: 0, panY: 0 } });
    const nz = Math.min(ZOOM.max, Math.max(ZOOM.min, z));
    // giữ điểm dưới con trỏ đứng yên khi zoom
    let { panX, panY } = view.zoom === "fit" ? { panX: 0, panY: 0 } : view;
    if (anchor) {
      const cx = anchor.x - box.w / 2 - panX, cy = anchor.y - box.h / 2 - panY;
      const k = nz / scale;
      panX -= cx * (k - 1);
      panY -= cy * (k - 1);
    }
    store.set({ view: { zoom: nz, panX, panY } });
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = viewportRef.current!.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(scale * (e.deltaY < 0 ? ZOOM.step : 1 / ZOOM.step), { x: e.clientX - r.left, y: e.clientY - r.top });
    } else if (view.zoom !== "fit") {
      store.set({ view: { ...view, panX: view.panX - e.deltaX - (e.shiftKey ? e.deltaY : 0), panY: view.panY - (e.shiftKey ? 0 : e.deltaY) } });
    }
  };

  const startPan = (e: React.PointerEvent) => {
    const z = view.zoom === "fit" ? scale : view.zoom;
    const p0 = view.zoom === "fit" ? { panX: 0, panY: 0 } : view;
    const x0 = e.clientX, y0 = e.clientY;
    const move = (ev: PointerEvent) => store.set({ view: { zoom: z, panX: p0.panX + ev.clientX - x0, panY: p0.panY + ev.clientY - y0 } });
    beginDrag(move);
  };

  const layer = comp.layers.find((l) => l.id === selected);
  /** Khung bao của lớp: lấy từ khung đã render rồi cộng phần vị trí/to nhỏ/xoay đã đổi sau đó → bám tay ngay khi kéo. */
  const boundsOf = (id: string): LayerBounds | undefined => {
    const b = frame?.bounds.find((x) => x.id === id);
    const src = frameSrc.current;
    const a = src?.comp.layers.find((x) => x.id === id);
    const now = comp.layers.find((x) => x.id === id);
    if (!b || !a || !now || !src) return b;
    const v = (l: Layer, p: "x" | "y" | "scale" | "rotation", t: number) => valueAt(l, p, t);
    const k = v(now, "scale", time) / (v(a, "scale", src.time) || 1);
    const cx = b.x + b.w / 2 + (v(now, "x", time) - v(a, "x", src.time));
    const cy = b.y + b.h / 2 + (v(now, "y", time) - v(a, "y", src.time));
    const w = b.w * k, h = b.h * k;
    return { ...b, x: cx - w / 2, y: cy - h / 2, w, h, rotation: b.rotation + (v(now, "rotation", time) - v(a, "rotation", src.time)) };
  };

  const startDrag = (e: React.PointerEvent, mode: "move" | "scale" | "rotate") => {
    if (!layer || layer.locked) return;
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY;
    const starts = comp.layers.filter((l) => selection.includes(l.id) && !l.locked).map((l) => ({ id: l.id, x: l.x, y: l.y }));
    const s0 = { scale: layer.scale, rotation: layer.rotation };
    const rect = stageRef.current!.getBoundingClientRect();
    const cx = rect.left + layer.x * rect.width, cy = rect.top + layer.y * rect.height;
    const a0 = Math.atan2(y0 - cy, x0 - cx);
    const key = `drag-${layer.id}-${Date.now()}`;
    const move = (ev: PointerEvent) => {
      if (mode === "move") {
        const dx = (ev.clientX - x0) / rect.width, dy = (ev.clientY - y0) / rect.height;
        store.apply((c) => ({
          ...c,
          layers: c.layers.map((l) => {
            const st = starts.find((s) => s.id === l.id);
            if (!st) return l;
            let nx = st.x + dx, ny = st.y + dy;
            if (!ev.altKey) for (const snap of [0.5, 0.1, 0.9]) {
              if (Math.abs(nx - snap) < 0.008) nx = snap;
              if (Math.abs(ny - snap) < 0.008) ny = snap;
            }
            return { ...l, x: +nx.toFixed(4), y: +ny.toFixed(4) };
          }),
        }), key);
      } else if (mode === "scale") {
        const d0 = Math.hypot(x0 - cx, y0 - cy), d1 = Math.hypot(ev.clientX - cx, ev.clientY - cy);
        store.updateLayer(layer.id, { scale: +Math.max(0.02, (s0.scale * d1) / Math.max(1, d0)).toFixed(3) }, key);
      } else {
        let deg = s0.rotation + ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180) / Math.PI;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15; // Shift: bước 15°
        store.updateLayer(layer.id, { rotation: +deg.toFixed(1) }, key);
      }
    };
    beginDrag(move);
  };

  const snapshot = async () => {
    const f = await client.previewFrame(comp, time, cw);
    const a = document.createElement("a");
    a.href = f.image;
    a.download = `khung_${time.toFixed(2)}s.jpg`;
    a.click();
  };

  const panning = spaceDown;
  return (
    <div className="ed-preview">
      <div className="ed-pv-bar">
        <select className="mt-select ed-mini" value={view.zoom === "fit" ? "fit" : String(view.zoom)}
          onChange={(e) => setZoom(e.target.value === "fit" ? "fit" : Number(e.target.value))}>
          <option value="fit">Vừa khung</option>
          {ZOOM_PRESETS.map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
          {view.zoom !== "fit" && !ZOOM_PRESETS.includes(view.zoom) && <option value={view.zoom}>{Math.round(view.zoom * 100)}%</option>}
        </select>
        <button className="ed-ibtn" title="Phóng to (Ctrl+lăn chuột)" aria-label="Phóng to" onClick={() => setZoom(scale * ZOOM.step)}><ZoomIn size={15} /></button>
        <button className="ed-ibtn" title="Thu nhỏ" aria-label="Thu nhỏ" onClick={() => setZoom(scale / ZOOM.step)}><ZoomOut size={15} /></button>
        <span className="ed-sep" />
        <button className={`ed-ibtn ${guides.grid ? "on" : ""}`} title="Lưới 1/3" onClick={() => store.set({ guides: { ...guides, grid: !guides.grid } })} aria-label="Lưới 1/3"><Grid3x3 size={15} /></button>
        <button className={`ed-ibtn ${guides.safe ? "on" : ""}`} title="Vùng an toàn chữ/hành động" onClick={() => store.set({ guides: { ...guides, safe: !guides.safe } })} aria-label="Vùng an toàn"><RectangleHorizontal size={15} /></button>
        <button className={`ed-ibtn ${guides.center ? "on" : ""}`} title="Đường tâm" onClick={() => store.set({ guides: { ...guides, center: !guides.center } })} aria-label="Đường tâm"><Crosshair size={15} /></button>
        <select className="mt-select ed-mini" value={guides.platform} title="Khung giao diện nền tảng"
          onChange={(e) => store.set({ guides: { ...guides, platform: e.target.value as Platform } })}>
          <option value="none">Không khung</option>
          <option value="tiktok">TikTok</option>
          <option value="reels">Reels</option>
          <option value="shorts">Shorts</option>
        </select>
        <span className="ed-grow" />
        <select className="mt-select ed-mini" value={rate} title="Tốc độ phát xem trước" onChange={(e) => store.set({ rate: Number(e.target.value) })}>
          {[0.25, 0.5, 1, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}
        </select>
        <button className={`ed-ibtn ${loop ? "on" : ""}`} title="Phát lặp" aria-label="Phát lặp" onClick={() => store.set({ loop: !loop })}><Repeat size={15} /></button>
        <button className="ed-ibtn" title="Chụp khung hình (độ phân giải đầy đủ)" aria-label="Chụp khung hình" onClick={() => void snapshot()}><Camera size={15} /></button>
      </div>

      <div className={`ed-viewport ${panning ? "panning" : ""}`} ref={viewportRef} onWheel={onWheel}
        onPointerDown={(e) => {
          if (e.button === 1 || panning) { e.preventDefault(); startPan(e); }
          else if (e.target === e.currentTarget) store.select(null);
        }}>
        <div className="ed-stage" ref={stageRef} style={{ left, top, width: stageW, height: stageH }}
          onPointerDown={(e) => {
            if (e.button !== 0 || panning) return;
            if (!frame || !stageRef.current) return;
            const r = stageRef.current.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
            const hit = [...frame.bounds].reverse().find((x) => px >= x.x && px <= x.x + x.w && py >= x.y && py <= x.y + x.h);
            store.select(hit?.id ?? null, e.shiftKey || e.ctrlKey || e.metaKey);
          }}>
          {frame ? <img src={frame.image} alt="" draggable={false} /> : <div className="ed-dim ed-center">Đang render…</div>}
          {(() => {
            if (!comp.layers.length) return <div className="ed-stage-empty"><b>Chưa có gì để xem</b><span>Bấm một video, ảnh hoặc nhạc ở Thư viện bên trái để thêm vào timeline.</span></div>;
            const active = comp.layers.some((l) => !l.hidden && l.type !== "audio" && time >= l.start && time < l.start + l.duration);
            if (active) return null;
            const visual = comp.layers.filter((l) => !l.hidden && l.type !== "audio");
            const next = visual.filter((l) => l.start > time).sort((a, b) => a.start - b.start)[0] ?? visual.sort((a, b) => a.start - b.start)[0];
            return (
              <div className="ed-stage-empty">
                <b>Không có hình tại {time.toFixed(1)} giây</b>
                <span>Kéo vạch đỏ trên timeline tới một clip, hoặc bấm nút dưới.</span>
                {next && <button className="mt-btn small primary" onClick={() => store.set({ time: next.start + 0.01 })}>Tới clip “{next.name}”</button>}
              </div>
            );
          })()}

          {guides.grid && (
            <svg className="ed-guides" viewBox="0 0 3 3" preserveAspectRatio="none">
              <path d="M1 0V3M2 0V3M0 1H3M0 2H3" />
            </svg>
          )}
          {guides.center && (
            <svg className="ed-guides" viewBox="0 0 2 2" preserveAspectRatio="none">
              <path d="M1 0V2M0 1H2" />
            </svg>
          )}
          {guides.safe && (
            <>
              <div className="ed-safe" style={{ inset: "5%" }}><span>Vùng hành động</span></div>
              <div className="ed-safe title" style={{ inset: "10%" }}><span>Vùng chữ</span></div>
            </>
          )}
          {guides.platform !== "none" && PLATFORM_ZONES[guides.platform].map((z) => (
            <div key={z.label} className="ed-zone" style={{ left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%` }}>
              <span>{z.label}</span>
            </div>
          ))}

          {selection.filter((id) => id !== selected).map((id) => {
            const b = boundsOf(id);
            return b && <div key={id} className="ed-sel ghost" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, transform: `rotate(${b.rotation}deg)` }} />;
          })}
          {(() => {
            const b = selected ? boundsOf(selected) : undefined;
            if (!b || !layer || layer.locked) return null;
            return (
              <div className="ed-sel" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, transform: `rotate(${b.rotation}deg)` }}
                onPointerDown={(e) => e.button === 0 && !panning && startDrag(e, "move")}>
                <span className="ed-handle" title="Kéo để phóng to/thu nhỏ" onPointerDown={(e) => startDrag(e, "scale")} />
                <span className="ed-rot" title="Kéo để xoay (Shift: bước 15°)" onPointerDown={(e) => startDrag(e, "rotate")} />
              </div>
            );
          })()}
        </div>
      </div>
      <div className="ed-preview-info">
        {error ? <span className="ed-err">Engine: {error}</span>
          : frame && <span className="ed-dim">{cw}×{ch} · hiển thị {Math.round(scale * 100)}% · khung {frame.width}px · render {frame.render_ms} ms · Alt+Space hoặc chuột giữa để kéo khung · Ctrl+lăn để zoom</span>}
      </div>
    </div>
  );
}

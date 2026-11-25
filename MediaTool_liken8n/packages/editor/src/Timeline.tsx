// Timeline nhiều lớp: dời/cắt clip, hút (snap), chọn nhiều, zoom quanh con trỏ, filmstrip + sóng âm (engine native).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MediaToolClient } from "@mediatool/api-client";
import { Eye, EyeOff, Image, Lock, LockOpen, Flag, Magnet, Sparkles, Maximize2, Music, ZoomIn, ZoomOut, Square, Type, Video, Volume2, VolumeX } from "lucide-react";
import { compEnd, layerEnd, newId, type Layer } from "./model";
import { useEditor, type EditorStore } from "./store";

const HEAD_W = 170;
const PPS_MIN = 2;
const PPS_MAX = 1000;
const ROW_H = 52;
const CLIP_H = ROW_H - 8;
const fmt = (t: number) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};
const ICONS = { video: Video, image: Image, text: Type, shape: Square, audio: Music, adjust: Sparkles };
const icon = (l: Layer) => { const I = ICONS[l.type]; return <I size={14} />; };
/** Tỉ lệ khung của dải ảnh (đọc từ kích thước ảnh thật), cache theo URL. */
const aspectCache = new Map<string, number>();
function useSpriteAspect(url: string | null, count: number) {
  const [a, setA] = useState(() => (url && aspectCache.get(url)) || 0);
  useEffect(() => {
    if (!url) return;
    const hit = aspectCache.get(url);
    if (hit) return setA(hit);
    const img = new window.Image();
    img.onload = () => {
      const v = img.naturalWidth / count / Math.max(1, img.naturalHeight);
      aspectCache.set(url, v);
      setA(v);
    };
    img.src = url;
  }, [url, count]);
  return a;
}

/** Bậc thời gian (giây nguồn) cho mỗi ô ảnh: chọn bậc nhỏ nhất ≥ thời lượng một ô → URL ổn định, cache tốt khi zoom. */
const FILM_STEPS = [0.04, 0.08, 0.2, 0.4, 1, 2, 4, 10, 20, 40, 60, 120];
/** Số ô trong một ảnh ghép (một request). */
const CHUNK = 12;

/**
 * Dải hình của clip video kiểu CapCut/OpenCut: ô ảnh giữ đúng tỉ lệ khung (không kéo giãn), mỗi ô là khung hình tại
 * đúng thời điểm của nó. Ảnh được xin theo từng đoạn (from/to) và chỉ cho phần đang thấy trên màn hình,
 * nên zoom sâu bao nhiêu cũng có khung riêng cho từng ô.
 */
function FilmTiles({ client, id, src, trim, speed, duration, pps, start, visible }: {
  client: MediaToolClient; id: string; src: number; trim: number; speed: number; duration: number; pps: number;
  start: number; visible: [number, number];
}) {
  const h = Math.min(360, CLIP_H * 2);
  const aspect = useSpriteAspect(client.filmstripUrl(id, 1, h), 1);
  if (!aspect) return <span className="ed-film loading" />;
  const tileW = CLIP_H * aspect;
  const tileSrc = (tileW / pps) * speed; // giây nguồn mà một ô phủ
  const dt = FILM_STEPS.find((x) => x >= tileSrc) ?? Math.ceil(tileSrc);
  const width = duration * pps;
  const clipX = start * pps;
  // chỉ vẽ ô trong vùng đang thấy (+ một ít đệm)
  const i0 = Math.max(0, Math.floor((visible[0] - clipX) / tileW) - 2);
  const i1 = Math.min(Math.ceil(width / tileW), Math.ceil((visible[1] - clipX) / tileW) + 2);
  const tiles: JSX.Element[] = [];
  for (let i = i0; i < i1; i++) {
    const t = Math.min(src - 1e-3, trim + ((i * tileW + tileW / 2) / pps) * speed);
    const k = Math.max(0, Math.floor(t / dt));
    const c = Math.floor(k / CHUNK);
    const from = c * CHUNK * dt;
    const url = client.filmstripUrl(id, CHUNK, h, [from, from + CHUNK * dt]);
    tiles.push(<span key={i} style={{ left: i * tileW, width: tileW, backgroundImage: `url(${url})`, backgroundSize: `${CHUNK * tileW}px ${CLIP_H}px`, backgroundPosition: `${-(k % CHUNK) * tileW}px 0` }} />);
  }
  return <span className="ed-film" aria-hidden>{tiles}</span>;
}

const assetId = (l: Layer) => ("source" in l ? l.source.replace(/^asset:/, "") : null);

// ------------------------------------------------------------------ sóng âm (đỉnh do engine tính, cache theo asset)
const peaksCache = new Map<string, Promise<number[]>>();
function usePeaks(client: MediaToolClient, id: string | null) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    if (!peaksCache.has(id)) peaksCache.set(id, client.peaks(id, 1500).then((r) => r.peaks).catch(() => []));
    void peaksCache.get(id)!.then((p) => alive && setPeaks(p));
    return () => {
      alive = false;
    };
  }, [client, id]);
  return peaks;
}

function Waveform({ client, l, width }: { client: MediaToolClient; l: Layer; width: number }) {
  const id = assetId(l);
  const peaks = usePeaks(client, id);
  const ref = useRef<HTMLCanvasElement>(null);
  const src = "source_duration" in l ? l.source_duration : undefined;
  const trim = "trim_start" in l ? l.trim_start : 0;
  const speed = l.speed ?? 1;
  useEffect(() => {
    const c = ref.current;
    if (!c || !peaks?.length || !src) return;
    const w = (c.width = Math.max(1, Math.round(width)));
    const h = (c.height = 22);
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,.75)";
    const from = trim / src, span = (l.duration * speed) / src;
    for (let x = 0; x < w; x++) {
      const i = Math.floor((from + (x / w) * span) * peaks.length);
      const p = peaks[Math.min(peaks.length - 1, Math.max(0, i))] ?? 0;
      const bh = Math.max(1, p * h);
      g.fillRect(x, (h - bh) / 2, 1, bh);
    }
  }, [peaks, width, trim, speed, l.duration, src]);
  return <canvas ref={ref} className="ed-wave" />;
}

export function Timeline({ store, client }: { store: EditorStore; client: MediaToolClient }) {
  const comp = useEditor(store, (s) => s.comp);
  const time = useEditor(store, (s) => s.time);
  const playing = useEditor(store, (s) => s.playing);
  const selection = useEditor(store, (s) => s.selection);
  const pps = useEditor(store, (s) => s.pxPerSec);
  const snapOn = useEditor(store, (s) => s.snap);
  const scrollRef = useRef<HTMLDivElement>(null);
  const total = Math.max(compEnd(comp) + 5, 15);
  const width = total * pps;
  const resolved = useEditor(store, (s) => s.resolved);
  // lớp trên cùng hiển thị đầu tiên; thời gian lấy theo kết quả engine đã giải mốc (lớp neo theo mốc/beat/lớp khác)
  const layers = [...comp.layers].reverse().map((l) => {
    const r = resolved[l.id];
    return r && l.timing ? ({ ...l, start: r.start, duration: r.duration } as Layer) : l;
  });
  const markers = comp.markers ?? [];
  const addMarker = () => store.apply((c) => ({ ...c, markers: [...(c.markers ?? []), { id: newId("m"), start: +store.state.time.toFixed(2), label: `Mốc ${(c.markers ?? []).length + 1}`, kind: "section" }] }));

  // playhead luôn trong tầm nhìn khi phát
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = HEAD_W + time * pps;
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft + HEAD_W) el.scrollLeft = x - HEAD_W - 40;
  }, [time, playing, pps]);

  // vùng đang thấy (px theo trục thời gian) — để chỉ tải ô ảnh cần thiết
  const [visible, setVisible] = useState<[number, number]>([0, 2000]);
  useEffect(() => {
    const el = scrollRef.current!;
    let raf = 0;
    const upd = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setVisible([el.scrollLeft, el.scrollLeft + el.clientWidth - HEAD_W]));
    };
    upd();
    el.addEventListener("scroll", upd, { passive: true });
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", upd); ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  const pendingScroll = useRef<number | null>(null);
  /** Zoom giữ nguyên thời điểm dưới điểm neo (px tính từ mép trái vùng clip, trong khung nhìn). */
  const zoomTo = (next: number, anchorPx?: number) => {
    const el = scrollRef.current!;
    const cur = store.state.pxPerSec;
    const nz = Math.min(PPS_MAX, Math.max(PPS_MIN, next));
    const ax = anchorPx ?? Math.min(el.clientWidth - HEAD_W, Math.max(0, store.state.time * cur - el.scrollLeft)); // mặc định neo theo vạch phát
    const tAt = (ax + el.scrollLeft) / cur;
    pendingScroll.current = tAt * nz - ax;
    store.set({ pxPerSec: nz });
  };
  // đặt vị trí cuộn sau khi timeline đã vẽ lại với độ rộng mới (tránh bị trình duyệt cắt về 0)
  useLayoutEffect(() => {
    if (pendingScroll.current == null) return;
    scrollRef.current!.scrollLeft = pendingScroll.current;
    pendingScroll.current = null;
  }, [pps]);

  // Lăn chuột: Ctrl/⌘ (hoặc chụm 2 ngón) = zoom quanh con trỏ · lăn thường = cuộn ngang · Shift+lăn = cuộn dọc
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
        zoomTo(store.state.pxPerSec * k, e.clientX - r.left - HEAD_W);
      } else if (e.shiftKey) {
        e.preventDefault();
        el.scrollTop += e.deltaY || e.deltaX;
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 20 : 1);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [store]);

  // Kéo để pan: chuột giữa, hoặc giữ phím cách (Space) rồi kéo — như bàn tay trong CapCut/Premiere
  const [hand, setHand] = useState(false);
  const [panning, setPanning] = useState(false);
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    const down = (e: KeyboardEvent) => { if (e.code === "Space" && !typing(e) && scrollRef.current?.matches(":hover")) setHand(true); };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setHand(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);
  const startPan = (e: React.PointerEvent) => {
    if (!(e.button === 1 || (hand && e.button === 0))) return;
    e.preventDefault();
    e.stopPropagation();
    const el = scrollRef.current!;
    const x0 = e.clientX, y0 = e.clientY, sl = el.scrollLeft, st = el.scrollTop;
    setPanning(true);
    const move = (ev: PointerEvent) => { el.scrollLeft = sl - (ev.clientX - x0); el.scrollTop = st - (ev.clientY - y0); };
    const up = () => { setPanning(false); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const fitAll = () => {
    const el = scrollRef.current!;
    store.set({ pxPerSec: Math.min(PPS_MAX, Math.max(PPS_MIN, (el.clientWidth - HEAD_W - 30) / Math.max(1, compEnd(comp)))) });
    el.scrollLeft = 0;
  };

  // điểm hút: playhead, 0, mép các clip khác (không tính các clip đang kéo)
  const snap = (t: number, exclude: Set<string>, alt: boolean) => {
    if (!snapOn || alt) return Math.max(0, t);
    const pts = [0, store.state.time, ...comp.layers.filter((l) => !exclude.has(l.id)).flatMap((l) => [l.start, layerEnd(l)])];
    const thr = 8 / pps;
    let best = t, dist = thr;
    for (const p of pts) if (Math.abs(p - t) < dist) [best, dist] = [p, Math.abs(p - t)];
    return Math.max(0, best);
  };

  const seekFromEvent = (clientX: number) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    store.set({ time: Math.max(0, (clientX - r.left - HEAD_W + el.scrollLeft) / pps) });
  };

  const dragClip = (e: React.PointerEvent, l: Layer, mode: "move" | "left" | "right") => {
    if (l.locked || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (additive) return store.select(l.id, true);
    if (!selection.includes(l.id)) store.select(l.id);
    const movingIds = mode === "move" && selection.includes(l.id) ? new Set(selection) : new Set([l.id]);
    const starts = comp.layers.filter((x) => movingIds.has(x.id) && !x.locked).map((x) => ({ id: x.id, start: x.start }));
    const x0 = e.clientX;
    const s0 = { start: l.start, duration: l.duration, trim: "trim_start" in l ? l.trim_start : 0 };
    const speed = l.speed ?? 1;
    const key = `clip-${l.id}-${Date.now()}`;
    const srcDur = "source_duration" in l && l.source_duration ? l.source_duration : Infinity;
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / pps;
      if (mode === "move") {
        const a = snap(s0.start + dt, movingIds, ev.altKey);
        const b = snap(s0.start + dt + s0.duration, movingIds, ev.altKey) - s0.duration;
        const chosen = Math.abs(b - (s0.start + dt)) < Math.abs(a - (s0.start + dt)) ? b : a;
        const delta = Math.max(-Math.min(...starts.map((s) => s.start)), chosen - s0.start);
        store.apply((c) => ({
          ...c,
          layers: c.layers.map((x) => {
            const st = starts.find((s) => s.id === x.id);
            return st ? { ...x, start: +(st.start + delta).toFixed(3) } : x;
          }),
        }), key);
      } else if (mode === "right") {
        const end = snap(s0.start + s0.duration + dt, movingIds, ev.altKey);
        const maxDur = (srcDur - s0.trim) / speed;
        store.updateLayer(l.id, { duration: +Math.min(Math.max(0.1, end - s0.start), maxDur).toFixed(3) }, key);
      } else {
        let start = snap(s0.start + dt, movingIds, ev.altKey);
        start = Math.min(start, s0.start + s0.duration - 0.1);
        if ("trim_start" in l) start = Math.max(start, s0.start - s0.trim / speed); // không cắt quá đầu nguồn
        const shift = start - s0.start;
        const patch: Partial<Layer> = { start: +start.toFixed(3), duration: +(s0.duration - shift).toFixed(3) };
        if ("trim_start" in l) (patch as { trim_start: number }).trim_start = +(s0.trim + shift * speed).toFixed(3);
        store.updateLayer(l.id, patch, key);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const dragPlayhead = (e: React.PointerEvent) => {
    e.preventDefault();
    seekFromEvent(e.clientX);
    const move = (ev: PointerEvent) => seekFromEvent(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const step = pps >= 160 ? 0.5 : pps >= 80 ? 1 : pps >= 30 ? 2 : pps >= 15 ? 5 : pps >= 6 ? 10 : 30;
  const ticks = Array.from({ length: Math.ceil(total / step) + 1 }, (_, i) => i * step);

  return (
    <div className="ed-timeline">
      <div className="ed-tl-bar">
        <span className="ed-time">{fmt(time)} / {fmt(compEnd(comp))}</span>
        <button className={`ed-ibtn ${snapOn ? "on" : ""}`} title="Hút vào playhead/mép clip (giữ Alt khi kéo để tạm tắt)" aria-label="Hút dính" onClick={() => store.set({ snap: !snapOn })}><Magnet size={15} /></button>
        {selection.length > 1 && <span className="ed-dim">{selection.length} lớp đang chọn</span>}
        <span className="ed-grow" />
        <button className="ed-ibtn" title="Thêm mốc tại vạch phát (điệp khúc, beat…)" aria-label="Thêm mốc" onClick={addMarker}><Flag size={15} /></button>
        <button className="ed-ibtn" title="Thu nhỏ timeline (Ctrl+lăn xuống)" aria-label="Thu nhỏ timeline" onClick={() => zoomTo(pps / 1.4)}><ZoomOut size={15} /></button>
        <input className="ed-zoom" type="range" min={0} max={1000} aria-label="Mức zoom timeline" title="Zoom timeline (Ctrl+lăn chuột)"
          value={Math.round((Math.log(pps / PPS_MIN) / Math.log(PPS_MAX / PPS_MIN)) * 1000)}
          onChange={(e) => zoomTo(PPS_MIN * Math.pow(PPS_MAX / PPS_MIN, Number(e.target.value) / 1000))} />
        <button className="ed-ibtn" title="Phóng to timeline (Ctrl+lăn lên)" aria-label="Phóng to timeline" onClick={() => zoomTo(pps * 1.4)}><ZoomIn size={15} /></button>
        <button className="ed-ibtn" title="Vừa toàn bộ" aria-label="Vừa toàn bộ" onClick={fitAll}><Maximize2 size={15} /></button>
      </div>
      <div className={`ed-tl-scroll ${hand ? "hand" : ""} ${panning ? "panning" : ""}`} ref={scrollRef} onPointerDownCapture={startPan} onAuxClick={(e) => e.preventDefault()}>
        <div className="ed-tl-inner" style={{ width: width + HEAD_W }}>
          <div className="ed-ruler" onPointerDown={dragPlayhead}>
            <div className="ed-ruler-head" style={{ width: HEAD_W }} />
            {ticks.map((t) => <span key={t} className="ed-tick" style={{ left: HEAD_W + t * pps }}>{fmt(t)}</span>)}
            {markers.map((m) => (m.kind === "beat" || m.kind === "downbeat")
              ? <span key={m.id + m.start} className={`ed-beat ${m.kind}`} style={{ left: HEAD_W + m.start * pps }} />
              : (
                <span key={m.id} className="ed-marker" style={{ left: HEAD_W + m.start * pps, width: m.end ? Math.max(2, (m.end - m.start) * pps) : undefined }}
                  title={`${m.label || m.id} · ${fmt(m.start)}`} onPointerDown={(e) => { e.stopPropagation(); store.set({ time: m.start }); }}>
                  <Flag size={10} /> {m.label || m.id}
                </span>
              ))}
          </div>
          {layers.map((l) => {
            const kfTimes = [...new Set(Object.values(l.keyframes ?? {}).flat().map((k) => k!.t))];
            const id = assetId(l);
            const w = Math.max(6, l.duration * pps);
            const src = "source_duration" in l ? l.source_duration : undefined;
            const tiles = l.type === "video" && id && src
              ? <FilmTiles client={client} id={id} src={src} trim={l.trim_start} speed={l.speed ?? 1} duration={l.duration} pps={pps} start={l.start} visible={visible} />
              : null;
            let film: React.CSSProperties | undefined;
            if (l.type === "image" && id) {
              film = { backgroundImage: `url(${client.assetUrl(id)})`, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x" };
            }
            const on = selection.includes(l.id);
            const animBars = (resolved[l.id]?.animations ?? []).flatMap((a, ai) => a.windows.map(([wa, wb], wi) => (
              <span key={`${ai}-${wi}`} className={`ed-animbar k-${a.kind}`} style={{ left: Math.max(0, (wa - l.start) * pps), width: Math.max(2, (Math.min(wb, l.start + l.duration) - Math.max(wa, l.start)) * pps), top: 2 + (ai % 3) * 4 }} />
            )));
            const move = (e: React.PointerEvent, mode: "move" | "left" | "right") => {
              // kéo lớp đang neo theo mốc → bỏ neo, giữ thời gian đang thấy
              if (l.timing && !l.locked) store.updateLayer(l.id, { timing: null, start: l.start, duration: l.duration });
              dragClip(e, l, mode);
            };
            return (
              <div key={l.id} className={`ed-row ${on ? "on" : ""}`} style={{ height: ROW_H }}>
                <div className="ed-row-head" style={{ width: HEAD_W }} onClick={(e) => store.select(l.id, e.shiftKey || e.ctrlKey || e.metaKey)}>
                  <span className="ed-ico">{icon(l)}</span>
                  <span className="ed-name">{l.name}</span>
                  {(l.type === "video" || l.type === "audio") && (
                    <button title={l.muted ? "Bật tiếng" : "Tắt tiếng"} onClick={(e) => { e.stopPropagation(); store.updateLayer(l.id, { muted: !l.muted } as Partial<Layer>); }}>{l.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
                  )}
                  <button title={l.hidden ? "Hiện" : "Ẩn"} onClick={(e) => { e.stopPropagation(); store.updateLayer(l.id, { hidden: !l.hidden }); }}>{l.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                  <button title={l.locked ? "Mở khóa" : "Khóa"} onClick={(e) => { e.stopPropagation(); store.updateLayer(l.id, { locked: !l.locked }); }}>{l.locked ? <Lock size={14} /> : <LockOpen size={14} />}</button>
                </div>
                <div className="ed-lane" onPointerDown={(e) => { if (e.target === e.currentTarget) { store.select(null); dragPlayhead(e); } }}>
                  <div className={`ed-clip t-${l.type} ${l.hidden ? "hidden" : ""} ${film || tiles ? "film" : ""}`} style={{ left: l.start * pps, width: w, ...film }}
                    onPointerDown={(e) => move(e, "move")} title={`${fmt(l.start)} → ${fmt(layerEnd(l))}${l.timing ? " · neo theo mốc" : ""}`}>
                    {tiles}
                    <span className="ed-edge l" onPointerDown={(e) => move(e, "left")} />
                    <span className="ed-clip-label">
                      {l.type === "text" ? (l as { text: string }).text : l.name}
                      {(l.speed ?? 1) !== 1 && <b className="ed-badge">{l.speed}×</b>}
                      {l.mask && <b className="ed-badge">mask</b>}
                    </span>
                    {(l.type === "audio" || (l.type === "video" && !l.muted)) && <Waveform client={client} l={l} width={w} />}
                    {animBars}
                    {l.timing && <b className="ed-badge ed-anchor" title="Thời gian neo theo mốc">⚓</b>}
                    {(l.fade_in ?? 0) > 0 && <span className="ed-fade in" style={{ width: l.fade_in! * pps }} />}
                    {(l.fade_out ?? 0) > 0 && <span className="ed-fade out" style={{ width: l.fade_out! * pps }} />}
                    {kfTimes.map((t) => (
                      <span key={t} className="ed-kf" style={{ left: t * pps }} title={`Keyframe ${fmt(l.start + t)}`}
                        onPointerDown={(e) => { e.stopPropagation(); store.set({ time: l.start + t }); store.select(l.id); }} />
                    ))}
                    <span className="ed-edge r" onPointerDown={(e) => move(e, "right")} />
                  </div>
                </div>
              </div>
            );
          })}
          {!layers.length && <div className="ed-dim ed-pad">Thêm chữ, hình hoặc bấm vào file trong thư viện để bắt đầu.</div>}
          <div className="ed-playhead" style={{ left: HEAD_W + time * pps }} onPointerDown={dragPlayhead} />
        </div>
      </div>
    </div>
  );
}

// Timeline nhiều lớp: dời/cắt clip, hút (snap), chọn nhiều, zoom quanh con trỏ, filmstrip + sóng âm (engine native).
import { useEffect, useRef, useState } from "react";
import type { MediaToolClient } from "@mediatool/api-client";
import { compEnd, layerEnd, type Layer } from "./model";
import { useEditor, type EditorStore } from "./store";

const HEAD_W = 170;
const ROW_H = 40;
const fmt = (t: number) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};
const icon = (l: Layer) => ({ video: "🎬", image: "🖼", text: "T", shape: "◼", audio: "♪" })[l.type];
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
  const layers = [...comp.layers].reverse(); // lớp trên cùng hiển thị đầu tiên

  // playhead luôn trong tầm nhìn khi phát
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = HEAD_W + time * pps;
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft + HEAD_W) el.scrollLeft = x - HEAD_W - 40;
  }, [time, playing, pps]);

  // Ctrl+lăn: zoom quanh con trỏ (cuộn thường để trình duyệt xử lý)
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const tAt = (e.clientX - r.left - HEAD_W + el.scrollLeft) / store.state.pxPerSec;
      const next = Math.min(400, Math.max(4, store.state.pxPerSec * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      store.set({ pxPerSec: next });
      requestAnimationFrame(() => (el.scrollLeft = tAt * next - (e.clientX - r.left - HEAD_W)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [store]);

  const fitAll = () => {
    const el = scrollRef.current!;
    store.set({ pxPerSec: Math.min(400, Math.max(4, (el.clientWidth - HEAD_W - 30) / Math.max(1, compEnd(comp)))) });
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
        <button className={`ed-ibtn ${snapOn ? "on" : ""}`} title="Hút vào playhead/mép clip (giữ Alt khi kéo để tạm tắt)" onClick={() => store.set({ snap: !snapOn })}>🧲</button>
        {selection.length > 1 && <span className="ed-dim">{selection.length} lớp đang chọn</span>}
        <span className="ed-grow" />
        <button className="ed-ibtn" title="Vừa toàn bộ" onClick={fitAll}>⤢</button>
        <label className="ed-dim">Zoom
          <input type="range" min={4} max={400} value={pps} onChange={(e) => store.set({ pxPerSec: Number(e.target.value) })} />
        </label>
      </div>
      <div className="ed-tl-scroll" ref={scrollRef}>
        <div className="ed-tl-inner" style={{ width: width + HEAD_W }}>
          <div className="ed-ruler" onPointerDown={dragPlayhead}>
            <div className="ed-ruler-head" style={{ width: HEAD_W }} />
            {ticks.map((t) => <span key={t} className="ed-tick" style={{ left: HEAD_W + t * pps }}>{fmt(t)}</span>)}
          </div>
          {layers.map((l) => {
            const kfTimes = [...new Set(Object.values(l.keyframes ?? {}).flat().map((k) => k!.t))];
            const id = assetId(l);
            const w = Math.max(6, l.duration * pps);
            const src = "source_duration" in l ? l.source_duration : undefined;
            let film: React.CSSProperties | undefined;
            if (l.type === "video" && id && src) {
              const count = Math.min(60, Math.max(4, Math.ceil(src / 2)));
              const full = ((src / (l.duration * (l.speed ?? 1))) * w);
              film = {
                backgroundImage: `url(${client.filmstripUrl(id, count, 32)})`,
                backgroundSize: `${full}px 100%`,
                backgroundPosition: `${-(l.trim_start / src) * full}px 0`,
              };
            } else if (l.type === "image" && id) {
              film = { backgroundImage: `url(${client.assetUrl(id)})`, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x" };
            }
            const on = selection.includes(l.id);
            return (
              <div key={l.id} className={`ed-row ${on ? "on" : ""}`} style={{ height: ROW_H }}>
                <div className="ed-row-head" style={{ width: HEAD_W }} onClick={(e) => store.select(l.id, e.shiftKey || e.ctrlKey || e.metaKey)}>
                  <span className="ed-ico">{icon(l)}</span>
                  <span className="ed-name">{l.name}</span>
                  {(l.type === "video" || l.type === "audio") && (
                    <button title={l.muted ? "Bật tiếng" : "Tắt tiếng"} onClick={(e) => { e.stopPropagation(); store.updateLayer(l.id, { muted: !l.muted } as Partial<Layer>); }}>{l.muted ? "🔇" : "🔊"}</button>
                  )}
                  <button title={l.hidden ? "Hiện" : "Ẩn"} onClick={(e) => { e.stopPropagation(); store.updateLayer(l.id, { hidden: !l.hidden }); }}>{l.hidden ? "🙈" : "👁"}</button>
                  <button title={l.locked ? "Mở khóa" : "Khóa"} onClick={(e) => { e.stopPropagation(); store.updateLayer(l.id, { locked: !l.locked }); }}>{l.locked ? "🔒" : "🔓"}</button>
                </div>
                <div className="ed-lane" onPointerDown={(e) => { if (e.target === e.currentTarget) { store.select(null); dragPlayhead(e); } }}>
                  <div className={`ed-clip t-${l.type} ${l.hidden ? "hidden" : ""} ${film ? "film" : ""}`} style={{ left: l.start * pps, width: w, ...film }}
                    onPointerDown={(e) => dragClip(e, l, "move")} title={`${fmt(l.start)} → ${fmt(layerEnd(l))}`}>
                    <span className="ed-edge l" onPointerDown={(e) => dragClip(e, l, "left")} />
                    <span className="ed-clip-label">
                      {l.type === "text" ? (l as { text: string }).text : l.name}
                      {(l.speed ?? 1) !== 1 && <b className="ed-badge">{l.speed}×</b>}
                      {l.mask && <b className="ed-badge">mask</b>}
                    </span>
                    {(l.type === "audio" || (l.type === "video" && !l.muted)) && <Waveform client={client} l={l} width={w} />}
                    {l.animation?.in && <span className="ed-anim in" style={{ width: l.animation.in.duration * pps }} />}
                    {l.animation?.out && <span className="ed-anim out" style={{ width: l.animation.out.duration * pps }} />}
                    {(l.fade_in ?? 0) > 0 && <span className="ed-fade in" style={{ width: l.fade_in! * pps }} />}
                    {(l.fade_out ?? 0) > 0 && <span className="ed-fade out" style={{ width: l.fade_out! * pps }} />}
                    {kfTimes.map((t) => (
                      <span key={t} className="ed-kf" style={{ left: t * pps }} title={`Keyframe ${fmt(l.start + t)}`}
                        onPointerDown={(e) => { e.stopPropagation(); store.set({ time: l.start + t }); store.select(l.id); }} />
                    ))}
                    <span className="ed-edge r" onPointerDown={(e) => dragClip(e, l, "right")} />
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

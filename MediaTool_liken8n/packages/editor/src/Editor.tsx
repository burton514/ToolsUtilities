// Timeline editor: thư viện file · xem trước (engine native) · timeline · thuộc tính. Xuất video qua tool compose_render.
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Notice, ProgressBar } from "@mediatool/ui";
import { isAssetRef, type Asset, type AssetRef, type MediaToolClient } from "@mediatool/api-client";
import { Inspector } from "./Inspector";
import { Preview } from "./Preview";
import { Timeline } from "./Timeline";
import {
  cloneLayer, compEnd, layerEnd, mediaLayer, newComposition, referencedAssets, shapeLayer, splitLayer, textLayer,
  type Composition, type Layer,
} from "./model";
import { EditorStore, useEditor } from "./store";
import "./editor.css";

function probeDuration(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : undefined);
    el.onerror = () => resolve(undefined);
    el.src = url;
  });
}

// ------------------------------------------------------------------ phát tiếng khi xem trước
function useAudioPlayback(store: EditorStore, client: MediaToolClient) {
  const els = useRef(new Map<string, HTMLAudioElement>());
  useEffect(() => {
    const tick = () => {
      const { comp, time, playing } = store.state;
      const live = new Set<string>();
      for (const l of comp.layers) {
        if ((l.type !== "video" && l.type !== "audio") || l.muted || l.hidden) continue;
        live.add(l.id);
        let el = els.current.get(l.id);
        const src = client.assetUrl(l.source.replace(/^asset:/, ""));
        if (!el) {
          el = new Audio();
          el.preload = "auto";
          els.current.set(l.id, el);
        }
        if (el.dataset.src !== src) {
          el.src = src;
          el.dataset.src = src;
        }
        const sp = (l.speed ?? 1) * store.state.rate;
        if (Math.abs(el.playbackRate - sp) > 1e-3) el.playbackRate = sp;
        el.preservesPitch = true;
        const lt = time - l.start;
        let gain = l.volume / 100;
        if ((l.fade_in ?? 0) > 0) gain *= Math.min(1, lt / l.fade_in!);
        if ((l.fade_out ?? 0) > 0) gain *= Math.min(1, (l.duration - lt) / l.fade_out!);
        el.volume = Math.max(0, Math.min(1, gain));
        const inside = time >= l.start && time < layerEnd(l);
        const want = lt * (l.speed ?? 1) + l.trim_start;
        if (playing && inside) {
          if (Math.abs(el.currentTime - want) > 0.3) el.currentTime = want;
          if (el.paused) void el.play().catch(() => undefined);
        } else if (!el.paused) el.pause();
      }
      for (const [id, el] of els.current) if (!live.has(id)) { el.pause(); els.current.delete(id); }
    };
    const unsub = store.subscribe(tick);
    return () => {
      unsub();
      els.current.forEach((el) => el.pause());
    };
  }, [store, client]);
}

// ------------------------------------------------------------------ thư viện file
function Library({ store, client }: { store: EditorStore; client: MediaToolClient }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = () => client.listAssets().then((a) => setAssets(a.filter((x) => ["video", "audio", "image"].includes(x.format)))).catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);
  const add = async (a: Asset) => {
    const ref = { asset_id: a.id, format: a.format, filename: a.filename };
    const dur = a.format === "image" ? undefined : await probeDuration(client.assetUrl(a.id));
    const layer = mediaLayer(store.state.time, ref, dur);
    store.apply((c) => ({ ...c, layers: a.format === "video" || a.format === "image" ? [layer, ...c.layers] : [...c.layers, layer] }));
    store.set({ selected: layer.id });
  };
  return (
    <div className="ed-library">
      <div className="ed-lib-head">
        <b>Thư viện</b>
        <Button small disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Đang tải…" : "+ Tải lên"}</Button>
        <input ref={fileRef} type="file" hidden accept="video/*,audio/*,image/*" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          try {
            const a = await client.uploadAsset(f);
            await load();
            await add(a);
          } finally {
            setBusy(false);
          }
        }} />
      </div>
      <div className="ed-lib-list">
        {assets.map((a) => (
          <button key={a.id} className="ed-lib-item" onClick={() => add(a)} title="Bấm để thêm vào timeline tại playhead">
            {a.format === "image" ? <img src={client.assetUrl(a.id)} alt="" /> : <span className="ed-lib-ico">{a.format === "video" ? "🎬" : "♪"}</span>}
            <span className="ed-lib-name">{a.filename}</span>
            <Badge>{a.format}</Badge>
          </button>
        ))}
        {!assets.length && <div className="ed-dim ed-pad">Chưa có file. Bấm “+ Tải lên”.</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ xuất video
function ExportPanel({ store, client, onClose }: { store: EditorStore; client: MediaToolClient; onClose: () => void }) {
  const [quality, setQuality] = useState<"draft" | "standard" | "high">("standard");
  const [progress, setProgress] = useState<number | null>(null);
  const [msg, setMsg] = useState<string>("");
  const [result, setResult] = useState<AssetRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setError(null);
    setResult(null);
    setProgress(0);
    try {
      const comp = store.state.comp;
      const blob = new Blob([JSON.stringify(comp)], { type: "application/json" });
      const asset = await client.uploadAsset(blob, "composition.json", "composition");
      const job = await client.submitJob("compose_render", { composition: asset.id, media: referencedAssets(comp) }, { quality });
      const final = await client.waitJob(job.id, (ev) => {
        if (ev.event === "progress") {
          setProgress(Number(ev.value ?? 0));
          if (ev.message) setMsg(String(ev.message));
        }
      });
      if (final.status !== "succeeded") throw new Error(final.error?.message ?? final.status);
      const v = final.result?.outputs.video;
      if (isAssetRef(v)) setResult(v);
      setMsg(final.result?.summary ?? "Xong");
    } catch (e) {
      const err = e as Error & { details?: { field: string; message: string }[] };
      setError(err.details?.map((d) => `${d.field}: ${d.message}`).join("; ") || err.message);
    } finally {
      setProgress(null);
    }
  };
  return (
    <div className="ed-modal" onClick={onClose}>
      <div className="ed-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3>Xuất video</h3>
        <div className="ed-row-btns">
          {(["draft", "standard", "high"] as const).map((q) => (
            <Button key={q} small primary={quality === q} onClick={() => setQuality(q)}>{q === "draft" ? "Xem thử (nhanh)" : q === "standard" ? "Chuẩn" : "Chất lượng cao"}</Button>
          ))}
        </div>
        <Button primary block disabled={progress !== null} onClick={run}>{progress !== null ? "Đang xuất…" : "Bắt đầu xuất"}</Button>
        {progress !== null && <><ProgressBar value={progress} /><span className="ed-dim">{msg}</span></>}
        {error && <Notice kind="danger">{error}</Notice>}
        {result && (
          <>
            <Notice kind="ok">{msg}</Notice>
            <video src={client.assetUrl(result.asset_id)} controls style={{ width: "100%" }} />
            <a className="mt-btn" href={client.assetUrl(result.asset_id, true)}>Tải video về</a>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ editor
export function Editor({ client, onExit }: { client: MediaToolClient; onExit?: () => void }) {
  const store = useMemo(() => new EditorStore(newComposition("16:9")), []);
  const comp = useEditor(store, (s) => s.comp);
  const playing = useEditor(store, (s) => s.playing);
  const selected = useEditor(store, (s) => s.selected);
  const selCount = useEditor(store, (s) => s.selection.length);
  useEditor(store, (s) => s.version); // cập nhật trạng thái nút undo/redo
  const [exporting, setExporting] = useState(false);
  useAudioPlayback(store, client);

  // vòng phát
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const end = compEnd(store.state.comp);
      const t = store.state.time + ((now - last) / 1000) * store.state.rate;
      last = now;
      if (t >= end) {
        if (store.state.loop) {
          store.set({ time: 0 });
          raf = requestAnimationFrame(loop);
        } else store.set({ time: end, playing: false });
      } else {
        store.set({ time: t });
        raf = requestAnimationFrame(loop);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, store]);

  const addLayer = (l: Layer) => {
    store.apply((c) => ({ ...c, layers: [...c.layers, l] }));
    // nhảy playhead tới lúc hiệu ứng xuất hiện xong để thấy và chỉnh được lớp ngay
    const shown = l.start + (l.animation?.in?.duration ?? 0) + 0.05;
    store.set({ selected: l.id, ...(store.state.time < shown ? { time: shown } : {}) });
  };
  /** Cắt tại playhead: các lớp đang chọn, hoặc mọi lớp đi qua playhead nếu chưa chọn gì. */
  const split = () => {
    const { comp: c, selection, time } = store.state;
    const targets = new Set(selection.length ? selection : c.layers.filter((l) => time > l.start && time < layerEnd(l)).map((l) => l.id));
    let changed = false;
    const layers = c.layers.flatMap((x) => {
      const parts = targets.has(x.id) ? splitLayer(x, time) : null;
      if (parts) changed = true;
      return parts ?? [x];
    });
    if (changed) store.apply((cc) => ({ ...cc, layers }));
  };
  const duplicate = () => {
    const sel = new Set(store.state.selection);
    const src = store.state.comp.layers.filter((x) => sel.has(x.id));
    if (!src.length) return;
    const offset = Math.max(...src.map(layerEnd)) - Math.min(...src.map((x) => x.start));
    const copies = src.map((l) => cloneLayer(l, +(l.start + offset).toFixed(3)));
    store.apply((c) => ({ ...c, layers: [...c.layers, ...copies] }));
    store.set({ selection: copies.map((l) => l.id) });
  };

  // phím tắt
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === "Space" && !e.altKey) { e.preventDefault(); store.set({ playing: !store.state.playing }); }
      else if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); store.redo(); }
      else if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicate(); }
      else if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); store.copy(); }
      else if (mod && e.key.toLowerCase() === "x") { e.preventDefault(); if (store.copy()) store.deleteSelected(); }
      else if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); store.paste(); }
      else if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); store.set({ selection: store.state.comp.layers.map((l) => l.id) }); }
      else if (e.key === "Escape") store.select(null);
      else if (e.key.toLowerCase() === "s" && !mod) split();
      else if (e.key.toLowerCase() === "l" && !mod) store.set({ loop: !store.state.loop });
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); store.deleteSelected(e.shiftKey); }
      else if (e.key === "End") store.set({ time: compEnd(store.state.comp) });
      else if (e.key === "ArrowUp" && store.state.selected) { e.preventDefault(); store.updateSelected((l) => ({ y: +(l.y - (e.shiftKey ? 0.05 : 0.005)).toFixed(4) }), "nudge"); }
      else if (e.key === "ArrowDown" && store.state.selected) { e.preventDefault(); store.updateSelected((l) => ({ y: +(l.y + (e.shiftKey ? 0.05 : 0.005)).toFixed(4) }), "nudge"); }
      else if (e.key === "ArrowLeft") store.set({ time: Math.max(0, store.state.time - (e.shiftKey ? 1 : 1 / store.state.comp.canvas.fps)) });
      else if (e.key === "ArrowRight") store.set({ time: store.state.time + (e.shiftKey ? 1 : 1 / store.state.comp.canvas.fps) });
      else if (e.key === "Home") store.set({ time: 0 });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  const saveFile = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(comp, null, 2)], { type: "application/json" }));
    a.download = "composition.json";
    a.click();
  };
  const openFile = () => {
    const el = document.createElement("input");
    el.type = "file";
    el.accept = ".json,application/json";
    el.onchange = async () => {
      const f = el.files?.[0];
      if (f) store.replace(JSON.parse(await f.text()) as Composition);
    };
    el.click();
  };

  return (
    <div className="ed-root">
      <header className="ed-top">
        {onExit && <Button small onClick={onExit}>← Quay lại</Button>}
        <b>Timeline editor</b>
        <Button small onClick={() => store.undo()} disabled={!store.canUndo()} title="Ctrl+Z">↶</Button>
        <Button small onClick={() => store.redo()} disabled={!store.canRedo()} title="Ctrl+Y">↷</Button>
        <span className="ed-sep" />
        <Button small onClick={() => addLayer(textLayer(store.state.time))}>+ Chữ</Button>
        <Button small onClick={() => addLayer(shapeLayer(store.state.time, "rect"))}>+ Hình</Button>
        <Button small onClick={split} title="S (lớp đang chọn, hoặc mọi lớp đi qua playhead)">✂ Cắt</Button>
        <Button small onClick={duplicate} disabled={!selected} title="Ctrl+D">Nhân bản</Button>
        <Button small onClick={() => store.copy()} disabled={!selected} title="Ctrl+C">Chép</Button>
        <Button small onClick={() => store.paste()} title="Ctrl+V (dán tại playhead)">Dán</Button>
        <Button small danger onClick={() => store.deleteSelected(true)} disabled={!selected} title="Shift+Del: xóa và dồn các lớp phía sau lên">Xóa dồn{selCount > 1 ? ` (${selCount})` : ""}</Button>
        <span className="ed-sep" />
        <Button small primary={!playing} onClick={() => store.set({ playing: !playing })} title="Space">{playing ? "⏸ Dừng" : "▶ Phát"}</Button>
        <span className="ed-grow" />
        <Button small onClick={openFile}>Mở…</Button>
        <Button small onClick={saveFile}>Lưu JSON</Button>
        <Button small danger onClick={() => confirm("Tạo bản dựng mới? Bản hiện tại sẽ bị thay.") && store.replace(newComposition("16:9"))}>Mới</Button>
        <Button small primary onClick={() => setExporting(true)} disabled={!comp.layers.length}>Xuất video</Button>
      </header>
      <div className="ed-main">
        <Library store={store} client={client} />
        <Preview store={store} client={client} />
        <Inspector store={store} />
      </div>
      <Timeline store={store} client={client} />
      <footer className="ed-foot ed-dim">Space phát/dừng · L lặp · S cắt · Ctrl+C/X/V · Ctrl+D nhân bản · Ctrl+A chọn hết · Del xóa · Shift+Del xóa dồn · ←/→ từng khung (Shift: 1 giây) · ↑/↓ dời lớp · Ctrl+Z/Y · Shift/Ctrl+bấm: chọn nhiều · Alt khi kéo: tắt hút · Ctrl+lăn: zoom</footer>
      {exporting && <ExportPanel store={store} client={client} onClose={() => setExporting(false)} />}
    </div>
  );
}

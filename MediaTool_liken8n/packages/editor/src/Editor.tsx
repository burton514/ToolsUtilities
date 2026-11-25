// Timeline editor: thư viện file · xem trước (engine native) · timeline · thuộc tính. Xuất video qua tool compose_render.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Notice, ProgressBar } from "@mediatool/ui";
import { isAssetRef, type Asset, type AssetRef, type EffectInfo, type MediaToolClient } from "@mediatool/api-client";
import { Inspector } from "./Inspector";
import { Preview } from "./Preview";
import { Timeline } from "./Timeline";
import {
  adjustLayer, cloneLayer, compEnd, isLegacy, layerEnd, mediaLayer, newComposition, referencedAssets, shapeLayer, splitLayer, textLayer,
  type Composition, type Layer,
} from "./model";
import { EditorStore, useEditor } from "./store";
import { LAYOUT_DEFAULT, Splitter, useLayout } from "./layout";
import { CATEGORY_LABEL, CATEGORY_TONE, defaultParams, useEffectLibrary } from "./fxlib";
import { ArrowLeft, Copy, ClipboardPaste, Download, FilePlus2, FolderOpen, Music, Pause, Play, Redo2, Upload, Save, Scissors, Shapes, Sparkles, Trash2, Type, Undo2, Video } from "lucide-react";
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
    const layer = mediaLayer(store.state.comp.layers.length ? store.state.time : 0, ref, dur);
    store.apply((c) => ({ ...c, layers: a.format === "video" || a.format === "image" ? [layer, ...c.layers] : [...c.layers, layer] }));
    store.set({ selected: layer.id });
  };
  const [tab, setTab] = useState<"files" | "effects" | "transitions">("files");
  const fx = useEffectLibrary(client);
  /** Thêm hiệu ứng thư viện thành lớp điều chỉnh tại vạch phát (chuyển cảnh: ngắn, căn giữa vạch phát = chỗ cắt). */
  const addFx = (e: EffectInfo) => {
    const t = store.state.time;
    const tr = e.kind === "transition";
    const layer = adjustLayer(tr ? t - 0.4 : t, tr ? 0.8 : 3, e.name, { type: e.id, amount: 100, params: defaultParams(e) });
    store.apply((c) => ({ ...c, layers: [...c.layers, layer] }));
    store.set({ selected: layer.id, selection: [layer.id] });
  };
  const groups = [...new Set(fx.filter((e) => (tab === "transitions") === (e.kind === "transition")).map((e) => e.category))];
  return (
    <div className="ed-library">
      <div className="ed-seg ed-lib-tabs" role="tablist">
        {([["files", "File"], ["effects", "Hiệu ứng"], ["transitions", "Chuyển cảnh"]] as const).map(([k, lb]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{lb}</button>
        ))}
      </div>
      {tab !== "files" && (
        <div className="ed-lib-list">
          <div className="mt-hint ed-pad">{tab === "transitions" ? "Đặt vạch phát ở chỗ cắt giữa hai clip rồi bấm một chuyển cảnh." : "Bấm để thêm thành lớp điều chỉnh tại vạch phát — áp cho mọi thứ bên dưới. Muốn áp riêng một lớp: tab Hiệu ứng của lớp đó."}</div>
          {groups.map((g) => (
            <section key={g} className="ed-fxgroup">
              <h5>{CATEGORY_LABEL[g] ?? g}</h5>
              <div className="ed-fxgrid">
                {fx.filter((e) => e.category === g).map((e) => (
                  <button key={e.id} className="ed-fxcard" title={e.description} onClick={() => addFx(e)}>
                    <span className="ed-fxthumb" style={{ background: CATEGORY_TONE[g] ?? "var(--mt-surface-3)" }}><Sparkles size={16} /></span>
                    <span className="ed-fxname">{e.name}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {!fx.length && <div className="ed-dim ed-pad">Không đọc được thư viện hiệu ứng từ máy chủ.</div>}
        </div>
      )}
      {tab === "files" && <>
      <div className="ed-lib-head">
        <b>File của bạn</b>
        <Button small icon={<Upload size={14} />} loading={busy} onClick={() => fileRef.current?.click()}>{busy ? "Đang tải…" : "Tải lên"}</Button>
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
            {a.format === "image" ? <span className="ed-lib-thumb"><img src={client.assetUrl(a.id)} alt="" loading="lazy" /></span>
              : a.format === "video" ? <span className="ed-lib-thumb"><img src={client.thumbnailUrl(a.id, 180)} alt="" loading="lazy" /><Play size={14} className="ed-lib-play" /></span>
              : <span className="ed-lib-thumb audio"><Music size={18} /></span>}
            <span className="ed-lib-name">{a.filename}</span>
            <span className="ed-lib-kind">{({ video: "Video", audio: "Âm thanh", image: "Ảnh" } as Record<string, string>)[a.format] ?? a.format}</span>
          </button>
        ))}
        {!assets.length && <div className="ed-dim ed-pad">Chưa có file nào. Tải video, nhạc hoặc ảnh lên để bắt đầu.</div>}
      </div>
      </>}
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
  useEffect(() => store.trackPointer(), [store]);
  // bố cục kéo được: thư viện | xem trước | thuộc tính, phần trên | timeline
  const rootRef = useRef<HTMLDivElement>(null);
  const fixedH = useCallback(() => {
    const r = rootRef.current;
    return (r?.querySelector(".ed-top")?.clientHeight ?? 48) + (r?.querySelector(".ed-foot")?.clientHeight ?? 24) + 6;
  }, []);
  const { layout, set: setLayout, vars } = useLayout(rootRef, fixedH);

  // Bản dựng dạng cũ (mở file / bản tự lưu trước đây) → nâng cấp bằng chính engine (một nguồn chuẩn duy nhất)
  useEffect(() => {
    if (!isLegacy(comp)) return;
    client.prepareComposition<Composition>(comp)
      .then((c) => store.replace(JSON.parse(JSON.stringify(c, (k, v) => (k === "_windows" || k === "_window" ? undefined : v)))))
      .catch(() => undefined);
  }, [comp, client, store]);

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
    const shown = l.start + Math.max(0, ...(l.animations ?? []).filter((a) => a.kind === "in").map((a) => a.duration ?? 0.5)) + 0.05;
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
    <div className="ed-root" ref={rootRef} style={vars}>
      <header className="ed-top">
        {onExit && <Button small ghost icon={<ArrowLeft size={14} />} onClick={onExit}>Quay lại</Button>}
        <b className="ed-title">Dựng video</b>
        <Button small onClick={() => store.undo()} disabled={!store.canUndo()} title="Hoàn tác (Ctrl+Z)" icon={<Undo2 size={14} />} aria-label="Hoàn tác" />
        <Button small onClick={() => store.redo()} disabled={!store.canRedo()} title="Làm lại (Ctrl+Y)" icon={<Redo2 size={14} />} aria-label="Làm lại" />
        <span className="ed-sep" />
        <Button small icon={<Type size={14} />} onClick={() => addLayer(textLayer(store.state.time))}>Chữ</Button>
        <Button small icon={<Shapes size={14} />} onClick={() => addLayer(shapeLayer(store.state.time, "rect"))}>Hình</Button>
        <Button small onClick={split} icon={<Scissors size={14} />} title="Cắt tại vạch phát (phím S)">Cắt</Button>
        <Button small onClick={duplicate} disabled={!selected} icon={<Copy size={14} />} title="Nhân bản (Ctrl+D)">Nhân bản</Button>
        <Button small onClick={() => store.copy()} disabled={!selected} title="Sao chép (Ctrl+C)">Chép</Button>
        <Button small onClick={() => store.paste()} icon={<ClipboardPaste size={14} />} title="Dán tại vạch phát (Ctrl+V)">Dán</Button>
        <Button small danger onClick={() => store.deleteSelected(true)} disabled={!selected} icon={<Trash2 size={14} />} title="Xóa và dồn các lớp phía sau lên (Shift+Del)">Xóa{selCount > 1 ? ` (${selCount})` : ""}</Button>
        <span className="ed-sep" />
        <Button small primary={!playing} onClick={() => store.set({ playing: !playing })} title="Phát / dừng (phím cách)" icon={playing ? <Pause size={14} /> : <Play size={14} />}>{playing ? "Dừng" : "Phát"}</Button>
        <span className="ed-grow" />
        <Button small ghost icon={<FolderOpen size={14} />} onClick={openFile}>Mở</Button>
        <Button small ghost icon={<Save size={14} />} onClick={saveFile} title="Lưu bản dựng ra file .json">Lưu</Button>
        <Button small ghost icon={<FilePlus2 size={14} />} onClick={() => confirm("Tạo bản dựng mới? Bản hiện tại sẽ bị thay.") && store.replace(newComposition("16:9"))}>Mới</Button>
        <Button small primary icon={<Download size={14} />} onClick={() => setExporting(true)} disabled={!comp.layers.length}>Xuất video</Button>
      </header>
      <div className="ed-main">
        <Library store={store} client={client} />
        <Preview store={store} client={client} />
        <Inspector store={store} client={client} />
        <Splitter axis="x" label="Độ rộng thư viện" className="ed-split-lib" value={layout.lib}
          toValue={(ev) => ev.clientX - (rootRef.current?.getBoundingClientRect().left ?? 0)}
          onChange={(lib, done) => setLayout({ lib }, done)} onReset={() => setLayout({ lib: LAYOUT_DEFAULT.lib }, true)} />
        <Splitter axis="x" label="Độ rộng bảng thuộc tính" className="ed-split-insp" value={layout.insp}
          toValue={(ev) => (rootRef.current?.getBoundingClientRect().right ?? 0) - ev.clientX}
          onChange={(insp, done) => setLayout({ insp }, done)} onReset={() => setLayout({ insp: LAYOUT_DEFAULT.insp }, true)} />
      </div>
      <div className="ed-tl-wrap">
        <Splitter axis="y" label="Chiều cao timeline" className="ed-split-tl" value={layout.tl}
          toValue={(ev) => (rootRef.current?.querySelector(".ed-foot")?.getBoundingClientRect().top ?? window.innerHeight) - ev.clientY}
          onChange={(tl, done) => setLayout({ tl }, done)} onReset={() => setLayout({ tl: LAYOUT_DEFAULT.tl }, true)} />
        <Timeline store={store} client={client} />
      </div>
      <footer className="ed-foot ed-dim">Space phát/dừng · L lặp · S cắt · Ctrl+C/X/V · Ctrl+D nhân bản · Ctrl+A chọn hết · Del xóa · Shift+Del xóa dồn · ←/→ từng khung (Shift: 1 giây) · ↑/↓ dời lớp · Ctrl+Z/Y · Shift/Ctrl+bấm: chọn nhiều · Alt khi kéo: tắt hút · Ctrl+lăn: zoom</footer>
      {exporting && <ExportPanel store={store} client={client} onClose={() => setExporting(false)} />}
    </div>
  );
}

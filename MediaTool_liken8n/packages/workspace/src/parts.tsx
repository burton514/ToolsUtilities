// Các vùng dùng chung của workspace: viewer, timeline, asset bin, job bar, toast, error boundary.
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Button, ProgressBar } from "@mediatool/ui";
import type { AssetRef } from "@mediatool/api-client";
import { useSession, type Session, type TrackState } from "./session";

const fmtBytes = (n?: number) =>
  n == null ? "" : n < 1024 ? `${n} B` : n < 2 ** 20 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 2 ** 20).toFixed(1)} MB`;

// ---------------------------------------------------------------- error boundary (mỗi slot một cái)
export class SlotBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="ws-slot-error">
        <b>Phần “{this.props.name}” của mini app gặp lỗi.</b>
        <code>{this.state.error.message}</code>
        <Button small onClick={() => this.setState({ error: null })}>Tải lại phần này</Button>
      </div>
    );
  }
}

// ---------------------------------------------------------------- viewer
function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState("Đang tải…");
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((r) => r.text())
      .then((t) => alive && setText(t.length > 200_000 ? t.slice(0, 200_000) + "\n…" : t))
      .catch((e) => alive && setText(String(e)));
    return () => {
      alive = false;
    };
  }, [url]);
  return <pre className="ws-text">{text}</pre>;
}

export function Viewer({ session }: { session: Session }) {
  const current = useSession(session, (s) => s.current);
  const result = useSession(session, (s) => s.result);
  const compare = useSession(session, (s) => s.compare);
  const gain = useSession(session, (s) => (s.mainMuted ? 0 : s.mainGain));
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);

  useEffect(() => {
    session.mediaEl = ref.current;
    return () => {
      if (session.mediaEl === ref.current) session.mediaEl = null;
    };
  });
  useEffect(() => {
    if (ref.current) ref.current.volume = Math.max(0, Math.min(1, gain));
  }, [gain, current]);

  if (!current) return <div className="ws-viewer ws-empty">Chưa có gì để xem</div>;
  const url = session.client.assetUrl(current.asset_id);
  let body: ReactNode;
  if (current.format === "video") body = <video key={url} ref={ref} src={url} controls />;
  else if (current.format === "audio") body = <audio key={url} ref={ref} src={url} controls />;
  else if (current.format === "image") body = <img src={url} alt={current.filename} />;
  else body = <TextPreview url={url} />;

  return (
    <div className="ws-viewer">
      {result && (
        <div className="ws-viewer-bar">
          <Badge kind="ok">Kết quả</Badge>
          <Button small onClick={() => session.set({ current: result })} disabled={current.asset_id === result.asset_id}>Xem kết quả</Button>
          {compare && <Button small onClick={() => session.set({ current: compare })} disabled={current.asset_id === compare.asset_id}>Xem bản gốc</Button>}
          <a className="mt-btn small" href={session.client.assetUrl(result.asset_id, true)}>Tải về</a>
        </div>
      )}
      <div className="ws-viewer-body">{body}</div>
      <div className="ws-viewer-caption">{current.filename} · {current.format} {fmtBytes(current.size_bytes)}</div>
    </div>
  );
}

// ---------------------------------------------------------------- timeline
function Waveform({ url }: { url: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(url);
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > 60 * 2 ** 20) return; // file quá lớn: bỏ qua vẽ sóng
      const buf = await res.arrayBuffer();
      const ctx = new AudioContext();
      const audio = await ctx.decodeAudioData(buf).finally(() => void ctx.close());
      const c = canvas.current;
      if (!alive || !c) return;
      const w = (c.width = c.clientWidth * devicePixelRatio);
      const h = (c.height = c.clientHeight * devicePixelRatio);
      const data = audio.getChannelData(0);
      const step = Math.max(1, Math.floor(data.length / w));
      const g = c.getContext("2d")!;
      g.fillStyle = getComputedStyle(c).color;
      for (let x = 0; x < w; x++) {
        let peak = 0;
        for (let i = x * step; i < (x + 1) * step && i < data.length; i += 8) peak = Math.max(peak, Math.abs(data[i]));
        const bar = Math.max(1, peak * h);
        g.fillRect(x, (h - bar) / 2, 1, bar);
      }
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [url]);
  return <canvas ref={canvas} className="ws-wave" />;
}

function SyncedAudio({ session, track }: { session: Session; track: TrackState }) {
  const el = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (el.current) el.current.volume = track.muted ? 0 : Math.max(0, Math.min(1, track.gain));
  }, [track.gain, track.muted]);
  useEffect(() => {
    const main = session.mediaEl;
    const a = el.current;
    if (!main || !a) return;
    const sync = () => {
      if (Math.abs(a.currentTime - main.currentTime) > 0.25) a.currentTime = main.currentTime;
    };
    const play = () => {
      sync();
      void a.play().catch(() => undefined);
    };
    const pause = () => a.pause();
    main.addEventListener("play", play);
    main.addEventListener("pause", pause);
    main.addEventListener("seeked", sync);
    main.addEventListener("timeupdate", sync);
    return () => {
      main.removeEventListener("play", play);
      main.removeEventListener("pause", pause);
      main.removeEventListener("seeked", sync);
      main.removeEventListener("timeupdate", sync);
    };
  });
  return <audio ref={el} src={session.client.assetUrl(track.source.asset_id)} preload="auto" />;
}

export function Timeline({ session }: { session: Session }) {
  const tracks = useSession(session, (s) => s.tracks);
  const current = useSession(session, (s) => s.current);
  const mainGain = useSession(session, (s) => s.mainGain);
  const mainMuted = useSession(session, (s) => s.mainMuted);
  const setTrack = (id: string, patch: Partial<TrackState>) =>
    session.set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));

  return (
    <div className="ws-timeline">
      {current && (current.format === "video" || current.format === "audio") && (
        <div className="ws-track">
          <div className="ws-track-head">
            <b>Đang phát</b>
            <span className="ws-dim">{current.filename}</span>
          </div>
          <div className="ws-track-ctl">
            <input type="range" min={0} max={1} step={0.05} value={mainMuted ? 0 : mainGain}
              onChange={(e) => session.set({ mainGain: Number(e.target.value), mainMuted: false })} />
            <Button small onClick={() => session.set({ mainMuted: !mainMuted })}>{mainMuted ? "Bật tiếng" : "Tắt tiếng"}</Button>
          </div>
        </div>
      )}
      {tracks.map((t) => (
        <div className="ws-track" key={t.id}>
          <div className="ws-track-head">
            <b>{t.label ?? t.id}</b>
            <Badge>{t.source.format}</Badge>
          </div>
          <div className="ws-track-body" onClick={() => session.set({ current: t.source })} title="Bấm để xem/nghe riêng">
            {t.source.format === "audio" ? <Waveform url={session.client.assetUrl(t.source.asset_id)} /> : <span className="ws-dim">{t.source.filename}</span>}
          </div>
          <div className="ws-track-ctl">
            <input type="range" min={0} max={1} step={0.05} value={t.muted ? 0 : t.gain} onChange={(e) => setTrack(t.id, { gain: Number(e.target.value), muted: false })} />
            <Button small onClick={() => setTrack(t.id, { muted: !t.muted })}>{t.muted ? "Bật" : "Tắt"}</Button>
          </div>
          {t.source.format === "audio" && <SyncedAudio session={session} track={t} />}
        </div>
      ))}
      {!tracks.length && <div className="ws-dim ws-pad">Timeline trống. Mini app đưa track lên bằng ws.timeline.addTrack().</div>}
    </div>
  );
}

// ---------------------------------------------------------------- asset bin
export function AssetBin({ session }: { session: Session }) {
  const assets = useSession(session, (s) => s.assets);
  const current = useSession(session, (s) => s.current);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="ws-bin">
      <div className="ws-bin-head">
        <b>File</b>
        <Button small disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Đang tải…" : "+ Thêm"}</Button>
        <input ref={fileRef} type="file" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          try {
            const ref = await session.upload(f);
            session.set({ current: ref });
          } catch (err) {
            session.toast(`Tải lên lỗi: ${(err as Error).message}`, "danger");
          } finally {
            setBusy(false);
          }
        }} />
      </div>
      {assets.map((a) => (
        <button key={a.ref.asset_id} className={`ws-asset ${current?.asset_id === a.ref.asset_id ? "on" : ""}`}
          onClick={() => session.set({ current: a.ref })} title={a.ref.filename}>
          <span className="ws-asset-name">{a.label}</span>
          <span className="ws-asset-meta"><Badge kind={a.source === "output" ? "accent" : undefined}>{a.ref.format}</Badge> {fmtBytes(a.ref.size_bytes)}</span>
        </button>
      ))}
      {!assets.length && <div className="ws-dim ws-pad">Chưa có file</div>}
    </div>
  );
}

// ---------------------------------------------------------------- job bar
export function JobBar({ session }: { session: Session }) {
  const jobs = useSession(session, (s) => s.jobs);
  const [open, setOpen] = useState<string | null>(null);
  if (!jobs.length) return <div className="ws-jobbar ws-dim ws-pad">Chưa có bước nào chạy</div>;
  return (
    <div className="ws-jobbar">
      {jobs.slice(0, 8).map((j) => {
        const kind = j.status === "succeeded" ? "ok" : j.status === "failed" || j.status === "cancelled" ? "danger" : undefined;
        return (
          <div key={j.id} className="ws-job">
            <div className="ws-job-row">
              <b>{j.label}</b>
              <Badge kind={kind === "ok" ? "ok" : kind === "danger" ? "danger" : "accent"}>{j.status}</Badge>
              <span className="ws-dim ws-grow">{j.error ?? j.summary ?? j.message}</span>
              {(j.status === "running" || j.status === "queued") && <Button small danger onClick={() => session.cancel(j.id)}>Hủy</Button>}
              <Button small onClick={() => setOpen(open === j.id ? null : j.id)}>Log</Button>
            </div>
            <ProgressBar value={j.progress} kind={kind} />
            {open === j.id && <pre className="ws-log">{j.logs.join("\n") || "(chưa có log)"}</pre>}
          </div>
        );
      })}
    </div>
  );
}

export function Toasts({ session }: { session: Session }) {
  const toasts = useSession(session, (s) => s.toasts);
  return (
    <div className="ws-toasts">
      {toasts.map((t) => <div key={t.id} className={`mt-notice ${t.kind ?? ""}`}>{t.message}</div>)}
    </div>
  );
}

export function describeRef(a: AssetRef | null | undefined) {
  return a ? `${a.filename ?? a.asset_id} (${a.format})` : "—";
}

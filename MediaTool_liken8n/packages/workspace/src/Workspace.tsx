// Workspace = khung giao diện chung (core UI). Mini app chỉ cắm component vào các slot.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Notice } from "@mediatool/ui";
import type { MediaToolClient, ToolDetail } from "@mediatool/api-client";
import { __setStrings, t, type MiniAppDefinition, type MiniAppManifest } from "@mediatool/miniapp-sdk";
import { AutoPanel } from "./AutoPanel";
import { AssetBin, JobBar, SlotBoundary, Timeline, Toasts, Viewer } from "./parts";
import { createWs, Session, useSession } from "./session";
import "./workspace.css";

export interface WorkspaceProps {
  client: MediaToolClient;
  /** Chế độ mini app */
  manifest?: MiniAppManifest | null;
  app?: MiniAppDefinition | null;
  strings?: Record<string, string>;
  /** Chế độ một tool: panel tự sinh từ schema */
  tool?: ToolDetail | null;
  onExit?: () => void;
}

function InputGate({ session, manifest }: { session: Session; manifest: MiniAppManifest }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fmts = manifest.accepts.map((a) => a.format);
  const accept = fmts.map((f) => (f === "video" ? "video/*" : f === "audio" ? "audio/*" : f === "image" ? "image/*" : "")).filter(Boolean).join(",");
  const choose = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      await session.setInput(f);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ws-gate"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void choose(e.dataTransfer.files[0]);
      }}>
      <h2>{manifest.title}</h2>
      <p className="ws-dim">{manifest.description}</p>
      <Button primary disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Đang tải lên…" : `Chọn file (${fmts.join(", ")})`}</Button>
      <p className="ws-dim">hoặc kéo thả file vào đây</p>
      <input ref={fileRef} type="file" hidden accept={accept} onChange={(e) => void choose(e.target.files?.[0])} />
      {err && <Notice kind="danger">{err}</Notice>}
    </div>
  );
}

export function Workspace({ client, manifest, app, strings, tool, onExit }: WorkspaceProps) {
  const session = useMemo(
    () => new Session(client, manifest ? manifest.tools : null),
    // phiên mới khi đổi mini app / tool
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, manifest?.name, tool?.id],
  );
  const ws = useMemo(() => createWs(session, manifest ?? null), [session, manifest]);
  const input = useSession(session, (s) => s.input);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    __setStrings(strings ?? {});
  }, [strings]);

  useEffect(() => {
    if (!app || !input || ready) return;
    setReady(true);
    Promise.resolve(app.setup?.(ws)).catch((e) => setSetupError((e as Error).message));
  }, [app, input, ready, ws]);

  const title = manifest?.title ?? tool?.name ?? "Workspace";
  const Panel = app?.panel;
  const Overlay = app?.overlay;
  const needsInput = !!manifest && !!app && !input;

  return (
    <div className="ws-root">
      <header className="ws-top">
        {onExit && <Button small onClick={onExit}>← Quay lại</Button>}
        <b>{title}</b>
        <span className="ws-dim">{input ? input.filename : ""}</span>
        <span className="ws-grow" />
        <SlotBoundary name="toolbar">
          {app?.toolbar?.map((a) => (
            <Button key={a.id} small onClick={() => Promise.resolve(a.run(ws)).catch((e) => session.toast((e as Error).message, "danger"))}>
              {t(a.label)}
            </Button>
          ))}
        </SlotBoundary>
      </header>

      {needsInput ? (
        <InputGate session={session} manifest={manifest!} />
      ) : (
        <div className="ws-grid">
          <aside className="ws-left"><AssetBin session={session} /></aside>
          <main className="ws-center">
            <div className="ws-stage">
              <Viewer session={session} />
              {Overlay && (
                <div className="ws-overlay">
                  <SlotBoundary name="overlay"><Overlay ws={ws} /></SlotBoundary>
                </div>
              )}
            </div>
            <Timeline session={session} />
          </main>
          <aside className="ws-right">
            {setupError && <Notice kind="danger">Khởi tạo mini app lỗi: {setupError}</Notice>}
            {Panel ? (
              <SlotBoundary name="panel"><Panel ws={ws} /></SlotBoundary>
            ) : tool ? (
              <AutoPanel session={session} tool={tool} />
            ) : (
              <div className="ws-dim ws-pad">Không có panel</div>
            )}
          </aside>
        </div>
      )}
      <footer className="ws-bottom"><JobBar session={session} /></footer>
      <Toasts session={session} />
    </div>
  );
}

// Sandbox: kiểm thử dùng chung. Tự liệt kê tool và mini app; không có code riêng cho tool nào.
import { useCallback, useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { Badge, Button, Notice } from "@mediatool/ui";
import { MediaToolClient, type Job, type ToolDetail, type ToolSummary, type MiniAppEntry } from "@mediatool/api-client";
import type { MiniAppDefinition } from "@mediatool/miniapp-sdk";
import { Workspace } from "@mediatool/workspace";
import { localMiniApps, type LocalMiniApp } from "./miniapps";
import { TestBench } from "./TestBench";
import { ChainEditor } from "./ChainEditor";
import { Editor } from "@mediatool/editor";

type Tab = "editor" | "tools" | "bench" | "chain" | "miniapps" | "jobs";

const TAB_LABEL: Record<Tab, string> = {
  editor: "Editor",
  tools: "Tools",
  bench: "Kiểm thử",
  chain: "Chuỗi tool",
  miniapps: "Mini apps",
  jobs: "Jobs",
};

const client = new MediaToolClient({ baseUrl: "" }); // Vite proxy /v1 → core

function StatusBadge({ status }: { status: ToolSummary["status"] }) {
  return status.state === "available" ? <Badge kind="ok">sẵn sàng</Badge> : <Badge kind="danger">không dùng được</Badge>;
}

// ------------------------------------------------------------------ Tools
function ToolDetailView({ id, onRun }: { id: string; onRun: (t: ToolDetail) => void }) {
  const [tool, setTool] = useState<ToolDetail | null>(null);
  const [docs, setDocs] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setTool(null);
    setDocs("");
    client.getTool(id).then(setTool).catch((e) => setErr(String(e.message ?? e)));
    client.toolDocs(id).then((md) => setDocs(marked.parse(md) as string)).catch(() => setDocs("<p><i>Tool chưa có README.md</i></p>"));
  }, [id]);
  if (err) return <Notice kind="danger">{err}</Notice>;
  if (!tool) return <div className="sb-dim">Đang tải…</div>;
  return (
    <div className="sb-detail">
      <div className="sb-detail-head">
        <div>
          <h2>{tool.name} <code>{tool.id}</code></h2>
          <div className="sb-dim">{tool.summary}</div>
          <div className="sb-row">
            <StatusBadge status={tool.status} />
            <Badge>v{tool.version}</Badge>
            <Badge>{tool.tool_status}</Badge>
            {tool.runtime && <Badge>RAM {tool.runtime.ram_mb} MB</Badge>}
            {tool.runtime?.heavy && <Badge kind="warn">heavy</Badge>}
          </div>
        </div>
        <Button primary disabled={tool.status.state !== "available"} onClick={() => onRun(tool)}>Chạy thử trong workspace →</Button>
      </div>
      {tool.status.state === "unavailable" && <Notice kind="danger">{tool.status.reason}</Notice>}
      <article className="sb-docs" dangerouslySetInnerHTML={{ __html: docs }} />
    </div>
  );
}

function ToolsTab({ onRun }: { onRun: (t: ToolDetail) => void }) {
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    client.listTools().then((t) => {
      setTools(t);
      setErr(null);
      setSelected((s) => s ?? t[0]?.id ?? null);
    }).catch((e) => setErr(`Không kết nối được core: ${e.message}`));
  }, []);
  useEffect(load, [load]);
  const groups = useMemo(() => {
    const m = new Map<string, ToolSummary[]>();
    tools
      .filter((t) => !q || (t.id + t.name + t.summary).toLowerCase().includes(q.toLowerCase()))
      .forEach((t) => m.set(t.category, [...(m.get(t.category) ?? []), t]));
    return [...m.entries()];
  }, [tools, q]);
  return (
    <div className="sb-split">
      <nav className="sb-list">
        <div className="sb-row">
          <input className="mt-input" placeholder="Tìm tool…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button small onClick={async () => { await client.reloadRegistry(); load(); }} title="Quét lại thư mục tools/">↻</Button>
        </div>
        {err && <Notice kind="danger">{err}</Notice>}
        {groups.map(([cat, items]) => (
          <div key={cat}>
            <div className="sb-cat">{cat}</div>
            {items.map((t) => (
              <button key={t.id} className={`sb-item ${selected === t.id ? "on" : ""}`} onClick={() => setSelected(t.id)}>
                <span>{t.name}</span>
                <span className="sb-row"><code>{t.id}</code><StatusBadge status={t.status} /></span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <section className="sb-main">{selected ? <ToolDetailView id={selected} onRun={onRun} /> : <div className="sb-dim">Chọn một tool</div>}</section>
    </div>
  );
}

// ------------------------------------------------------------------ Mini apps
function MiniAppsTab({ onOpen }: { onOpen: (m: LocalMiniApp) => void }) {
  const [remote, setRemote] = useState<MiniAppEntry[]>([]);
  useEffect(() => {
    client.listMiniApps().then(setRemote).catch(() => setRemote([]));
  }, []);
  return (
    <div className="sb-cards">
      {localMiniApps.map((m) => {
        const r = remote.find((x) => x.name === m.name);
        return (
          <div key={m.name} className="sb-card">
            <h3>{m.manifest.title}</h3>
            <div className="sb-dim">{m.manifest.description}</div>
            <div className="sb-row">
              <Badge>{m.manifest.category}</Badge>
              {r ? (r.status.state === "available" ? <Badge kind="ok">đủ tool</Badge> : <Badge kind="danger">{r.status.reason}</Badge>) : <Badge kind="warn">core chưa thấy</Badge>}
            </div>
            <div className="sb-dim">Tool: {m.manifest.tools.join(", ")}</div>
            <Button primary onClick={() => onOpen(m)}>Mở</Button>
          </div>
        );
      })}
      {!localMiniApps.length && <div className="sb-dim">Chưa có mini app trong thư mục miniapps/</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Jobs
function JobsTab() {
  const [jobs, setJobs] = useState<Job[]>([]);
  useEffect(() => {
    const load = () => client.listJobs().then(setJobs).catch(() => undefined);
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);
  return (
    <table className="sb-table">
      <thead><tr><th>Job</th><th>Tool</th><th>Trạng thái</th><th>Kết quả</th><th>RAM đỉnh</th><th>Tạo lúc</th></tr></thead>
      <tbody>
        {jobs.map((j) => (
          <tr key={j.id}>
            <td><code>{j.id}</code></td>
            <td>{j.tool_id}</td>
            <td><Badge kind={j.status === "succeeded" ? "ok" : j.status === "failed" ? "danger" : "accent"}>{j.status}</Badge></td>
            <td>{j.result?.summary ?? j.error?.message ?? j.message}</td>
            <td>{j.result?.peak_ram_mb != null ? `${j.result.peak_ram_mb} MB` : ""}</td>
            <td className="sb-dim">{new Date(j.created_at).toLocaleString("vi-VN")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------------ App
export function App() {
  const [tab, setTab] = useState<Tab>("tools");
  const [health, setHealth] = useState<string>("đang kết nối…");
  const [runTool, setRunTool] = useState<ToolDetail | null>(null);
  const [openApp, setOpenApp] = useState<{ meta: LocalMiniApp; def: MiniAppDefinition } | null>(null);
  const [openErr, setOpenErr] = useState<string | null>(null);

  useEffect(() => {
    client.health().then((h) => setHealth(`core v${h.version}`)).catch(() => setHealth("không kết nối được core"));
  }, []);

  if (runTool) return <Workspace client={client} tool={runTool} onExit={() => setRunTool(null)} />;
  if (openApp)
    return <Workspace client={client} manifest={openApp.meta.manifest} app={openApp.def} strings={openApp.meta.strings} onExit={() => setOpenApp(null)} />;

  return (
    <div className="sb-root">
      <header className="sb-top">
        <b>MediaTool Sandbox</b>
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button key={t} className={`sb-tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
        <span className="sb-grow" />
        <span className="sb-dim">{health}</span>
      </header>
      {openErr && <Notice kind="danger">{openErr}</Notice>}
      <div className="sb-body">
        {tab === "tools" && <ToolsTab onRun={setRunTool} />}
        {tab === "miniapps" && (
          <MiniAppsTab onOpen={async (m) => {
            try {
              setOpenErr(null);
              setOpenApp({ meta: m, def: await m.load() });
            } catch (e) {
              setOpenErr(`Không nạp được mini app ${m.name}: ${(e as Error).message}`);
            }
          }} />
        )}
        {tab === "jobs" && <JobsTab />}
        {tab === "bench" && <TestBench client={client} />}
        {tab === "editor" && <Editor client={client} />}
        {tab === "chain" && <ChainEditor client={client} />}
      </div>
    </div>
  );
}

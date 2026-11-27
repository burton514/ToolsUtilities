// Khung ứng dụng MediaTool: thanh bên + các trang. Không có code riêng cho tool nào (mọi thứ đọc từ registry).
import { useCallback, useEffect, useState } from "react";
import { marked } from "marked";
import {
  BookOpen, Clapperboard, FlaskConical, HeartPulse, History as HistoryIcon, House, LayoutGrid, Moon, PanelLeftClose, PanelLeftOpen, Sun, Wrench, Workflow,
} from "lucide-react";
import { Badge, Button, Card, EmptyState, Notice, PageHeader } from "@mediatool/ui";
import { MediaToolClient, type MiniAppEntry, type ToolDetail, type ToolSummary } from "@mediatool/api-client";
import type { MiniAppDefinition } from "@mediatool/miniapp-sdk";
import { Workspace } from "@mediatool/workspace";
import { Editor } from "@mediatool/editor";
import { localMiniApps, type LocalMiniApp } from "./miniapps";
import { TestBench } from "./TestBench";
import { ChainEditor } from "./ChainEditor";
import { ChainNav } from "./ChainNav";
import { Home } from "./pages/Home";
import { Catalog } from "./pages/Catalog";
import { ToolRunner } from "./pages/ToolRunner";
import { History } from "./pages/History";
import { Health } from "./pages/Health";
import { categoryOf } from "./meta";

export type Route =
  | { page: "home" } | { page: "editor" } | { page: "tools" } | { page: "tool"; id: string } | { page: "chain" }
  | { page: "apps" } | { page: "history" } | { page: "health" } | { page: "bench" } | { page: "devdocs" };

const client = new MediaToolClient({ baseUrl: "" }); // Vite proxy /v1 → core

const NAV: { page: Route["page"]; label: string; icon: JSX.Element; dev?: boolean }[] = [
  { page: "home", label: "Trang chủ", icon: <House size={18} /> },
  { page: "editor", label: "Dựng video", icon: <Clapperboard size={18} /> },
  { page: "tools", label: "Công cụ", icon: <Wrench size={18} /> },
  { page: "chain", label: "Quy trình tự động", icon: <Workflow size={18} /> },
  { page: "apps", label: "Ứng dụng", icon: <LayoutGrid size={18} /> },
  { page: "history", label: "Lịch sử xử lý", icon: <HistoryIcon size={18} /> },
  { page: "health", label: "Sức khỏe hệ thống", icon: <HeartPulse size={18} /> },
  { page: "bench", label: "Kiểm thử tự động", icon: <FlaskConical size={18} />, dev: true },
  { page: "devdocs", label: "Tài liệu kỹ thuật", icon: <BookOpen size={18} />, dev: true },
];

function readRoute(): Route {
  const [page, id] = location.hash.replace(/^#\/?/, "").split("/");
  if (page === "tool" && id) return { page: "tool", id };
  return (NAV.some((n) => n.page === page) ? { page } : { page: "home" }) as Route;
}

// ------------------------------------------------------------------ ứng dụng nhỏ
function AppsPage({ onOpen }: { onOpen: (m: LocalMiniApp) => void }) {
  const [remote, setRemote] = useState<MiniAppEntry[]>([]);
  useEffect(() => {
    client.listMiniApps().then(setRemote).catch(() => setRemote([]));
  }, []);
  return (
    <div className="sb-page">
      <PageHeader title="Ứng dụng" description="Các tính năng trọn gói: chọn file một lần, ứng dụng tự chạy các công cụ cần thiết." />
      <div className="cat-grid">
        {localMiniApps.map((m) => {
          const r = remote.find((x) => x.name === m.name);
          const ok = !r || r.status.state === "available";
          return (
            <Card key={m.name} className="cat-card" onClick={ok ? () => onOpen(m) : undefined}>
              <div className="cat-card-head">
                <div className="cat-icon">{categoryOf(m.manifest.category).icon(20)}</div>
                {!ok && <Badge kind="danger">Thiếu công cụ</Badge>}
              </div>
              <h3 className="mt-h3">{m.manifest.title}</h3>
              <p className="mt-dim">{m.manifest.description}</p>
            </Card>
          );
        })}
      </div>
      {!localMiniApps.length && <EmptyState title="Chưa có ứng dụng nào" />}
    </div>
  );
}

// ------------------------------------------------------------------ tài liệu kỹ thuật (cho nhà phát triển)
function DevDocs({ onWorkspace }: { onWorkspace: (t: ToolDetail) => void }) {
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolDetail | null>(null);
  const [docs, setDocs] = useState("");
  const load = useCallback(() => client.listTools().then((t) => { setTools(t); setSel((s) => s ?? t[0]?.id ?? null); }).catch(() => undefined), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!sel) return;
    client.getTool(sel).then(setTool).catch(() => setTool(null));
    client.toolDocs(sel).then((md) => setDocs(marked.parse(md) as string)).catch(() => setDocs(""));
  }, [sel]);
  return (
    <div className="dev-split">
      <nav className="dev-list">
        <div className="dev-list-head">
          <b>Tool trong registry</b>
          <Button small ghost onClick={async () => { await client.reloadRegistry(); void load(); }}>Quét lại</Button>
        </div>
        {tools.map((t) => (
          <button key={t.id} className={`dev-item ${sel === t.id ? "on" : ""}`} onClick={() => setSel(t.id)}>
            <span>{t.name}</span>
            <code>{t.id}</code>
            {t.status.state !== "available" && <Badge kind="danger">lỗi</Badge>}
          </button>
        ))}
      </nav>
      <section className="dev-main">
        {tool && (
          <>
            <div className="dev-head">
              <div>
                <h1 className="mt-h1">{tool.name}</h1>
                <div className="dev-badges">
                  <code>{tool.id}</code><Badge>v{tool.version}</Badge><Badge>{tool.tool_status}</Badge>
                  {tool.runtime && <Badge>RAM {tool.runtime.ram_mb} MB</Badge>}
                  {tool.runtime?.heavy && <Badge kind="warn">heavy</Badge>}
                </div>
              </div>
              <Button onClick={() => onWorkspace(tool)} disabled={tool.status.state !== "available"}>Mở trong workspace</Button>
            </div>
            {tool.status.state === "unavailable" && <Notice kind="danger">{tool.status.reason}</Notice>}
            <article className="sb-docs" dangerouslySetInnerHTML={{ __html: docs }} />
          </>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ khung
export function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [online, setOnline] = useState<boolean | null>(null);
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 1100);
  const [theme, setTheme] = useState<"dark" | "light">(() => (localStorage.getItem("mediatool.theme") as "light") ?? "dark");
  const [workspaceTool, setWorkspaceTool] = useState<ToolDetail | null>(null);
  const [openApp, setOpenApp] = useState<{ meta: LocalMiniApp; def: MiniAppDefinition } | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("mediatool.theme", theme); } catch { /* bỏ qua */ }
  }, [theme]);
  useEffect(() => {
    const ping = () => client.health().then(() => setOnline(true)).catch(() => setOnline(false));
    ping();
    const t = setInterval(ping, 10000);
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => { clearInterval(t); window.removeEventListener("hashchange", onHash); };
  }, []);

  const go = useCallback((r: Route) => {
    location.hash = r.page === "tool" ? `/tool/${r.id}` : `/${r.page}`;
    setRoute(r);
  }, []);
  const active = route.page === "tool" ? "tools" : route.page;
  // trình nối chuỗi giữ nguyên khi sang trang khác (chuỗi đang chạy vẫn chạy, quay lại thấy đúng chỗ cũ)
  const [chainMounted, setChainMounted] = useState(route.page === "chain");
  useEffect(() => {
    if (route.page === "chain") setChainMounted(true);
  }, [route.page]);

  if (workspaceTool) return <Workspace client={client} tool={workspaceTool} onExit={() => setWorkspaceTool(null)} />;
  if (openApp) return <Workspace client={client} manifest={openApp.meta.manifest} app={openApp.def} strings={openApp.meta.strings} onExit={() => setOpenApp(null)} />;

  return (
    <div className={`shell ${collapsed ? "collapsed" : ""}`}>
      <aside className="side">
        <div className="side-brand">
          <div className="side-logo"><Clapperboard size={18} /></div>
          {!collapsed && <span>MediaTool</span>}
          <button className="mt-iconbtn small side-collapse" aria-label={collapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"} title={collapsed ? "Mở rộng" : "Thu gọn"} onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        <nav className="side-nav">
          {NAV.filter((n) => !n.dev).map((n) => (
            <div key={n.page} className="side-entry">
              <button className={`side-item ${active === n.page ? "on" : ""}`} onClick={() => go({ page: n.page } as Route)} title={collapsed ? n.label : undefined} aria-current={active === n.page ? "page" : undefined}>
                {n.icon}{!collapsed && <span>{n.label}</span>}
              </button>
              {/* chuỗi = dự án: danh sách nằm ngay dưới mục Quy trình tự động */}
              {n.page === "chain" && !collapsed && <ChainNav client={client} onShow={() => go({ page: "chain" })} />}
            </div>
          ))}
          <div className="side-sep">{!collapsed && "Nhà phát triển"}</div>
          {NAV.filter((n) => n.dev).map((n) => (
            <button key={n.page} className={`side-item ${active === n.page ? "on" : ""}`} onClick={() => go({ page: n.page } as Route)} title={collapsed ? n.label : undefined}>
              {n.icon}{!collapsed && <span>{n.label}</span>}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <span className={`side-status ${online ? "on" : online === false ? "off" : ""}`} title={online ? "Máy chủ đang chạy" : "Không kết nối được máy chủ"}>
            <i />{!collapsed && (online ? "Máy chủ đang chạy" : online === false ? "Mất kết nối máy chủ" : "Đang kết nối…")}
          </span>
          <button className="mt-iconbtn small" aria-label="Đổi giao diện sáng/tối" title="Đổi giao diện sáng/tối" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </aside>

      <main className={`main ${route.page === "editor" || route.page === "chain" || route.page === "devdocs" ? "full" : ""}`}>
        {online === false && route.page !== "editor" && (
          <div className="main-banner"><Notice kind="danger">Không kết nối được máy chủ MediaTool. Hãy chạy <code>docker compose up -d core</code> rồi tải lại trang.</Notice></div>
        )}
        {route.page === "home" && <Home client={client} go={go} />}
        {route.page === "editor" && <Editor client={client} />}
        {route.page === "tools" && <Catalog client={client} go={go} />}
        {route.page === "tool" && <ToolRunner key={route.id} client={client} toolId={route.id} onBack={() => go({ page: "tools" })} />}
        {chainMounted && <div className="chain-host" hidden={route.page !== "chain"}><ChainEditor client={client} /></div>}
        {route.page === "apps" && <AppsPage onOpen={async (m) => setOpenApp({ meta: m, def: await m.load() })} />}
        {route.page === "history" && <History client={client} />}
        {route.page === "health" && <Health client={client} />}
        {route.page === "bench" && <div className="sb-page wide"><PageHeader title="Kiểm thử tự động" description="Chạy tất cả ví dụ của mọi công cụ, đo thời gian và RAM, so với khai báo." /><TestBench client={client} /></div>}
        {route.page === "devdocs" && <DevDocs onWorkspace={setWorkspaceTool} />}
      </main>
    </div>
  );
}

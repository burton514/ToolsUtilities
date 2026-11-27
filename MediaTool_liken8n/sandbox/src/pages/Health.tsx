// Sức khỏe hệ thống: core, môi trường chạy tool (Python, thư viện, FFmpeg, ONNX Runtime / GPU, RAM, ổ đĩa) và từng tool
// (dùng được chưa, vì sao, model đã tải chưa). Mọi dữ liệu lấy từ core (/v1/health/details) — không có danh sách tool viết cứng.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Cpu, Database, Download, Gauge, HardDrive, Layers, MemoryStick, MinusCircle, RefreshCw, Server,
  Sparkles, Terminal, XCircle, Zap,
} from "lucide-react";
import { Badge, Button, Notice, PageHeader } from "@mediatool/ui";
import type { HealthDetails, HealthTool, MediaToolClient } from "@mediatool/api-client";
import { categoryOf, SourceLine } from "../meta";

type Level = "ok" | "warn" | "danger" | "info";
const ICON: Record<Level, JSX.Element> = {
  ok: <CheckCircle2 size={18} />, warn: <AlertTriangle size={18} />, danger: <XCircle size={18} />, info: <MinusCircle size={18} />,
};
const gb = (mb?: number | null) => (mb == null ? "?" : mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

interface Row { key: string; icon: JSX.Element; title: string; level: Level; value: string; detail?: React.ReactNode }

function CheckRow({ r }: { r: Row }) {
  return (
    <li className={`hl-row ${r.level}`}>
      <span className="hl-row-icon" aria-hidden="true">{r.icon}</span>
      <span className="hl-row-main">
        <span className="hl-row-title">{r.title}</span>
        {r.detail && <span className="hl-row-detail">{r.detail}</span>}
      </span>
      <span className="hl-row-value">{r.value}</span>
      <span className={`hl-state ${r.level}`} aria-label={{ ok: "ổn", warn: "cần chú ý", danger: "lỗi", info: "thông tin" }[r.level]}>{ICON[r.level]}</span>
    </li>
  );
}

type ToolFilter = "all" | "problem" | "models" | "gpu";

export function Health({ client }: { client: MediaToolClient }) {
  const [data, setData] = useState<HealthDetails | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [filter, setFilter] = useState<ToolFilter>("all");

  const check = useCallback(async (rescan: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const t0 = performance.now();
      await client.health();
      setLatency(Math.round(performance.now() - t0));
      if (rescan) await client.reloadRegistry(); // quét lại tool: chạy lại check() môi trường của từng tool
      setData(await client.healthDetails());
      setCheckedAt(new Date());
    } catch (e) {
      setData(null);
      setLatency(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [client]);
  useEffect(() => {
    void check(false);
  }, [check]);

  const env = data?.environment;
  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const out: Row[] = [];
    const j = data.core.jobs;
    out.push({ key: "core", icon: <Server size={18} />, title: "Core API", level: "ok", value: `v${data.core.version}`,
      detail: `Trả lời sau ${latency ?? "?"} ms · giao thức ${data.core.protocol} · thiết bị cho tool hỗ trợ GPU: ${data.core.device === "cuda" ? "GPU (CUDA)" : "CPU"}` });
    out.push(env?.error
      ? { key: "py", icon: <Terminal size={18} />, title: "Worker Python", level: "danger", value: "Lỗi", detail: env.error }
      : { key: "py", icon: <Terminal size={18} />, title: "Worker Python", level: "ok", value: `Python ${env?.python ?? "?"}`,
        detail: `SDK ${env?.sdk ?? "?"} · tự kiểm trong ${(data.worker_ms / 1000).toFixed(1)} s` });
    const ff = env?.ffmpeg;
    if (ff) {
      const missing = Object.entries(ff.features ?? {}).filter(([, v]) => !v).map(([k]) => k);
      out.push({ key: "ffmpeg", icon: <Layers size={18} />, title: "FFmpeg", level: !ff.ok ? "danger" : missing.length ? "warn" : "ok",
        value: ff.ok ? ff.version ?? "có" : "Không có",
        detail: ff.ok ? (
          <span className="hl-chips">
            {Object.entries(ff.features ?? {}).map(([k, v]) => <span key={k} className={`hl-chip ${v ? "ok" : "warn"}`}>{v ? "✓" : "✗"} {k}</span>)}
          </span>
        ) : "Thiếu FFmpeg — hầu hết tool không chạy được" });
    }
    const g = env?.gpu;
    if (g) {
      const ort = g.onnxruntime;
      out.push({ key: "ort", icon: <Cpu size={18} />, title: "ONNX Runtime", level: ort ? "ok" : "danger", value: ort ? `v${ort.version}` : "Không có",
        detail: ort ? `Thiết bị chạy model: ${ort.providers.map((p) => p.replace("ExecutionProvider", "")).join(", ")}` : g.note ?? g.error });
      const card = g.nvidia[0];
      const wantGpu = data.core.device === "cuda";
      out.push({ key: "gpu", icon: <Zap size={18} />, title: "GPU (CUDA)",
        level: g.cuda_usable ? (wantGpu ? "ok" : "info") : wantGpu || card ? "warn" : "info",
        value: g.cuda_usable ? (wantGpu ? "Đang dùng" : "Dùng được — core đang đặt CPU") : card ? "Chưa dùng được" : "Không có — chạy CPU",
        detail: card ? `${card.name} · ${gb(card.memory_total_mb)} VRAM (đang dùng ${gb(card.memory_used_mb)}) · driver ${card.driver}${g.note ? ` — ${g.note}` : ""}` : g.note });
    }
    const sys = env?.system;
    if (sys) {
      const ramLow = sys.ram_available_mb != null && sys.ram_available_mb < 2048;
      out.push({ key: "cpu", icon: <Gauge size={18} />, title: "CPU", level: "ok", value: `${sys.cpu_count ?? "?"} luồng`,
        detail: `${sys.cpu ?? sys.os ?? ""}${sys.avx512 ? " · AVX-512" : ""}` });
      out.push({ key: "ram", icon: <MemoryStick size={18} />, title: "RAM", level: ramLow ? "warn" : "ok",
        value: `${gb(sys.ram_available_mb)} trống / ${gb(sys.ram_total_mb)}`,
        detail: `Ngân sách cho job: ${gb(j.ram_budget_mb)} (đang dùng ${gb(j.used_ram_mb)})${ramLow ? " — RAM trống thấp, tool nặng có thể chậm / dừng" : ""}` });
      if (sys.disk) {
        const low = sys.disk.free_mb < 5 * 1024;
        out.push({ key: "disk", icon: <HardDrive size={18} />, title: "Ổ đĩa dữ liệu", level: low ? "warn" : "ok",
          value: `${gb(sys.disk.free_mb)} trống`, detail: `${sys.disk.path} · tổng ${gb(sys.disk.total_mb)}${low ? " — còn ít chỗ cho model và file kết quả" : ""}` });
      }
    }
    out.push({ key: "jobs", icon: <Database size={18} />, title: "Hàng đợi xử lý", level: "ok", value: `${j.running} đang chạy · ${j.queued} chờ` });
    return out;
  }, [data, env, latency]);

  const tools = data?.tools ?? [];
  const bad = tools.filter((t) => t.status.state !== "available");
  const allModels = tools.flatMap((t) => t.models);
  const uniqModels = [...new Map(allModels.map((m) => [m.id, m])).values()];
  const pendingModels = uniqModels.filter((m) => !m.ready);
  const pendingMb = pendingModels.reduce((s, m) => s + (m.size_mb || 0), 0);
  const problems = rows.filter((r) => r.level === "danger").length + bad.length;
  const warns = rows.filter((r) => r.level === "warn").length;

  const shownTools = useMemo(() => {
    const f = (t: HealthTool) =>
      filter === "problem" ? t.status.state !== "available"
      : filter === "models" ? t.models.some((m) => !m.ready)
      : filter === "gpu" ? t.gpu === "optional" || t.gpu === "required" : true;
    return tools.filter(f).sort((a, b) =>
      Number(a.status.state === "available") - Number(b.status.state === "available")
      || categoryOf(a.category).order - categoryOf(b.category).order || a.name.localeCompare(b.name, "vi"));
  }, [tools, filter]);

  return (
    <div className="sb-page">
      <PageHeader title="Sức khỏe hệ thống" description="Kiểm tra core, môi trường chạy tool và từng tool đã sẵn sàng dùng chưa."
        actions={<>
          {checkedAt && <span className="sb-dim">Kiểm lúc {checkedAt.toLocaleTimeString("vi-VN")}</span>}
          <Button icon={<RefreshCw size={15} />} loading={busy} onClick={() => check(true)}>Kiểm tra lại</Button>
        </>} />

      {error && (
        <Notice kind="danger">
          Không kết nối được core ({error}). Kiểm tra Docker Desktop đã bật và container core đang chạy
          (<code>docker compose up -d core</code>), rồi bấm Kiểm tra lại.
        </Notice>
      )}

      {data && (
        <>
          <div className={`hl-summary ${problems ? "danger" : warns ? "warn" : "ok"}`} role="status">
            <span className="hl-summary-icon">{problems ? <XCircle size={28} /> : warns ? <AlertTriangle size={28} /> : <CheckCircle2 size={28} />}</span>
            <div>
              <b>{problems ? `${problems} vấn đề cần xử lý` : warns ? "Chạy được — có mục cần chú ý" : "Mọi thứ sẵn sàng"}</b>
              <div className="sb-dim">
                {tools.length - bad.length}/{tools.length} tool dùng được · {uniqModels.length - pendingModels.length}/{uniqModels.length} model đã tải
                {pendingModels.length ? ` (còn ${gb(pendingMb)} — tự tải khi dùng lần đầu)` : ""}
              </div>
            </div>
          </div>

          <div className="hl-stats">
            <div className="hl-stat"><Server size={18} /><span><b>{latency ?? "?"} ms</b><small>Core trả lời</small></span></div>
            <div className={`hl-stat ${bad.length ? "danger" : ""}`}><Sparkles size={18} /><span><b>{tools.length - bad.length}/{tools.length}</b><small>Tool sẵn sàng</small></span></div>
            <div className="hl-stat"><Download size={18} /><span><b>{uniqModels.length - pendingModels.length}/{uniqModels.length}</b><small>Model đã tải</small></span></div>
            <div className="hl-stat"><Zap size={18} /><span><b>{data.core.device === "cuda" && env?.gpu?.cuda_usable ? "GPU" : "CPU"}</b><small>{env?.gpu?.nvidia?.[0]?.name ?? "Thiết bị chạy model"}</small></span></div>
          </div>

          <section className="hl-section">
            <h3>Dịch vụ và môi trường</h3>
            <ul className="hl-list">{rows.map((r) => <CheckRow key={r.key} r={r} />)}</ul>
          </section>

          {!!env?.packages?.length && (
            <section className="hl-section">
              <h3>Thư viện Python</h3>
              <div className="hl-pkgs">
                {env.packages.map((p) => (
                  <div key={p.name} className={`hl-pkg ${p.version ? "ok" : "danger"}`} title={p.purpose}>
                    <span className="hl-state">{p.version ? <CheckCircle2 size={14} /> : <XCircle size={14} />}</span>
                    <span><b>{p.name}</b> <small>{p.version ?? "chưa cài"}</small><br /><small className="sb-dim">{p.purpose}</small></span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="hl-section">
            <div className="hl-section-head">
              <h3>Tool ({shownTools.length})</h3>
              <div className="tp-seg" role="radiogroup" aria-label="Lọc tool">
                {([["all", "Tất cả"], ["problem", `Không dùng được (${bad.length})`], ["models", "Chưa tải model"], ["gpu", "Chạy được GPU"]] as const).map(([k, lb]) => (
                  <button key={k} role="radio" aria-checked={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{lb}</button>
                ))}
              </div>
            </div>
            <ul className="hl-tools">
              {shownTools.map((t) => {
                const ok = t.status.state === "available";
                const ready = t.models.filter((m) => m.ready).length;
                return (
                  <li key={t.id} className={`hl-tool ${ok ? "" : "danger"}`}>
                    <span className="tp-icon" aria-hidden="true">{categoryOf(t.category).icon(16)}</span>
                    <span className="hl-tool-main">
                      <a className="hl-tool-name" href={`#/tool/${t.id}`}>{t.name}</a>
                      <span className="hl-sub"><code className="sb-dim">{t.id}</code><SourceLine sources={t.sources} max={3} /></span>
                      {!ok && "reason" in t.status && <span className="hl-reason">{t.status.reason}</span>}
                      {!!t.models.length && (
                        <span className="hl-chips">
                          {t.models.map((m) => (
                            <span key={m.id} className={`hl-chip ${m.ready ? "ok" : ""}`} title={`License: ${m.license || "?"}`}>
                              {m.ready ? "✓" : <Download size={11} />} {m.id} · {gb(m.size_mb)}{m.ready ? "" : " (tải khi dùng)"}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="hl-tool-tags">
                      {t.kind === "chain" && <Badge>chuỗi</Badge>}
                      {(t.gpu === "optional" || t.gpu === "required") && <Badge kind="accent">GPU</Badge>}
                      {t.heavy && <Badge kind="warn">nặng</Badge>}
                      {!!t.models.length && <Badge kind={ready === t.models.length ? "ok" : undefined}>model {ready}/{t.models.length}</Badge>}
                      <Badge kind={ok ? "ok" : "danger"}>{ok ? "sẵn sàng" : "không dùng được"}</Badge>
                    </span>
                  </li>
                );
              })}
              {!shownTools.length && <li className="sb-dim hl-empty">Không có tool nào trong mục này.</li>}
            </ul>
          </section>

          {!!data.miniapps.length && (
            <section className="hl-section">
              <h3>Ứng dụng</h3>
              <ul className="hl-list">
                {data.miniapps.map((a) => (
                  <CheckRow key={a.name} r={{ key: a.name, icon: <Sparkles size={18} />, title: a.name,
                    level: a.status.state === "available" ? "ok" : "danger", value: a.status.state === "available" ? "Sẵn sàng" : "Không dùng được",
                    detail: "reason" in a.status ? a.status.reason : undefined }} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

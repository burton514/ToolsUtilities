// Bảng kiểm thử tự động: chạy [[examples]] của mọi tool, đo thời gian và RAM, đối chiếu với manifest.
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Notice, ProgressBar } from "@mediatool/ui";
import { isAssetRef, type AssetRef, type Job, type MediaToolClient, type ToolDetail } from "@mediatool/api-client";
import { PreviewModal } from "./AssetPreview";

type RowStatus = "idle" | "queued" | "running" | "passed" | "failed" | "warn";

interface Row {
  key: string;
  tool: ToolDetail;
  index: number;
  title: string;
  status: RowStatus;
  progress: number;
  job?: Job;
  seconds?: number;
  logs: string[];
  problems: string[];
}

const HISTORY_KEY = "mediatool.testbench.history";

function verdict(row: Row, job: Job): { status: RowStatus; problems: string[] } {
  const problems: string[] = [];
  if (job.status !== "succeeded") return { status: "failed", problems: [job.error ? `${job.error.code}: ${job.error.message}` : job.status] };
  const declared = row.tool.runtime?.ram_mb;
  const peak = job.result?.peak_ram_mb;
  if (declared && peak && peak > declared) problems.push(`RAM đỉnh ${peak} MB vượt khai báo ${declared} MB`);
  if (!job.result?.summary) problems.push("Kết quả không có summary");
  const outs = Object.values(job.result?.outputs ?? {});
  if (!outs.length) problems.push("Không có output nào");
  for (const v of outs.flat()) if (isAssetRef(v) && (v.size_bytes ?? 0) === 0) problems.push(`Output ${v.filename} rỗng (0 byte)`);
  return { status: problems.length ? "warn" : "passed", problems };
}

const badge = (s: RowStatus) =>
  s === "passed" ? <Badge kind="ok">đạt</Badge>
  : s === "warn" ? <Badge kind="warn">cảnh báo</Badge>
  : s === "failed" ? <Badge kind="danger">lỗi</Badge>
  : s === "running" ? <Badge kind="accent">đang chạy</Badge>
  : s === "queued" ? <Badge>chờ</Badge>
  : <Badge>chưa chạy</Badge>;

export function TestBench({ client }: { client: MediaToolClient }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [unavailable, setUnavailable] = useState<ToolDetail[]>([]);
  const [concurrency, setConcurrency] = useState(2);
  const [filter, setFilter] = useState<"all" | "bad">("all");
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<AssetRef | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const stopRef = useRef(false);

  const load = async () => {
    try {
      const list = await client.listTools();
      const details = await Promise.all(list.map((t) => client.getTool(t.id)));
      setUnavailable(details.filter((d) => d.status.state !== "available"));
      const prev: Record<string, number> = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "{}");
      setRows(details.filter((d) => d.status.state === "available").flatMap((d) =>
        (d.manifest?.examples ?? []).map((ex, i) => ({
          key: `${d.id}#${i + 1}`, tool: d, index: i + 1, title: ex.title, status: "idle" as RowStatus,
          progress: 0, logs: [], problems: [], seconds: prev[`${d.id}#${i + 1}`],
        })),
      ));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const patch = (key: string, p: Partial<Row> | ((r: Row) => Partial<Row>)) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...(typeof p === "function" ? p(r) : p) } : r)));

  const runOne = async (row: Row) => {
    patch(row.key, { status: "running", progress: 0, logs: [], problems: [], job: undefined });
    const t0 = performance.now();
    try {
      const job = await client.runExample(row.tool.id, row.index);
      const final = await client.waitJob(job.id, (ev) => {
        if (ev.event === "progress") patch(row.key, { progress: Number(ev.value ?? 0) });
        if (ev.event === "log") patch(row.key, (r) => ({ logs: [...r.logs.slice(-300), `[${ev.level}] ${ev.message}`] }));
      });
      const seconds = (performance.now() - t0) / 1000;
      const v = verdict(row, final);
      patch(row.key, { ...v, job: final, seconds, progress: 1 });
      const hist = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "{}");
      hist[row.key] = seconds;
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
      } catch {
        /* bỏ qua */
      }
    } catch (e) {
      patch(row.key, { status: "failed", problems: [(e as Error).message] });
    }
  };

  const runMany = async (targets: Row[]) => {
    setRunning(true);
    stopRef.current = false;
    targets.forEach((r) => patch(r.key, { status: "queued" }));
    const queue = [...targets];
    const worker = async () => {
      while (queue.length && !stopRef.current) await runOne(queue.shift()!);
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    queue.forEach((r) => patch(r.key, { status: "idle" }));
    setRunning(false);
  };

  const stats = useMemo(() => {
    const done = rows.filter((r) => ["passed", "warn", "failed"].includes(r.status));
    return {
      total: rows.length,
      passed: rows.filter((r) => r.status === "passed").length,
      warn: rows.filter((r) => r.status === "warn").length,
      failed: rows.filter((r) => r.status === "failed").length,
      time: done.reduce((a, r) => a + (r.seconds ?? 0), 0),
    };
  }, [rows]);

  const shown = filter === "bad" ? rows.filter((r) => r.status === "failed" || r.status === "warn") : rows;

  const exportReport = () => {
    const report = rows.map((r) => ({
      tool: r.tool.id, example: r.index, title: r.title, status: r.status, seconds: r.seconds,
      peak_ram_mb: r.job?.result?.peak_ram_mb, declared_ram_mb: r.tool.runtime?.ram_mb,
      summary: r.job?.result?.summary, problems: r.problems,
    }));
    const blob = new Blob([JSON.stringify({ at: new Date().toISOString(), stats, report }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mediatool-test-report.json";
    a.click();
  };

  return (
    <div className="sb-bench">
      <div className="sb-bench-head">
        <div className="sb-row">
          <Button primary disabled={running || !rows.length} onClick={() => runMany(rows)}>▶ Chạy tất cả ({rows.length})</Button>
          <Button disabled={running || !stats.failed} onClick={() => runMany(rows.filter((r) => r.status === "failed"))}>Chạy lại phần lỗi</Button>
          {running && <Button danger onClick={() => (stopRef.current = true)}>Dừng sau bước hiện tại</Button>}
          <label className="sb-dim">Song song
            <select className="mt-select" style={{ width: 60, marginLeft: 6 }} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <label className="sb-dim">
            <input type="checkbox" checked={filter === "bad"} onChange={(e) => setFilter(e.target.checked ? "bad" : "all")} /> Chỉ hiện lỗi/cảnh báo
          </label>
          <span className="sb-grow" />
          <Button small onClick={load} disabled={running}>↻ Tải lại tool</Button>
          <Button small onClick={exportReport} disabled={!rows.length}>Xuất báo cáo</Button>
        </div>
        <div className="sb-row">
          <Badge>{stats.total} ca thử</Badge>
          <Badge kind="ok">{stats.passed} đạt</Badge>
          <Badge kind="warn">{stats.warn} cảnh báo</Badge>
          <Badge kind="danger">{stats.failed} lỗi</Badge>
          <span className="sb-dim">tổng thời gian {stats.time.toFixed(1)} s</span>
        </div>
        {err && <Notice kind="danger">{err}</Notice>}
        {unavailable.map((t) => (
          <Notice key={t.id} kind="danger"><b>{t.id}</b> không dùng được: {"reason" in t.status ? t.status.reason : ""}</Notice>
        ))}
      </div>

      <table className="sb-table">
        <thead>
          <tr><th>Tool</th><th>Ví dụ</th><th>Kết quả</th><th>Thời gian</th><th>RAM đỉnh / khai báo</th><th>Tóm tắt</th><th>Output</th><th></th></tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const outs = Object.entries(r.job?.result?.outputs ?? {}).flatMap(([k, v]) =>
              (Array.isArray(v) ? v : [v]).filter(isAssetRef).map((a) => ({ k, a })));
            return [
              <tr key={r.key} className={`sb-bench-row ${r.status}`}>
                <td><code>{r.tool.id}</code></td>
                <td>{r.index}. {r.title}</td>
                <td>{badge(r.status)}{r.status === "running" && <ProgressBar value={r.progress} />}</td>
                <td>{r.seconds != null ? `${r.seconds.toFixed(2)} s` : ""}</td>
                <td>{r.job?.result?.peak_ram_mb ?? "–"} / {r.tool.runtime?.ram_mb ?? "?"} MB</td>
                <td>
                  {r.job?.result?.summary ?? ""}
                  {r.problems.map((p, i) => <div key={i} className="sb-problem">⚠ {p}</div>)}
                </td>
                <td>{outs.map(({ k, a }) => <button key={a.asset_id} className="sb-chip" onClick={() => setPreview(a)}>{k}</button>)}</td>
                <td className="sb-row">
                  <Button small disabled={running} onClick={() => runOne(r)}>Chạy</Button>
                  <Button small onClick={() => setOpen(open === r.key ? null : r.key)}>Log</Button>
                </td>
              </tr>,
              open === r.key && (
                <tr key={r.key + "-log"}><td colSpan={8}><pre className="sb-pre">{r.logs.join("\n") || "(chưa có log)"}</pre></td></tr>
              ),
            ];
          })}
        </tbody>
      </table>
      {!rows.length && !err && <div className="sb-dim" style={{ padding: 20 }}>Chưa có tool nào có [[examples]].</div>}
      <PreviewModal client={client} asset={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

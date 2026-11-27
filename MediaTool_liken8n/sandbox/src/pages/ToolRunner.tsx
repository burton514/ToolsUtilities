// Dùng một tool theo 3 bước: 1. chọn file → 2. tùy chỉnh (nếu có) → 3. bắt đầu. Kết quả hiện ngay bên dưới.
import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { ArrowLeft, FileCheck2, Music, Play, RotateCcw, Square, X } from "lucide-react";
import type { Asset, Job, MediaToolClient, ToolDetail } from "@mediatool/api-client";
import { Badge, Button, Dropzone, EmptyState, Notice, ProgressBar, Tabs } from "@mediatool/ui";
import { defaultParams, ParamField, resolveSchema, shortLabel } from "@mediatool/workspace";
import { ACCEPT, categoryOf, fileSize, FORMAT_LABEL, SourceLine } from "../meta";
import { ResultView } from "./ResultView";

export function ToolRunner({ client, toolId, onBack }: { client: MediaToolClient; toolId: string; onBack: () => void }) {
  const [tool, setTool] = useState<ToolDetail | null>(null);
  const [tab, setTab] = useState<"use" | "docs">("use");
  const [docs, setDocs] = useState("");
  const [files, setFiles] = useState<Record<string, Asset>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [job, setJob] = useState<Job | null>(null);
  const [progress, setProgress] = useState<{ value: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => {
    client.getTool(toolId).then((t) => {
      setTool(t);
      setParams(defaultParams(t.params_schema));
    }).catch((e) => setError(e.message));
    client.toolDocs(toolId).then((md) => setDocs(marked.parse(md) as string)).catch(() => setDocs(""));
  }, [client, toolId]);

  const schema = tool?.params_schema ?? {};
  const paramList = useMemo(() => Object.entries(schema.properties ?? {}).map(([k, v]) => [k, resolveSchema(v, schema)] as const), [schema]);
  const inputs = (tool?.inputs ?? []).filter((f) => f.format);
  const missing = inputs.filter((f) => f.required && !files[f.name]);
  const running = progress !== null;

  const upload = async (name: string, f: File) => {
    setUploading(name);
    setError(null);
    try {
      const a = await client.uploadAsset(f);
      setFiles((x) => ({ ...x, [name]: a }));
      setJob(null);
    } catch (e) {
      setError(`Tải file lên lỗi: ${(e as Error).message}`);
    } finally {
      setUploading(null);
    }
  };

  const follow = async (j: Job) => {
    setRunningId(j.id);
    setProgress({ value: 0, message: "Đang bắt đầu…" });
    const final = await client.waitJob(j.id, (ev) => {
      if (ev.event === "progress") setProgress({ value: Number(ev.value ?? 0), message: String(ev.message ?? "") });
    });
    setProgress(null);
    setJob(final);
    if (final.status === "failed") setError(final.error?.message ?? "Tool gặp lỗi");
    if (final.status === "cancelled") setError("Đã hủy");
  };

  const start = async () => {
    setError(null);
    setJob(null);
    try {
      const inputIds = Object.fromEntries(inputs.map((f) => [f.name, files[f.name] ? (f.multiple ? [files[f.name].id] : files[f.name].id) : undefined]));
      await follow(await client.submitJob(toolId, inputIds, params));
    } catch (e) {
      const err = e as Error & { details?: { field: string; message: string }[] };
      setProgress(null);
      setError(err.details?.map((d) => d.message).join(" · ") || err.message);
    }
  };

  const tryExample = async () => {
    setError(null);
    setJob(null);
    try {
      const j = await client.runExample(toolId, 1);
      // hiện file mẫu ở bước 1 (xem/phát được) như khi người dùng tự chọn
      const ins = (j.inputs ?? {}) as Record<string, unknown>;
      for (const [name, v] of Object.entries(ins)) {
        const first = Array.isArray(v) ? v[0] : v;
        const id = typeof first === "string" ? first : (first as { asset_id?: string } | null)?.asset_id;
        if (id) client.getAsset(id.replace(/^asset:/, "")).then((a) => setFiles((x) => ({ ...x, [name]: a }))).catch(() => undefined);
      }
      await follow(j);
    } catch (e) {
      setProgress(null);
      setError((e as Error).message);
    }
  };

  if (!tool) return <div className="sb-page">{error ? <Notice kind="danger">{error}</Notice> : <div className="mt-hint">Đang tải…</div>}</div>;
  const cat = categoryOf(tool.category);
  const unavailable = tool.status.state !== "available";

  return (
    <div className="sb-page narrow">
      <button className="sb-back" onClick={onBack}><ArrowLeft size={16} /> Tất cả công cụ</button>
      <div className="tr-head">
        <div className="tr-icon">{cat.icon(26)}</div>
        <div>
          <h1 className="mt-h1">{tool.name}</h1>
          <SourceLine sources={tool.sources} max={4} className="big" />
          <p className="mt-dim tr-sum" title={tool.summary}>{tool.summary}</p>
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "use", label: "Sử dụng" }, { value: "docs", label: "Hướng dẫn chi tiết" }]} />

      {tab === "docs" ? (
        <article className="sb-docs" dangerouslySetInnerHTML={{ __html: docs || "<p>Chưa có hướng dẫn.</p>" }} />
      ) : (
        <div className="tr-steps">
          {unavailable && <Notice kind="danger">Công cụ này tạm thời chưa dùng được: {"reason" in tool.status ? tool.status.reason : ""}</Notice>}

          {inputs.map((f, i) => {
            const a = files[f.name];
            return (
              <section key={f.name} className="tr-step">
                <div className="tr-step-num">{i + 1}</div>
                <div className="tr-step-body">
                  <h3 className="mt-h3" title={f.description ?? undefined}>{f.description ? shortLabel(f.name, { description: f.description }) : `Chọn ${FORMAT_LABEL[f.format!] ?? "file"}`}{!f.required && <span className="mt-faint"> (không bắt buộc)</span>}</h3>
                  {a ? (
                    <>
                    {a.format === "video" && <video className="tr-media" src={client.assetUrl(a.id)} poster={client.thumbnailUrl(a.id)} controls preload="metadata" />}
                    {a.format === "image" && <img className="tr-media" src={client.assetUrl(a.id)} alt={a.filename} />}
                    {a.format === "audio" && <div className="tr-audio"><Music size={20} /><audio src={client.assetUrl(a.id)} controls preload="metadata" /></div>}
                    <div className="tr-file">
                      <FileCheck2 size={20} />
                      <div className="tr-file-name"><b>{a.filename}</b><span className="mt-hint">{fileSize(a.size_bytes)} · {FORMAT_LABEL[a.format] ?? a.format}</span></div>
                      <Button small ghost icon={<X size={14} />} onClick={() => setFiles((x) => { const n = { ...x }; delete n[f.name]; return n; })} disabled={running}>Đổi file khác</Button>
                    </div>
                    </>
                  ) : (
                    <Dropzone accept={ACCEPT[f.format!]} busy={uploading === f.name} onFile={(file) => upload(f.name, file)}
                      label={`Kéo thả ${FORMAT_LABEL[f.format!] ?? "file"} vào đây, hoặc bấm để chọn`} />
                  )}
                </div>
              </section>
            );
          })}

          {paramList.length > 0 && (
            <section className="tr-step">
              <div className="tr-step-num">{inputs.length + 1}</div>
              <div className="tr-step-body">
                <h3 className="mt-h3">Tùy chỉnh</h3>
                <div className="tr-params">
                  {paramList.map(([k, s]) => <ParamField key={k} name={k} schema={s} value={params[k]} onChange={(v) => setParams({ ...params, [k]: v })} />)}
                </div>
              </div>
            </section>
          )}

          <section className="tr-run">
            {running ? (
              <div className="tr-progress">
                <div className="tr-progress-row"><b>{progress.message || "Đang xử lý…"}</b><span className="mt-dim">{Math.round(progress.value * 100)}%</span></div>
                <ProgressBar value={progress.value} />
                <Button small ghost icon={<Square size={13} />} onClick={() => runningId && client.cancelJob(runningId)}>Hủy</Button>
              </div>
            ) : (
              <>
                <Button primary large icon={<Play size={16} />} disabled={unavailable || missing.length > 0} onClick={start}>
                  {missing.length ? `Hãy chọn ${FORMAT_LABEL[missing[0].format!] ?? "file"} trước` : "Bắt đầu"}
                </Button>
                {tool.example_count > 0 && <Button ghost icon={<RotateCcw size={15} />} onClick={tryExample}>Thử với file mẫu</Button>}
              </>
            )}
          </section>

          {error && <Notice kind="danger">{error}</Notice>}
          {job?.status === "succeeded" && job.result && (
            <ResultView client={client} result={job.result} onAgain={() => { setJob(null); setFiles({}); }} />
          )}
          {!job && !running && !error && inputs.length === 0 && paramList.length === 0 && (
            <EmptyState title="Công cụ không cần đầu vào" description="Bấm Bắt đầu để chạy." />
          )}
          <div className="tr-meta"><Badge>{cat.label}</Badge><span className="mt-faint">Phiên bản {tool.version}</span></div>
        </div>
      )}
    </div>
  );
}

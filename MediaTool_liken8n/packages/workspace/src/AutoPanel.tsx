// Panel tự sinh từ schema của tool: tool nào chưa có mini app vẫn dùng được ngay trong workspace.
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Field, Hint, NumberInput, Section, Select, Slider, TextInput, Toggle, Notice } from "@mediatool/ui";
import { isAssetRef, type AssetRef, type JsonSchema, type ToolDetail } from "@mediatool/api-client";
import type { ToolRunResult } from "@mediatool/miniapp-sdk";
import { accepts, useSession, type Session } from "./session";

export function resolveSchema(schema: JsonSchema, root: JsonSchema): JsonSchema {
  return resolve(schema, root);
}

/** Giá trị mặc định của mọi tham số theo schema. */
export function defaultParams(root: JsonSchema | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(root?.properties ?? {})) {
    const s = resolve(v, root!);
    if (s.default !== undefined) out[k] = s.default;
  }
  return out;
}

function resolve(schema: JsonSchema, root: JsonSchema): JsonSchema {
  if (schema.$ref) {
    const name = schema.$ref.split("/").pop()!;
    return { ...(root.$defs?.[name] ?? {}), ...schema, $ref: undefined };
  }
  if (schema.allOf?.length === 1) return { ...resolve(schema.allOf[0], root), ...schema, allOf: undefined };
  return schema;
}

export function ParamField({ name, schema, value, onChange }: { name: string; schema: JsonSchema; value: unknown; onChange: (v: unknown) => void }) {
  const label = schema.title ?? name;
  const hint = schema.description;
  if (schema.enum) {
    return <Select label={label} hint={hint} value={value as string} options={schema.enum as string[]} onChange={onChange} />;
  }
  if (schema.type === "boolean") return <Toggle label={label} hint={hint} checked={Boolean(value)} onChange={onChange} />;
  if (schema.type === "integer" || schema.type === "number") {
    const n = typeof value === "number" ? value : Number(value ?? 0);
    if (schema.minimum != null && schema.maximum != null && schema.maximum - schema.minimum <= 1000) {
      return <Slider label={label} hint={hint} value={n} min={schema.minimum} max={schema.maximum}
        step={schema.type === "integer" ? 1 : (schema.maximum - schema.minimum) / 100} onChange={onChange} />;
    }
    return <NumberInput label={label} hint={hint} value={n} min={schema.minimum} max={schema.maximum} onChange={onChange} />;
  }
  if (schema.type === "string" || !schema.type) {
    return <TextInput label={label} hint={hint} value={String(value ?? "")} onChange={onChange} />;
  }
  return (
    <Field label={label} hint={`${hint ?? ""} (nhập JSON)`}>
      <textarea className="mt-textarea" defaultValue={JSON.stringify(value ?? null)}
        onBlur={(e) => {
          try {
            onChange(JSON.parse(e.target.value));
          } catch {
            /* giữ giá trị cũ */
          }
        }} />
    </Field>
  );
}

export function AutoPanel({ session, tool }: { session: Session; tool: ToolDetail }) {
  const assets = useSession(session, (s) => s.assets);
  const input = useSession(session, (s) => s.input);
  const schema = tool.params_schema ?? {};
  const props = useMemo(() => Object.entries(schema.properties ?? {}).map(([k, v]) => [k, resolve(v, schema)] as const), [schema]);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [picked, setPicked] = useState<Record<string, string | string[]>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ToolRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const init: Record<string, unknown> = {};
    for (const [k, v] of props) if (v.default !== undefined) init[k] = v.default;
    setParams(init);
    setPicked({});
    setResult(null);
    setError(null);
  }, [tool.id, props]);

  // tự gán file input vào input đầu tiên phù hợp
  useEffect(() => {
    if (!input) return;
    const first = tool.inputs?.find((f) => accepts(f.format, input.format));
    if (first) setPicked((p) => (p[first.name] ? p : { ...p, [first.name]: first.multiple ? [input.asset_id] : input.asset_id }));
  }, [input, tool.inputs]);

  const missing = (tool.inputs ?? []).filter((f) => f.required && !(Array.isArray(picked[f.name]) ? picked[f.name].length : picked[f.name]));
  const unavailable = tool.status.state !== "available";

  const finish = (r: ToolRunResult) => {
    setResult(r);
    const firstMedia = Object.values(r.outputs).flat().find((v): v is AssetRef => isAssetRef(v));
    if (firstMedia) session.set({ current: firstMedia, result: firstMedia, compare: session.state.input });
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      finish(await session.runTool(tool.id, { inputs: Object.fromEntries(Object.entries(picked).map(([k, v]) => [k, v])), params }, tool.name));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const runExample = async (index: number, title: string) => {
    setRunning(true);
    setError(null);
    try {
      const job = await session.client.runExample(tool.id, index);
      finish(await session.track(job, `${tool.name} · ví dụ ${index}: ${title}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="ws-autopanel">
      <Section title={tool.name}>
        <Hint>{tool.summary}</Hint>
        {unavailable && <Notice kind="danger">Tool chưa dùng được: {"reason" in tool.status ? tool.status.reason : ""}</Notice>}
      </Section>

      {!!tool.manifest?.examples?.length && (
        <Section title="Ví dụ có sẵn">
          {tool.manifest.examples.map((ex, i) => (
            <Button key={i} small disabled={running || unavailable} onClick={() => runExample(i + 1, ex.title)}>▶ {ex.title}</Button>
          ))}
        </Section>
      )}

      <Section title="Input">
        {(tool.inputs ?? []).map((f) => {
          const options = assets.filter((a) => accepts(f.format, a.ref.format));
          const value = picked[f.name];
          return (
            <Field key={f.name} label={<>{f.name} <Badge>{f.format}{f.multiple ? " · nhiều" : ""}</Badge>{f.required ? "" : " (không bắt buộc)"}</>} hint={f.description}>
              {f.multiple ? (
                <select className="mt-select" multiple value={(value as string[]) ?? []}
                  onChange={(e) => setPicked({ ...picked, [f.name]: Array.from(e.target.selectedOptions).map((o) => o.value) })}>
                  {options.map((a) => <option key={a.ref.asset_id} value={a.ref.asset_id}>{a.label}</option>)}
                </select>
              ) : (
                <select className="mt-select" value={(value as string) ?? ""} onChange={(e) => setPicked({ ...picked, [f.name]: e.target.value })}>
                  <option value="">— chọn file —</option>
                  {options.map((a) => <option key={a.ref.asset_id} value={a.ref.asset_id}>{a.label}</option>)}
                </select>
              )}
              {!options.length && <span className="mt-hint">Chưa có file loại “{f.format}”. Bấm “+ Thêm” ở cột File.</span>}
            </Field>
          );
        })}
        {!tool.inputs?.length && <Hint>Tool không cần input.</Hint>}
      </Section>

      <Section title="Tham số">
        {props.map(([k, v]) => <ParamField key={k} name={k} schema={v} value={params[k]} onChange={(val) => setParams({ ...params, [k]: val })} />)}
        {!props.length && <Hint>Tool không có tham số.</Hint>}
      </Section>

      <Section>
        <Button primary block disabled={running || unavailable || missing.length > 0} onClick={run}>
          {running ? "Đang chạy…" : missing.length ? `Thiếu: ${missing.map((m) => m.name).join(", ")}` : "Chạy tool"}
        </Button>
        {error && <Notice kind="danger">{error}</Notice>}
        {result && (
          <Notice kind="ok">
            <div><b>{result.summary || "Xong"}</b></div>
            {result.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            <ul className="ws-outputs">
              {Object.entries(result.outputs).map(([k, v]) => {
                const refs = (Array.isArray(v) ? v : [v]).filter(isAssetRef);
                return refs.length ? refs.map((r) => (
                  <li key={r.asset_id}><button className="ws-link" onClick={() => session.set({ current: r })}>{k}: {r.filename}</button></li>
                )) : <li key={k}>{k}: {JSON.stringify(v)}</li>;
              })}
            </ul>
            {result.job.result?.peak_ram_mb != null && <Hint>RAM đỉnh: {result.job.result.peak_ram_mb} MB</Hint>}
          </Notice>
        )}
      </Section>
    </div>
  );
}

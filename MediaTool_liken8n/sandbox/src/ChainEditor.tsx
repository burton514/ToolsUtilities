// Nối tool thành chuỗi: kéo output của tool này vào input của tool khác (chỉ nối được khi khớp format),
// kéo dây ra chỗ trống để được gợi ý tool phù hợp, rồi chạy cả chuỗi. Đây là bản đầu của Workflow engine.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge, Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps, type OnConnectEnd,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge, Button, Notice, ProgressBar } from "@mediatool/ui";
import { isAssetRef, type AssetRef, type MediaToolClient, type ToolDetail } from "@mediatool/api-client";
import { accepts, defaultParams, ParamField, resolveSchema } from "@mediatool/workspace";
import { AssetPreview, PreviewModal } from "./AssetPreview";

type RunState = "idle" | "running" | "done" | "error" | "skipped";

interface InputData { kind: "input"; asset?: AssetRef; state?: RunState; [k: string]: unknown }
interface ToolData {
  kind: "tool"; toolId: string; params: Record<string, unknown>;
  state?: RunState; progress?: number; summary?: string; error?: string; outputs?: Record<string, unknown>; [k: string]: unknown;
}
interface ViewData { kind: "view"; asset?: AssetRef; state?: RunState; [k: string]: unknown }
type ChainNode = Node<InputData | ToolData | ViewData>;

interface Ctx {
  client: MediaToolClient;
  tools: Record<string, ToolDetail>;
  update: (id: string, data: Record<string, unknown>) => void;
  preview: (a: AssetRef) => void;
}
const ChainCtx = createContext<Ctx>(null!);

const STORE_KEY = "mediatool.chain.v2";

// ------------------------------------------------------------------ nodes
const stateBadge = (s?: RunState) =>
  s === "done" ? <Badge kind="ok">xong</Badge> : s === "error" ? <Badge kind="danger">lỗi</Badge>
  : s === "running" ? <Badge kind="accent">đang chạy</Badge> : s === "skipped" ? <Badge kind="warn">bỏ qua</Badge> : null;

function InputNode({ id, data }: NodeProps<Node<InputData>>) {
  const { client, update, preview } = useContext(ChainCtx);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="ch-node ch-input">
      <div className="ch-title">📁 File đầu vào</div>
      {data.asset ? (
        <button className="sb-chip" onClick={() => preview(data.asset!)}>{data.asset.filename} · {data.asset.format}</button>
      ) : <div className="sb-dim">Chưa chọn file</div>}
      <Button small disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Đang tải…" : data.asset ? "Đổi file" : "Chọn file"}</Button>
      <input ref={fileRef} type="file" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        setBusy(true);
        try {
          const a = await client.uploadAsset(f);
          update(id, { asset: { asset_id: a.id, format: a.format, filename: a.filename, size_bytes: a.size_bytes } });
        } finally {
          setBusy(false);
        }
      }} />
      <Handle type="source" position={Position.Right} id="file" className="ch-handle" data-format={data.asset?.format ?? "file"} />
    </div>
  );
}

function ToolNode({ id, data }: NodeProps<Node<ToolData>>) {
  const { tools, update, preview } = useContext(ChainCtx);
  const tool = tools[data.toolId];
  const [showParams, setShowParams] = useState(false);
  if (!tool) return <div className="ch-node"><Notice kind="danger">Không có tool {data.toolId}</Notice></div>;
  const schema = tool.params_schema ?? {};
  const props = Object.entries(schema.properties ?? {});
  return (
    <div className={`ch-node ch-tool ${data.state ?? ""}`}>
      <div className="ch-title">
        <span>{tool.name}</span>{stateBadge(data.state)}
      </div>
      <code className="sb-dim">{tool.id}</code>
      <div className="ch-ports">
        <div>
          {(tool.inputs ?? []).map((f) => (
            <div key={f.name} className="ch-port in">
              <Handle type="target" position={Position.Left} id={f.name} className="ch-handle" />
              <span>{f.name}{f.required ? "*" : ""}</span> <Badge>{f.format}</Badge>
            </div>
          ))}
        </div>
        <div>
          {(tool.outputs ?? []).map((f) => {
            const v = data.outputs?.[f.name];
            const refs = (Array.isArray(v) ? v : [v]).filter(isAssetRef);
            return (
              <div key={f.name} className="ch-port out">
                {refs.length ? <button className="sb-chip" onClick={() => preview(refs[0])}>{f.name}</button> : <span>{f.name}</span>}
                <Badge>{f.format ?? f.type}</Badge>
                <Handle type="source" position={Position.Right} id={f.name} className="ch-handle" />
              </div>
            );
          })}
        </div>
      </div>
      {data.state === "running" && <ProgressBar value={data.progress ?? 0} />}
      {data.summary && <div className="ch-summary">{data.summary}</div>}
      {data.error && <div className="sb-problem">{data.error}</div>}
      {!!props.length && (
        <>
          <Button small onClick={() => setShowParams(!showParams)}>{showParams ? "Ẩn tham số" : `Tham số (${props.length})`}</Button>
          {showParams && (
            <div className="ch-params nodrag nowheel">
              {props.map(([k, s]) => (
                <ParamField key={k} name={k} schema={resolveSchema(s, schema)} value={data.params[k]}
                  onChange={(v) => update(id, { params: { ...data.params, [k]: v } })} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ViewNode({ data }: NodeProps<Node<ViewData>>) {
  const { client } = useContext(ChainCtx);
  return (
    <div className="ch-node ch-view">
      <Handle type="target" position={Position.Left} id="file" className="ch-handle" />
      <div className="ch-title">👁 Xem kết quả</div>
      {data.asset ? <AssetPreview client={client} asset={data.asset} compact /> : <div className="sb-dim">Nối một output vào đây</div>}
    </div>
  );
}

const nodeTypes = { mtInput: InputNode, mtTool: ToolNode, mtView: ViewNode };
const typeOf = (kind: string) => (kind === "input" ? "mtInput" : kind === "tool" ? "mtTool" : "mtView");

// ------------------------------------------------------------------ format helpers
function sourceFormat(node: ChainNode | undefined, handle: string | null | undefined, tools: Record<string, ToolDetail>): string | null {
  if (!node) return null;
  if (node.data.kind === "input") return (node.data as InputData).asset?.format ?? "file";
  if (node.data.kind === "tool") return tools[(node.data as ToolData).toolId]?.outputs?.find((o) => o.name === handle)?.format ?? null;
  return null;
}
function targetFormat(node: ChainNode | undefined, handle: string | null | undefined, tools: Record<string, ToolDetail>): string | null {
  if (!node) return null;
  if (node.data.kind === "view") return "file";
  if (node.data.kind === "tool") return tools[(node.data as ToolData).toolId]?.inputs?.find((i) => i.name === handle)?.format ?? null;
  return null;
}

// ------------------------------------------------------------------ editor
function Flow({ client }: { client: MediaToolClient }) {
  const [tools, setTools] = useState<Record<string, ToolDetail>>({});
  const saved = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as { nodes: ChainNode[]; edges: Edge[] } | null;
    } catch {
      return null;
    }
  }, []);
  const [nodes, setNodes, onNodesChange] = useNodesState<ChainNode>(saved?.nodes ?? []);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(saved?.edges ?? []);
  const [menu, setMenu] = useState<{ x: number; y: number; flowPos: { x: number; y: number }; from?: { node: string; handle: string; format: string } } | null>(null);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<AssetRef | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const rf = useReactFlow();
  const seq = useRef(Date.now());
  const newId = () => `n${++seq.current}`;

  useEffect(() => {
    client.listTools()
      .then((list) => Promise.all(list.filter((t) => t.status.state === "available").map((t) => client.getTool(t.id))))
      .then((ds) => setTools(Object.fromEntries(ds.map((d) => [d.id, d]))))
      .catch((e) => setMsg(`Không tải được tool: ${e.message}`));
  }, [client]);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ nodes: nodes.map((n) => ({ ...n, data: { ...n.data, state: undefined, progress: undefined } })), edges }));
    } catch {
      /* bỏ qua */
    }
  }, [nodes, edges]);

  const update = useCallback((id: string, data: Record<string, unknown>) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } as ChainNode["data"] } : n))), [setNodes]);

  const isValidConnection = useCallback((c: Connection | Edge) => {
    const src = sourceFormat(nodes.find((n) => n.id === c.source), c.sourceHandle, tools);
    const tgt = targetFormat(nodes.find((n) => n.id === c.target), c.targetHandle, tools);
    if (!src || !tgt || c.source === c.target) return false;
    if (edges.some((e) => e.target === c.target && e.targetHandle === c.targetHandle)) {
      const multiple = tools[(nodes.find((n) => n.id === c.target)?.data as ToolData)?.toolId]?.inputs?.find((i) => i.name === c.targetHandle)?.multiple;
      if (!multiple) return false;
    }
    return src === "file" || accepts(tgt, src);
  }, [nodes, edges, tools]);

  const onConnect = useCallback((c: Connection) => setEdges((es) => addEdge({ ...c, animated: false }, es)), [setEdges]);

  // Thả dây ra chỗ trống → gợi ý tool nhận được format đó
  const onConnectEnd: OnConnectEnd = useCallback((event, state) => {
    if (state.isValid || !state.fromNode || state.fromHandle?.type !== "source") return;
    const e = "changedTouches" in event ? event.changedTouches[0] : event;
    const fromNode = nodes.find((n) => n.id === state.fromNode!.id);
    const format = sourceFormat(fromNode, state.fromHandle.id, tools) ?? "file";
    setMenu({ x: e.clientX, y: e.clientY, flowPos: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
      from: { node: state.fromNode.id, handle: state.fromHandle.id ?? "file", format } });
  }, [nodes, tools, rf]);

  const addNode = (data: ChainNode["data"], pos: { x: number; y: number }, from?: { node: string; handle: string; format: string }) => {
    const id = newId();
    setNodes((ns) => [...ns, { id, type: typeOf(data.kind), position: pos, data }]);
    if (from) {
      let targetHandle = "file";
      if (data.kind === "tool") {
        const inputs = tools[(data as ToolData).toolId]?.inputs ?? [];
        targetHandle = (inputs.find((i) => from.format !== "file" && accepts(i.format, from.format)) ?? inputs[0])?.name ?? "file";
      }
      setEdges((es) => addEdge({ source: from.node, sourceHandle: from.handle, target: id, targetHandle }, es));
    }
    setMenu(null);
  };

  const suggestions = useMemo(() => {
    const list = Object.values(tools);
    if (!menu?.from) return list;
    const f = menu.from.format;
    return list.filter((t) => (t.inputs ?? []).some((i) => f === "file" || accepts(i.format, f)));
  }, [menu, tools]);

  // ------------------------------------------------------------------ chạy chuỗi
  const runChain = async () => {
    setRunning(true);
    setMsg(null);
    const ns = rf.getNodes() as ChainNode[];
    const es = rf.getEdges();
    const values = new Map<string, unknown>(); // `${node}:${handle}` → AssetRef | AssetRef[]
    for (const n of ns) {
      if (n.data.kind === "input") values.set(`${n.id}:file`, (n.data as InputData).asset);
      else update(n.id, { state: "idle", progress: 0, summary: undefined, error: undefined, outputs: undefined, asset: undefined });
    }
    const pending = new Set(ns.filter((n) => n.data.kind !== "input").map((n) => n.id));
    const failed = new Set<string>();
    const incoming = (id: string) => es.filter((e) => e.target === id);
    const ready = (id: string) => incoming(id).every((e) => !pending.has(e.source));

    while (pending.size) {
      const wave = [...pending].filter(ready);
      if (!wave.length) {
        setMsg("Chuỗi có vòng lặp, không chạy được.");
        break;
      }
      await Promise.all(wave.map(async (id) => {
        pending.delete(id);
        const node = ns.find((n) => n.id === id)!;
        const ins = incoming(id);
        if (ins.some((e) => failed.has(e.source)) || ins.some((e) => values.get(`${e.source}:${e.sourceHandle}`) == null)) {
          failed.add(id);
          update(id, { state: "skipped" });
          return;
        }
        if (node.data.kind === "view") {
          const v = values.get(`${ins[0]?.source}:${ins[0]?.sourceHandle}`);
          update(id, { asset: Array.isArray(v) ? v[0] : v, state: "done" });
          return;
        }
        const d = node.data as ToolData;
        const tool = tools[d.toolId];
        const inputs: Record<string, unknown> = {};
        for (const e of ins) {
          const v = values.get(`${e.source}:${e.sourceHandle}`);
          const ids = (Array.isArray(v) ? v : [v]).filter(isAssetRef).map((a) => a.asset_id);
          const multiple = tool.inputs?.find((i) => i.name === e.targetHandle)?.multiple;
          inputs[e.targetHandle!] = multiple ? [...((inputs[e.targetHandle!] as string[]) ?? []), ...ids] : ids[0];
        }
        update(id, { state: "running" });
        try {
          const job = await client.submitJob(d.toolId, inputs, d.params);
          const final = await client.waitJob(job.id, (ev) => {
            if (ev.event === "progress") update(id, { progress: Number(ev.value ?? 0) });
          });
          if (final.status !== "succeeded") throw new Error(final.error?.message ?? final.status);
          const outs = final.result?.outputs ?? {};
          for (const [k, v] of Object.entries(outs)) values.set(`${id}:${k}`, isAssetRef(v) || Array.isArray(v) ? v : undefined);
          update(id, { state: "done", outputs: outs, summary: final.result?.summary });
        } catch (e) {
          failed.add(id);
          const err = e as Error & { details?: { field: string; message: string }[] };
          update(id, { state: "error", error: err.details?.map((x) => `${x.field}: ${x.message}`).join("; ") || err.message });
        }
      }));
    }
    setRunning(false);
  };

  const loadDemo = () => {
    const a = newId(), b = newId(), c = newId(), v = newId();
    setNodes([
      { id: a, type: "mtInput", position: { x: 0, y: 120 }, data: { kind: "input" } },
      { id: b, type: "mtTool", position: { x: 300, y: 0 }, data: { kind: "tool", toolId: "video_demux", params: defaultParams(tools.video_demux?.params_schema) } },
      { id: c, type: "mtTool", position: { x: 300, y: 300 }, data: { kind: "tool", toolId: "media_probe", params: {} } },
      { id: v, type: "mtView", position: { x: 680, y: 60 }, data: { kind: "view" } },
    ]);
    setEdges([
      { id: `e${a}${b}`, source: a, sourceHandle: "file", target: b, targetHandle: "video" },
      { id: `e${a}${c}`, source: a, sourceHandle: "file", target: c, targetHandle: "file" },
      { id: `e${b}${v}`, source: b, sourceHandle: "audio", target: v, targetHandle: "file" },
    ]);
  };

  const ctx = useMemo<Ctx>(() => ({ client, tools, update, preview: setPreview }), [client, tools, update]);
  const center = () => rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  return (
    <ChainCtx.Provider value={ctx}>
      <div className="ch-root">
        <div className="ch-toolbar">
          <Button small onClick={() => addNode({ kind: "input" }, center())}>+ File đầu vào</Button>
          <Button small onClick={() => setMenu({ x: 200, y: 120, flowPos: center() })}>+ Tool</Button>
          <Button small onClick={() => addNode({ kind: "view" }, center())}>+ Xem kết quả</Button>
          <Button small onClick={loadDemo} disabled={!Object.keys(tools).length}>Chuỗi mẫu</Button>
          <Button small danger onClick={() => { setNodes([]); setEdges([]); }}>Xóa hết</Button>
          <span className="sb-grow" />
          <span className="sb-dim">Kéo dây ra chỗ trống để được gợi ý tool · chỉ nối được khi khớp format</span>
          <Button primary disabled={running || !nodes.length} onClick={runChain}>{running ? "Đang chạy…" : "▶ Chạy chuỗi"}</Button>
        </div>
        {msg && <Notice kind="danger">{msg}</Notice>}
        <div className="ch-canvas">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} onConnectEnd={onConnectEnd} isValidConnection={isValidConnection} fitView colorMode="system"
            deleteKeyCode={["Delete", "Backspace"]} onPaneClick={() => setMenu(null)}>
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
        {menu && (
          <div className="ch-menu" style={{ left: Math.min(menu.x, window.innerWidth - 300), top: Math.min(menu.y, window.innerHeight - 320) }}>
            <div className="sb-dim">{menu.from ? `Tool nhận được “${menu.from.format}”` : "Chọn tool"}</div>
            {suggestions.map((t) => (
              <button key={t.id} className="sb-item" onClick={() =>
                addNode({ kind: "tool", toolId: t.id, params: defaultParams(t.params_schema) }, menu.flowPos, menu.from)}>
                <span>{t.name}</span><code>{t.id}</code>
              </button>
            ))}
            {menu.from && <button className="sb-item" onClick={() => addNode({ kind: "view" }, menu.flowPos, menu.from)}><span>👁 Xem kết quả</span></button>}
            {!suggestions.length && <div className="sb-dim">Chưa có tool nào nhận loại này</div>}
          </div>
        )}
        <PreviewModal client={client} asset={preview} onClose={() => setPreview(null)} />
      </div>
    </ChainCtx.Provider>
  );
}

export function ChainEditor({ client }: { client: MediaToolClient }) {
  return (
    <ReactFlowProvider>
      <Flow client={client} />
    </ReactFlowProvider>
  );
}

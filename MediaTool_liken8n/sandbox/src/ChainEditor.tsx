// Nối tool thành chuỗi: kéo output của tool này vào input của tool khác (chỉ nối được khi khớp format),
// kéo dây ra chỗ trống để được gợi ý tool phù hợp, rồi chạy cả chuỗi — hoặc bấm ▶ trên một node để chạy lại từ bước đó
// (các bước phía trước dùng lại kết quả lần trước; đổi tham số / file / dây thì kết quả cũ phía sau bị xóa).
// Đặt tên + Lưu → chuỗi thành công cụ thật trên máy chủ (chạy độc lập, lồng vào chuỗi khác, gọi qua AI); thư viện "Chuỗi đã lưu"
// để mở / đổi tên / xóa / đánh sao — chuỗi dựng sẵn mở ra để sao chép.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge, Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesInitialized, useNodesState, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps, type OnConnectEnd,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge, Button, Notice, ProgressBar } from "@mediatool/ui";
import { isAssetRef, type AssetRef, type MediaToolClient, type ToolDetail } from "@mediatool/api-client";
import { chainToGraph, GraphError, graphToChain } from "./chainGraph";
import { chainStore } from "./chainStore";
import { accepts, defaultParams, ParamField, resolveSchema } from "@mediatool/workspace";
import { AssetPreview, PreviewModal } from "./AssetPreview";
import { DRAG_TYPE, takesAny, ToolPalette, type FollowFrom } from "./ToolPalette";
import { SourceLine } from "./meta";

type RunState = "idle" | "running" | "done" | "error" | "skipped";

interface InputData { kind: "input"; asset?: AssetRef; label?: string; state?: RunState; [k: string]: unknown }
interface ToolData {
  kind: "tool"; toolId: string; params: Record<string, unknown>;
  state?: RunState; progress?: number; summary?: string; error?: string; outputs?: Record<string, unknown>; [k: string]: unknown;
}
interface ViewData { kind: "view"; asset?: AssetRef; label?: string; state?: RunState; [k: string]: unknown }
type ChainNode = Node<InputData | ToolData | ViewData>;

interface Ctx {
  client: MediaToolClient;
  tools: Record<string, ToolDetail>;
  update: (id: string, data: Record<string, unknown>) => void;
  preview: (a: AssetRef) => void;
  /** xóa kết quả cũ của node + mọi node phía sau (đổi tham số / đổi file) */
  invalidate: (id: string) => void;
  /** chạy lại từ node này: node + mọi node phía sau; phía trước dùng lại kết quả cũ (thiếu thì chạy bù) */
  runFrom: (id: string) => void;
  running: boolean;
}
const ChainCtx = createContext<Ctx>(null!);

const PALETTE_KEY = "mediatool.chain.palette";

/** Chuỗi đang mở trên trình nối. `id` chỉ có khi là chuỗi của tôi đã lưu (sửa được). */
interface ChainDocState { id?: string; name: string; summary?: string; editable: boolean }

// ------------------------------------------------------------------ nodes
const stateBadge = (s?: RunState) =>
  s === "done" ? <Badge kind="ok">xong</Badge> : s === "error" ? <Badge kind="danger">lỗi</Badge>
  : s === "running" ? <Badge kind="accent">đang chạy</Badge> : s === "skipped" ? <Badge kind="warn">bỏ qua</Badge> : null;

/** Nút ▶ trên node: chạy lại từ bước này. */
function RunHere({ id, label }: { id: string; label: string }) {
  const { runFrom, running } = useContext(ChainCtx);
  return (
    <button className="ch-run nodrag" title={label} aria-label={label} disabled={running} onClick={() => runFrom(id)}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>
    </button>
  );
}

function InputNode({ id, data }: NodeProps<Node<InputData>>) {
  const { client, update, preview, invalidate } = useContext(ChainCtx);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="ch-node ch-input">
      <div className="ch-title">
        <span>📁 File đầu vào</span>
        {data.asset && <RunHere id={id} label="Chạy mọi bước dùng file này" />}
      </div>
      <input className="ch-label nodrag" placeholder="Tên (khi lưu chuỗi), vd: Bài hát" value={data.label ?? ""} aria-label="Tên file đầu vào"
        onChange={(e) => update(id, { label: e.target.value })} />
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
          invalidate(id); // các bước dùng file cũ phải chạy lại
        } finally {
          setBusy(false);
        }
      }} />
      <Handle type="source" position={Position.Right} id="file" className="ch-handle" data-format={data.asset?.format ?? "file"} />
    </div>
  );
}

function ToolNode({ id, data }: NodeProps<Node<ToolData>>) {
  const { tools, update, preview, invalidate } = useContext(ChainCtx);
  const tool = tools[data.toolId];
  const [showParams, setShowParams] = useState(false);
  if (!Object.keys(tools).length) return <div className="ch-node"><div className="ch-title">Đang tải…</div><code className="sb-dim">{data.toolId}</code></div>;
  if (!tool) return <div className="ch-node"><Notice kind="danger">Không có tool {data.toolId}</Notice></div>;
  const schema = tool.params_schema ?? {};
  const props = Object.entries(schema.properties ?? {});
  return (
    <div className={`ch-node ch-tool ${data.state ?? ""}`}>
      <div className="ch-title">
        <span>{tool.name}</span>
        <span className="ch-title-end">
          {stateBadge(data.state)}
          <RunHere id={id} label="Chạy từ bước này (các bước trước dùng lại kết quả cũ)" />
        </span>
      </div>
      <SourceLine sources={tool.sources} max={1} />
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
                  onChange={(v) => { update(id, { params: { ...data.params, [k]: v } }); if (data.outputs) invalidate(id); }} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ViewNode({ id, data }: NodeProps<Node<ViewData>>) {
  const { client, update } = useContext(ChainCtx);
  return (
    <div className="ch-node ch-view">
      <Handle type="target" position={Position.Left} id="file" className="ch-handle" />
      <div className="ch-title">👁 Xem kết quả</div>
      <input className="ch-label nodrag" placeholder="Tên kết quả (khi lưu chuỗi)" value={data.label ?? ""} aria-label="Tên kết quả"
        onChange={(e) => update(id, { label: e.target.value })} />
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

/** Node + mọi node phía sau nó (theo dây nối). */
function downstream(start: string, es: Edge[]): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of es) if (e.source === id) stack.push(e.target);
  }
  return seen;
}

// ------------------------------------------------------------------ editor
function Flow({ client }: { client: MediaToolClient }) {
  const [tools, setTools] = useState<Record<string, ToolDetail>>({});
  // chuỗi đang mở = một dự án trong kho chuỗi (bản nháp hoặc chuỗi của tôi) — tự lưu, đổi tab / tải lại không mất
  const start = chainStore.doc;
  const [nodes, setNodes, onNodesChange] = useNodesState<ChainNode>((start?.nodes ?? []) as ChainNode[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>((start?.edges ?? []) as Edge[]);
  const [menu, setMenu] = useState<{ x: number; y: number; flowPos: { x: number; y: number }; from?: { node: string; handle: string; format: string } } | null>(null);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<AssetRef | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // chuỗi đang mở: id (chuỗi của tôi đã lưu) + tên; chuỗi dựng sẵn mở ra là bản sao chưa có id
  const [doc, setDoc] = useState<ChainDocState>({ id: start?.chainId, name: start?.name ?? "", summary: start?.summary, editable: !!start?.chainId });
  const loadedKey = useRef(chainStore.current);
  const [saving, setSaving] = useState(false);
  const rf = useReactFlow();
  const seq = useRef(Date.now());
  const newId = () => `n${++seq.current}`;

  useEffect(() => {
    client.listTools()
      .then((list) => Promise.all(list.filter((t) => t.status.state === "available")
        // chi tiết (schema, cổng) + thông tin chỉ có ở danh sách: yêu thích, loại tool / chuỗi
        .map((t) => client.getTool(t.id).then((d) => ({ ...d, favorite: t.favorite ?? null, kind: t.kind ?? d.kind })))))
      .then((ds) => setTools(Object.fromEntries(ds.map((d) => [d.id, d]))))
      .catch((e) => setMsg(`Không tải được tool: ${e.message}`));
  }, [client]);

  // bảng chọn tool bên phải: nhớ đóng / mở theo máy
  const [paletteOpen, setPaletteOpen] = useState(() => {
    try {
      return localStorage.getItem(PALETTE_KEY) !== "closed";
    } catch {
      return true;
    }
  });
  const togglePalette = () => setPaletteOpen((o) => {
    try {
      localStorage.setItem(PALETTE_KEY, o ? "closed" : "open");
    } catch {
      /* bỏ qua */
    }
    return !o;
  });
  const [selId, setSelId] = useState<string | null>(null);

  // căn khung nhìn khi mở một chuỗi: đợi các node đo xong kích thước (và tool tải xong — node mới có đủ cổng, tham số)
  const needFit = useRef(true);
  const measured = useNodesInitialized();
  useEffect(() => {
    if (!needFit.current || !measured || !Object.keys(tools).length) return;
    needFit.current = false;
    const t = setTimeout(() => rf.fitView({ padding: 0.15, maxZoom: 1, duration: 200 }), 30);
    return () => clearTimeout(t);
  }, [measured, tools, nodes.length, rf]);

  // tự lưu vào kho chuỗi: giữ cả kết quả lần chạy (bấm ▶ trên node dùng lại được), bỏ trạng thái đang chạy.
  // "Chưa lưu" (chuỗi của tôi) chỉ khi BỐ CỤC / tham số / tên đổi so với lúc mở — đổi kết quả chạy không tính.
  const shape = (ns: ChainNode[], es: Edge[], name: string) => JSON.stringify([name,
    ns.map((n) => [n.id, Math.round(n.position.x), Math.round(n.position.y),
      Object.fromEntries(Object.entries(n.data).filter(([k]) => !["state", "progress", "summary", "error", "outputs", "asset"].includes(k)))]),
    es.map((e) => [e.source, e.sourceHandle, e.target, e.targetHandle])]);
  const baseline = useRef(shape(nodes, edges, doc.name));
  useEffect(() => {
    if (loadedKey.current !== chainStore.current) return; // đang chuyển sang chuỗi khác: chưa ghi
    const changed = shape(nodes, edges, doc.name) !== baseline.current;
    chainStore.save({
      nodes: nodes.map((n) => ({ ...n, selected: false, data: { ...n.data, state: n.data.state === "running" ? undefined : n.data.state, progress: undefined } })),
      edges, name: doc.name, summary: doc.summary,
    }, changed);
  }, [nodes, edges, doc]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Nạp một dự án trong kho lên trình nối (bấm ở danh sách bên trái, Chuỗi mới, sau khi mở chuỗi trên máy chủ). */
  const loadFromStore = useCallback(() => {
    const d = chainStore.doc;
    if (!d) return;
    loadedKey.current = d.key;
    const ns = d.nodes as ChainNode[];
    const es = d.edges as Edge[];
    baseline.current = d.dirty ? "" : shape(ns, es, d.name);
    setNodes(ns);
    setEdges(es);
    setDoc({ id: d.chainId, name: d.name, summary: d.summary, editable: !!d.chainId });
    setMsg(null);
    setInfo(null);
    setSelId(null);
    needFit.current = ns.length > 0; // căn khung khi các node đã đo xong kích thước (xem effect bên dưới)
  }, [rf, setNodes, setEdges]); // eslint-disable-line react-hooks/exhaustive-deps

  // nghe kho chuỗi: đổi dự án đang mở / yêu cầu mở chuỗi trên máy chủ
  const [, setTick] = useState(0); // vẽ lại khi kho chuỗi đổi (nhãn "chưa lưu")
  useEffect(() => chainStore.subscribe(() => {
    setTick((t) => t + 1);
    if (chainStore.current !== loadedKey.current) loadFromStore();
    const req = chainStore.pendingOpen;
    if (req) {
      chainStore.pendingOpen = null;
      client.getChain(req.chainId).then((d) => {
        const g = (d.graph as { nodes: ChainNode[]; edges: Edge[] } | null) ?? (d.chain ? chainToGraph(d.chain) : null);
        if (!g) {
          setMsg("Chuỗi này không có nội dung để mở");
          return;
        }
        const copy = req.copy || !d.editable;
        chainStore.adopt({ chainId: d.id, name: copy ? `${d.name ?? d.id} (bản sao)` : d.name ?? "", summary: d.summary ?? "",
          nodes: g.nodes, edges: g.edges }, copy);
        if (copy) setInfo(`Đã mở bản sao của chuỗi dựng sẵn "${d.name}" — sửa rồi Lưu thành chuỗi của bạn`);
      }).catch((e) => setMsg(`Không mở được chuỗi: ${(e as Error).message}`));
    }
  }), [client, loadFromStore]);

  const update = useCallback((id: string, data: Record<string, unknown>) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } as ChainNode["data"] } : n))), [setNodes]);

  /** Kết quả của node (và mọi node phía sau) không còn đúng nữa — đổi tham số / đổi file / đổi dây. */
  const invalidate = useCallback((id: string) => {
    const stale = downstream(id, rf.getEdges());
    setNodes((ns) => ns.map((n) => (stale.has(n.id) && n.data.kind !== "input"
      ? { ...n, data: { ...n.data, state: undefined, progress: undefined, summary: undefined, error: undefined, outputs: undefined, asset: undefined } as ChainNode["data"] }
      : n)));
  }, [rf, setNodes]);

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

  const onConnect = useCallback((c: Connection) => {
    setEdges((es) => addEdge({ ...c, animated: false }, es));
    invalidate(c.target); // input đổi → kết quả cũ của bước nhận không còn đúng
  }, [setEdges, invalidate]);
  const onEdgesChangeAll: typeof onEdgesChange = useCallback((changes) => {
    for (const ch of changes) {
      if (ch.type === "remove") {
        const e = rf.getEdge(ch.id);
        if (e) invalidate(e.target);
      }
    }
    onEdgesChange(changes);
  }, [onEdgesChange, invalidate, rf]);

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
    const list = Object.values(tools).filter((t) => (t.kind ?? "tool") === "tool"); // chuỗi là dự án, không gợi ý như tool
    if (!menu?.from) return list;
    const f = menu.from.format;
    return list.filter((t) => (t.inputs ?? []).some((i) => f === "file" || accepts(i.format, f)));
  }, [menu, tools]);

  /** Các cổng ra của node: [(tên cổng, format)] — file đầu vào chưa chọn file = "file". */
  const outPorts = (n: ChainNode | undefined): [string, string][] => {
    if (!n) return [];
    if (n.data.kind === "input") return [["file", (n.data as InputData).asset?.format ?? "file"]];
    if (n.data.kind === "tool") return (tools[(n.data as ToolData).toolId]?.outputs ?? []).map((o) => [o.name, o.format ?? "file"]);
    return [];
  };
  const selNode = nodes.find((n) => n.id === selId);
  const follow: FollowFrom | null = useMemo(() => {
    const ports = outPorts(selNode);
    if (!selNode || !ports.length) return null;
    const label = selNode.data.kind === "tool" ? tools[(selNode.data as ToolData).toolId]?.name ?? "bước đang chọn"
      : (selNode.data as InputData).label || (selNode.data as InputData).asset?.filename || "File đầu vào";
    return { label, formats: [...new Set(ports.map(([, f]) => f))] };
  }, [selNode, tools]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Thêm tool từ bảng chọn: đang chọn node có output hợp → đặt bên phải node đó và nối dây; không thì đặt giữa màn hình. */
  const addFromPalette = (t: ToolDetail) => {
    const data = { kind: "tool", toolId: t.id, params: defaultParams(t.params_schema) } as ToolData;
    if (selNode && follow && takesAny(t, follow.formats)) {
      const port = outPorts(selNode).find(([, f]) => f === "file" || (t.inputs ?? []).some((i) => accepts(i.format, f)))!;
      const below = nodes.filter((n) => Math.abs(n.position.x - (selNode.position.x + 380)) < 60).length;
      addNode(data, { x: selNode.position.x + 380, y: selNode.position.y + below * 60 }, { node: selNode.id, handle: port[0], format: port[1] });
      return;
    }
    const c = center();
    addNode(data, { x: c.x - 120 + (nodes.length % 5) * 24, y: c.y - 80 + (nodes.length % 5) * 24 });
  };
  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData(DRAG_TYPE);
    const t = tools[id];
    if (!t) return;
    e.preventDefault();
    addNode({ kind: "tool", toolId: t.id, params: defaultParams(t.params_schema) }, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };
  const setFavorites = (favs: string[]) =>
    setTools((ts) => Object.fromEntries(Object.entries(ts).map(([k, v]) => [k, { ...v, favorite: favs.includes(k) ? favs.indexOf(k) : null }])));

  // ------------------------------------------------------------------ chạy chuỗi
  /** Có sẵn giá trị ở cổng ra `handle` của node chưa (file đã chọn / kết quả lần chạy trước). */
  const cached = (n: ChainNode | undefined, handle: string | null | undefined): unknown => {
    if (!n) return undefined;
    if (n.data.kind === "input") return (n.data as InputData).asset;
    if (n.data.kind === "tool") {
      const v = (n.data as ToolData).outputs?.[handle ?? ""];
      return isAssetRef(v) || Array.isArray(v) ? v : undefined;
    }
    return undefined;
  };

  /** Chạy chuỗi. `startId` bỏ trống = chạy tất cả; có = chạy node đó và mọi node phía sau, các bước phía trước dùng lại
   *  kết quả lần trước (bước nào phía trước chưa có kết quả thì chạy bù). */
  const runChain = async (startId?: string) => {
    setRunning(true);
    chainStore.setRunning(true);
    setMsg(null);
    const ns = rf.getNodes() as ChainNode[];
    const es = rf.getEdges();
    const byId = new Map(ns.map((n) => [n.id, n]));
    const incoming = (id: string) => es.filter((e) => e.target === id);
    const isInput = (id: string) => byId.get(id)?.data.kind === "input";

    let toRun: Set<string>;
    if (!startId) {
      toRun = new Set(ns.filter((n) => n.data.kind !== "input").map((n) => n.id));
    } else {
      toRun = new Set([...downstream(startId, es)].filter((id) => !isInput(id)));
      const queue = [...toRun];
      while (queue.length) { // phía trước thiếu kết quả → chạy bù
        const id = queue.pop()!;
        for (const e of incoming(id)) {
          if (toRun.has(e.source) || isInput(e.source) || cached(byId.get(e.source), e.sourceHandle) != null) continue;
          toRun.add(e.source);
          queue.push(e.source);
        }
      }
      // ô "Xem kết quả" nối sau bước nào được chạy lại thì cập nhật theo (không tốn gì)
      for (const id of [...toRun]) for (const v of downstream(id, es)) if (byId.get(v)?.data.kind === "view") toRun.add(v);
    }

    const values = new Map<string, unknown>(); // `${node}:${handle}` → AssetRef | AssetRef[]
    for (const n of ns) {
      if (toRun.has(n.id)) {
        update(n.id, { state: "idle", progress: 0, summary: undefined, error: undefined, outputs: undefined, asset: undefined });
      } else if (n.data.kind === "input") {
        values.set(`${n.id}:file`, (n.data as InputData).asset);
      } else if (n.data.kind === "tool") {
        for (const [k, v] of Object.entries((n.data as ToolData).outputs ?? {})) values.set(`${n.id}:${k}`, cached(n, k));
      }
    }
    const pending = new Set(toRun);
    const failed = new Set<string>();
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
    chainStore.setRunning(false);
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

  // ------------------------------------------------------------------ lưu / mở chuỗi
  /** Bố cục để mở lại: bỏ trạng thái chạy, kết quả và file đã chọn (file là của từng lần chạy, không thuộc chuỗi). */
  const layout = () => ({
    nodes: (rf.getNodes() as ChainNode[]).map((n) => ({
      id: n.id, type: n.type, position: n.position,
      data: Object.fromEntries(Object.entries(n.data).filter(([k]) => !["state", "progress", "summary", "error", "outputs", "asset"].includes(k))),
    })),
    edges: rf.getEdges().map(({ id, source, sourceHandle, target, targetHandle }) => ({ id, source, sourceHandle, target, targetHandle })),
  });

  const save = async (asNew: boolean) => {
    setMsg(null);
    setInfo(null);
    const name = doc.name.trim();
    if (!name) {
      setMsg("Hãy đặt tên cho chuỗi trước khi lưu");
      return;
    }
    let chain;
    try {
      chain = graphToChain(rf.getNodes() as never, rf.getEdges(), tools);
    } catch (e) {
      setMsg(e instanceof GraphError ? e.message : `Không chuyển được sơ đồ thành chuỗi: ${(e as Error).message}`);
      return;
    }
    setSaving(true);
    try {
      const body = { name, summary: doc.summary ?? "", chain, graph: layout() };
      const r = doc.id && doc.editable && !asNew ? await client.updateChain(doc.id, body) : await client.createChain(body);
      setDoc({ id: r.id, name: r.name, summary: doc.summary, editable: true });
      baseline.current = shape(rf.getNodes() as ChainNode[], rf.getEdges(), r.name);
      chainStore.saved(r.id, r.name);
      loadedKey.current = chainStore.current;
      const st = r.status as { state?: string; reason?: string } | null;
      setInfo(st && st.state !== "available"
        ? `Đã lưu "${r.name}" nhưng chuỗi chưa chạy được: ${st.reason ?? ""}`
        : `Đã lưu "${r.name}" — chuỗi có trong mục Công cụ, chạy độc lập hoặc lồng vào chuỗi khác được`);
    } catch (e) {
      setMsg(`Lưu lỗi: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const newChain = () => chainStore.newDraft();

  const runRef = useRef(runChain);
  runRef.current = runChain;
  const ctx = useMemo<Ctx>(() => ({
    client, tools, update, invalidate, running, preview: setPreview, runFrom: (id: string) => void runRef.current(id),
  }), [client, tools, update, invalidate, running]);
  const center = () => rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  return (
    <ChainCtx.Provider value={ctx}>
      <div className="ch-root">
        <div className="ch-toolbar ch-docbar">
          <input className="ch-docname" placeholder="Tên chuỗi (vd: Karaoke cho kênh của tôi)" value={doc.name} maxLength={80}
            aria-label="Tên chuỗi" onChange={(e) => setDoc((d) => ({ ...d, name: e.target.value }))} />
          {doc.id ? <Badge kind={chainStore.doc?.dirty ? "warn" : "accent"}>{chainStore.doc?.dirty ? "Có thay đổi chưa lưu" : "Đã lưu"}</Badge> : <Badge>Bản nháp</Badge>}
          <Button small primary disabled={saving || !nodes.length} onClick={() => save(false)}>{saving ? "Đang lưu…" : "Lưu"}</Button>
          {doc.id && <Button small disabled={saving} onClick={() => save(true)}>Lưu thành bản mới</Button>}
          <Button small disabled={running} onClick={newChain}>Chuỗi mới</Button>
        </div>
        <div className="ch-toolbar">
          <Button small onClick={() => addNode({ kind: "input" }, center())}>+ File đầu vào</Button>
          <Button small onClick={() => { if (!paletteOpen) togglePalette(); }}>+ Tool</Button>
          <Button small onClick={() => addNode({ kind: "view" }, center())}>+ Xem kết quả</Button>
          <Button small onClick={loadDemo} disabled={!Object.keys(tools).length}>Sơ đồ ví dụ</Button>
          <Button small danger onClick={() => { setNodes([]); setEdges([]); }}>Xóa hết</Button>
          <span className="sb-grow" />
          <span className="sb-dim">Chọn tool ở bảng bên phải (bấm hoặc kéo thả) · kéo dây ra chỗ trống để được gợi ý · chỉ nối được khi khớp format</span>
          <Button primary disabled={running || !nodes.length} onClick={() => runChain()}>{running ? "Đang chạy…" : "▶ Chạy chuỗi"}</Button>
        </div>
        {msg && <Notice kind="danger">{msg}</Notice>}
        {info && <Notice kind="ok">{info}</Notice>}
        <div className="ch-canvas" onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
          onDrop={onDrop}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChangeAll}
            onConnect={onConnect} onConnectEnd={onConnectEnd} isValidConnection={isValidConnection} fitView colorMode="system"
            deleteKeyCode={["Delete", "Backspace"]} onPaneClick={() => setMenu(null)}
            onSelectionChange={({ nodes: sel }) => setSelId(sel.length === 1 ? sel[0].id : null)}>
            <Background />
            <Controls />
            <MiniMap pannable zoomable position="bottom-left" style={{ marginLeft: 56 }} />
          </ReactFlow>
          <ToolPalette client={client} tools={tools} open={paletteOpen} onToggle={togglePalette} follow={follow}
            onClearFollow={() => { setSelId(null); setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n))); }}
            onAdd={addFromPalette} onFavorites={setFavorites} />
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

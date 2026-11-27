// Sơ đồ trên trình nối chuỗi ⇄ định dạng chuỗi của core (chain.json — cùng định dạng chuỗi dựng sẵn).
// - graphToChain: khi LƯU — ô "File đầu vào" → input của chuỗi, mỗi node tool → một bước (theo thứ tự phụ thuộc),
//   ô "Xem kết quả" → output của chuỗi; tham số của node được ghi cố định vào bước.
// - chainToGraph: khi MỞ một chuỗi chưa có bố cục (chuỗi dựng sẵn) — dựng lại node/dây, xếp cột theo độ sâu; tham số
//   `$param.x` lấy giá trị mặc định của chuỗi.
import type { ChainDef, ToolDetail } from "@mediatool/api-client";
import { accepts } from "@mediatool/workspace";
import type { Edge, Node } from "@xyflow/react";

/** `name`: tên kỹ thuật giữ nguyên khi mở rồi lưu lại một chuỗi có sẵn; `label`: tên hiển thị người dùng đặt. */
type Data = Record<string, unknown> & { kind: "input" | "tool" | "view"; toolId?: string; params?: Record<string, unknown>; label?: string; name?: string };
type GNode = Node<Data>;

/** Tên kỹ thuật ngắn từ tên hiển thị: bỏ dấu, a-z0-9_, tối đa 3 từ đầu / 24 ký tự. */
const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .split(" ").slice(0, 3).join("_").slice(0, 24).replace(/_+$/g, "") || "file";

/** Định dạng hẹp nhất mà MỌI chỗ nhận đều chấp nhận (vd. nối vào `media` và `video` → `video`); không có thì lấy chỗ đầu. */
function narrowest(formats: string[]): string {
  const fs = [...new Set(formats.filter(Boolean))];
  return fs.find((f) => fs.every((t) => accepts(t, f))) ?? fs[0] ?? "file";
}

export class GraphError extends Error {}

export function graphToChain(nodes: GNode[], edges: Edge[], tools: Record<string, ToolDetail>): ChainDef {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const toolNodes = nodes.filter((n) => n.data.kind === "tool");
  if (!toolNodes.length) throw new GraphError("Chuỗi chưa có bước nào — thêm ít nhất một tool");
  for (const n of toolNodes) if (!tools[n.data.toolId!]) throw new GraphError(`Không có tool "${n.data.toolId}"`);

  // thứ tự bước: Kahn trên dây giữa các node tool
  const indeg = new Map(toolNodes.map((n) => [n.id, 0]));
  for (const e of edges) if (indeg.has(e.target) && indeg.has(e.source)) indeg.set(e.target, indeg.get(e.target)! + 1);
  const queue = toolNodes.filter((n) => indeg.get(n.id) === 0).sort((a, b) => a.position.x - b.position.x).map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of edges) {
      if (e.source !== id || !indeg.has(e.target)) continue;
      indeg.set(e.target, indeg.get(e.target)! - 1);
      if (indeg.get(e.target) === 0) queue.push(e.target);
    }
  }
  if (order.length !== toolNodes.length) throw new GraphError("Chuỗi có vòng lặp — dây nối không được quay ngược");
  const stepId = new Map(order.map((id, i) => [id, `s${i + 1}`]));

  // input của chuỗi: ô "File đầu vào" có nối vào tool
  const inputs: ChainDef["inputs"] = [];
  const inputName = new Map<string, string>();
  for (const n of nodes.filter((n) => n.data.kind === "input")) {
    const out = edges.filter((e) => e.source === n.id && stepId.has(e.target));
    if (!out.length) continue;
    let name = n.data.name || slug(n.data.label || `file_${inputs.length + 1}`);
    while (inputs.some((i) => i.name === name)) name += "_2";
    const fmt = narrowest(out.map((e) => tools[byId.get(e.target)!.data.toolId!]?.inputs?.find((i) => i.name === e.targetHandle)?.format ?? "file"));
    inputs.push({ name, format: fmt, description: n.data.label || `File đầu vào ${inputs.length + 1}`, required: true });
    inputName.set(n.id, name);
  }

  const ref = (e: Edge) => (inputName.has(e.source) ? `$input.${inputName.get(e.source)}` : `$${stepId.get(e.source)}.${e.sourceHandle}`);
  const steps: ChainDef["steps"] = order.map((id) => {
    const n = byId.get(id)!;
    const tool = tools[n.data.toolId!];
    const ins: Record<string, string | string[]> = {};
    for (const e of edges.filter((e) => e.target === id && (inputName.has(e.source) || stepId.has(e.source)))) {
      const multiple = tool.inputs?.find((i) => i.name === e.targetHandle)?.multiple;
      const r = ref(e);
      if (multiple) ins[e.targetHandle!] = [...((ins[e.targetHandle!] as string[]) ?? []), r];
      else ins[e.targetHandle!] = r;
    }
    const missing = (tool.inputs ?? []).filter((i) => i.required && !(i.name in ins)).map((i) => i.name);
    if (missing.length) throw new GraphError(`Bước "${tool.name}": chưa nối input bắt buộc ${missing.join(", ")}`);
    const params = Object.fromEntries(Object.entries(n.data.params ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ""));
    return { id: stepId.get(id)!, tool: tool.id, title: tool.name, inputs: ins, params };
  });

  // output của chuỗi: ô "Xem kết quả"; không có ô nào thì lấy mọi output của các bước cuối
  const outputs: ChainDef["outputs"] = {};
  const add = (base: string, step: string, handle: string, toolId: string) => {
    let name = /^[a-z][a-z0-9_]*$/.test(base) ? base : slug(base);
    while (name in outputs) name += "_2";
    const spec = tools[toolId]?.outputs?.find((o) => o.name === handle);
    outputs[name] = { from: `$${step}.${handle}`, format: spec?.format ?? "file", description: spec?.description ?? "" };
  };
  for (const v of nodes.filter((n) => n.data.kind === "view")) {
    const e = edges.find((e) => e.target === v.id && stepId.has(e.source));
    if (e) add(v.data.name || v.data.label || e.sourceHandle || "ket_qua", stepId.get(e.source)!, e.sourceHandle!, byId.get(e.source)!.data.toolId!);
  }
  if (!Object.keys(outputs).length) {
    const sinks = order.filter((id) => !edges.some((e) => e.source === id && stepId.has(e.target)));
    for (const id of sinks) for (const o of tools[byId.get(id)!.data.toolId!].outputs ?? []) add(o.name, stepId.get(id)!, o.name, byId.get(id)!.data.toolId!);
  }
  return { inputs, params: { type: "object", properties: {} }, steps, outputs };
}

export function chainToGraph(def: ChainDef): { nodes: GNode[]; edges: Edge[] } {
  const props = def.params?.properties ?? {};
  const resolve = (v: unknown): unknown => {
    if (typeof v === "string" && v.startsWith("$param.")) return props[v.slice(7)]?.default;
    return v;
  };
  const depth = new Map<string, number>();
  const srcOf = (r: string) => (r.startsWith("$input.") ? `in_${r.slice(7)}` : `st_${r.slice(1).split(".")[0]}`);
  for (const i of def.inputs) depth.set(`in_${i.name}`, 0);
  for (const s of def.steps) {
    const refs = Object.values(s.inputs).flat().filter((r) => typeof r === "string" && r.startsWith("$"));
    depth.set(`st_${s.id}`, 1 + Math.max(0, ...refs.map((r) => depth.get(srcOf(r)) ?? 0)));
  }
  const maxD = Math.max(0, ...depth.values());
  const col = new Map<number, number>();
  const pos = (d: number) => {
    const k = col.get(d) ?? 0;
    col.set(d, k + 1);
    return { x: d * 380, y: k * 300 };
  };
  const nodes: GNode[] = [];
  const edges: Edge[] = [];
  for (const i of def.inputs) nodes.push({ id: `in_${i.name}`, type: "mtInput", position: pos(0), data: { kind: "input", name: i.name, label: i.description || i.name } });
  for (const s of def.steps) {
    const params = Object.fromEntries(Object.entries(s.params ?? {}).map(([k, v]) => [k, resolve(v)]).filter(([, v]) => v !== undefined));
    nodes.push({ id: `st_${s.id}`, type: "mtTool", position: pos(depth.get(`st_${s.id}`)!), data: { kind: "tool", toolId: s.tool, params } });
    for (const [handle, v] of Object.entries(s.inputs)) {
      for (const r of [v].flat()) {
        if (typeof r !== "string" || !r.startsWith("$")) continue;
        const source = srcOf(r);
        edges.push({ id: `e_${source}_${s.id}_${handle}_${edges.length}`, source, sourceHandle: r.startsWith("$input.") ? "file" : r.split(".")[1], target: `st_${s.id}`, targetHandle: handle });
      }
    }
  }
  for (const [name, o] of Object.entries(def.outputs)) {
    const id = `out_${name}`;
    nodes.push({ id, type: "mtView", position: pos(maxD + 1), data: { kind: "view", name, label: o.description || name } });
    edges.push({ id: `e_${id}`, source: `st_${o.from.slice(1).split(".")[0]}`, sourceHandle: o.from.split(".")[1], target: id, targetHandle: "file" });
  }
  return { nodes, edges };
}

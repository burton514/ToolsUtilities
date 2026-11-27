// Danh sách chuỗi ở thanh điều hướng bên trái, dưới "Quy trình tự động" — quản lý như dự án:
// bản nháp (tự lưu trong trình duyệt), chuỗi của tôi (đã lưu lên máy chủ), chuỗi mẫu dựng sẵn (mở ra là bản sao).
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronRight, FileClock, Loader2, Pencil, Plus, Trash2, Workflow } from "lucide-react";
import type { MediaToolClient, ToolSummary } from "@mediatool/api-client";
import { chainStore, isEmpty, type WorkDoc } from "./chainStore";
import { favoritesFirst } from "./favorites";

const useStore = () => useSyncExternalStore(chainStore.subscribe, () => `${chainStore.current}|${chainStore.running}|${chainStore.savedTick}|${Object.values(chainStore.docs).map((d) => `${d.key}:${d.name}:${d.dirty ? 1 : 0}:${d.nodes.length}`).join(",")}`);

export function ChainNav({ client, onShow }: { client: MediaToolClient; onShow: () => void }) {
  useStore();
  const [saved, setSaved] = useState<ToolSummary[]>([]);
  const [showBuiltin, setShowBuiltin] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    client.listTools().then((ts) => setSaved(ts.filter((t) => t.kind === "chain"))).catch(() => undefined);
  }, [client]);
  useEffect(load, [load, chainStore.savedTick]);

  const running = chainStore.running;
  const guard = () => {
    if (!running) return true;
    alert("Chuỗi đang chạy — đợi chạy xong (hoặc mở lại chuỗi đó) rồi mới chuyển sang chuỗi khác.");
    return false;
  };
  const openKey = (key: string) => {
    if (key !== chainStore.current && !guard()) return;
    chainStore.open(key);
    onShow();
  };
  const openChain = (c: ToolSummary, copy: boolean) => {
    const key = `chain:${c.id}`;
    if (!copy && chainStore.docs[key]) return openKey(key); // đã có bản làm việc (có thể chưa lưu) → mở bản đó
    if (!guard()) return;
    chainStore.requestOpen(c.id, copy);
    onShow();
  };
  const newDraft = () => {
    if (!guard()) return;
    chainStore.newDraft();
    onShow();
  };

  const drafts = Object.values(chainStore.docs)
    .filter((d) => d.key.startsWith("draft:") && (!isEmpty(d) || d.key === chainStore.current))
    .sort((a, b) => b.updated - a.updated);
  const mine = favoritesFirst(saved.filter((c) => c.editable));
  const builtin = favoritesFirst(saved.filter((c) => !c.editable));

  const item = (key: string, label: string, opts: { dirty?: boolean; draft?: boolean; onOpen: () => void; actions?: JSX.Element }) => {
    const cur = key === chainStore.current;
    return (
      <li key={key} className={`cn-item ${cur ? "on" : ""}`}>
        <button className="cn-open" onClick={opts.onOpen} title={label} aria-current={cur ? "true" : undefined}>
          {cur && running ? <Loader2 size={13} className="cn-spin" /> : opts.draft ? <FileClock size={13} /> : <Workflow size={13} />}
          <span className="cn-name">{label}</span>
          {opts.dirty && <i className="cn-dot" title="Có thay đổi chưa lưu" />}
        </button>
        {opts.actions && <span className="cn-acts">{opts.actions}</span>}
      </li>
    );
  };

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    try {
      await fn();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="cn" aria-label="Danh sách chuỗi">
      <button className="cn-new" onClick={newDraft} disabled={running}><Plus size={13} /> Chuỗi mới</button>

      {!!drafts.length && <div className="cn-group">Bản nháp</div>}
      <ul className="cn-list">
        {drafts.map((d: WorkDoc) => item(d.key, d.name || "Chuỗi chưa đặt tên", {
          draft: true, onOpen: () => openKey(d.key),
          actions: (
            <button className="cn-btn" title="Bỏ bản nháp" aria-label={`Bỏ bản nháp ${d.name || ""}`} disabled={running && d.key === chainStore.current}
              onClick={() => { if (isEmpty(d) || confirm(`Bỏ bản nháp "${d.name || "Chuỗi chưa đặt tên"}"? Không khôi phục được.`)) chainStore.discard(d.key); }}>
              <Trash2 size={13} />
            </button>
          ),
        }))}
      </ul>

      {!!mine.length && <div className="cn-group">Chuỗi của tôi</div>}
      <ul className="cn-list">
        {mine.map((c) => item(`chain:${c.id}`, chainStore.docs[`chain:${c.id}`]?.name || c.name, {
          dirty: chainStore.docs[`chain:${c.id}`]?.dirty, onOpen: () => openChain(c, false),
          actions: (
            <>
              <button className="cn-btn" title="Đổi tên" aria-label={`Đổi tên ${c.name}`} disabled={busy === c.id}
                onClick={() => {
                  const name = prompt("Tên mới cho chuỗi:", c.name)?.trim();
                  if (name && name !== c.name) act(c.id, async () => { await client.updateChain(c.id, { name }); chainStore.renamed(c.id, name); });
                }}><Pencil size={13} /></button>
              <button className="cn-btn danger" title="Xóa chuỗi" aria-label={`Xóa ${c.name}`} disabled={busy === c.id || (running && chainStore.current === `chain:${c.id}`)}
                onClick={() => {
                  if (confirm(`Xóa chuỗi "${c.name}" khỏi máy chủ? Không khôi phục được.`)) act(c.id, async () => { await client.deleteChain(c.id); chainStore.deleted(c.id); });
                }}><Trash2 size={13} /></button>
            </>
          ),
        }))}
      </ul>

      {!!builtin.length && (
        <button className="cn-group cn-toggle" onClick={() => setShowBuiltin((v) => !v)} aria-expanded={showBuiltin}>
          {showBuiltin ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Chuỗi mẫu ({builtin.length})
        </button>
      )}
      {showBuiltin && (
        <ul className="cn-list">
          {builtin.map((c) => item(`builtin:${c.id}`, c.name, { onOpen: () => openChain(c, true) }))}
        </ul>
      )}
    </div>
  );
}

// Kho chuỗi đang làm trên trình nối — dùng chung giữa trình nối và danh sách chuỗi ở thanh bên trái.
// Mỗi chuỗi là một "dự án": bản nháp (chưa lưu lên máy chủ, key `draft:…`) hoặc bản làm việc của một chuỗi của tôi (key `chain:<id>`).
// Mọi thay đổi tự lưu vào trình duyệt ngay — bấm "Chuỗi mới", đổi tab, tải lại trang đều không mất. Lưu lên máy chủ = bấm Lưu.

export interface WorkDoc {
  key: string;
  name: string;
  summary?: string;
  /** id chuỗi trên máy chủ (chuỗi của tôi đã lưu) */
  chainId?: string;
  nodes: unknown[];
  edges: unknown[];
  /** có thay đổi chưa lưu lên máy chủ (chỉ có nghĩa với chuỗi đã lưu) */
  dirty?: boolean;
  updated: number;
}

const DOCS_KEY = "mediatool.chain.docs.v1";
const CURRENT_KEY = "mediatool.chain.current.v1";
const LEGACY_KEY = "mediatool.chain.v2";

const newKey = () => `draft:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const read = <T,>(k: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "null") as T | null;
  } catch {
    return null;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* hết chỗ / chế độ riêng tư: vẫn chạy được, chỉ không nhớ */
  }
};

/** Chuỗi rỗng (không node) — không đáng giữ làm bản nháp. */
export const isEmpty = (d: WorkDoc) => !d.nodes.length;

class ChainStore {
  docs: Record<string, WorkDoc> = {};
  current = "";
  /** trình nối đang chạy chuỗi — không cho đổi sang chuỗi khác giữa chừng */
  running = false;
  /** tăng khi danh sách chuỗi trên máy chủ đổi (lưu / đổi tên / xóa) */
  savedTick = 0;
  /** yêu cầu mở chuỗi trên máy chủ (từ thanh bên) — trình nối nhận và xử lý */
  pendingOpen: { chainId: string; copy: boolean } | null = null;
  private listeners = new Set<() => void>();

  constructor() {
    this.docs = read<Record<string, WorkDoc>>(DOCS_KEY) ?? {};
    this.current = read<string>(CURRENT_KEY) ?? "";
    const legacy = read<{ nodes: unknown[]; edges: unknown[]; doc?: { id?: string; name?: string; summary?: string; editable?: boolean } }>(LEGACY_KEY);
    if (legacy && !Object.keys(this.docs).length && legacy.nodes?.length) {
      // chuỗi đang mở ở bản trước (một ô nhớ duy nhất) → thành dự án đầu tiên
      const key = legacy.doc?.id && legacy.doc.editable ? `chain:${legacy.doc.id}` : newKey();
      this.docs[key] = { key, name: legacy.doc?.name ?? "", summary: legacy.doc?.summary, chainId: key.startsWith("chain:") ? legacy.doc!.id : undefined,
        nodes: legacy.nodes, edges: legacy.edges ?? [], updated: Date.now() };
      this.current = key;
    }
    if (!this.docs[this.current]) this.current = this.newDraft(false);
    this.persist();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  private emit() {
    for (const fn of this.listeners) fn();
  }
  private persist() {
    write(DOCS_KEY, this.docs);
    write(CURRENT_KEY, this.current);
  }

  get doc(): WorkDoc {
    return this.docs[this.current];
  }

  /** Tạo bản nháp trống và mở nó. Bản nháp đang mở mà rỗng thì dùng lại, không đẻ thêm. */
  newDraft(emit = true): string {
    const cur = this.docs[this.current];
    if (cur && cur.key.startsWith("draft:") && isEmpty(cur)) return cur.key;
    const key = newKey();
    this.docs[key] = { key, name: "", nodes: [], edges: [], updated: Date.now() };
    this.current = key;
    this.dropEmptyDrafts();
    if (emit) {
      this.persist();
      this.emit();
    }
    return key;
  }

  /** Bản nháp rỗng không phải cái đang mở thì bỏ (không làm rối danh sách). */
  private dropEmptyDrafts() {
    for (const [k, d] of Object.entries(this.docs)) if (k !== this.current && k.startsWith("draft:") && isEmpty(d)) delete this.docs[k];
  }

  open(key: string) {
    if (!this.docs[key] || key === this.current) return;
    this.current = key;
    this.dropEmptyDrafts();
    this.persist();
    this.emit();
  }

  /** Ghi nội dung đang làm (trình nối gọi mỗi khi sơ đồ / tên đổi). */
  save(patch: Partial<WorkDoc>, markDirty = true) {
    const d = this.docs[this.current];
    if (!d) return;
    Object.assign(d, patch, { updated: Date.now() });
    if (markDirty && d.chainId) d.dirty = true;
    this.persist();
    this.emit();
  }

  /** Mở / tạo bản làm việc cho chuỗi trên máy chủ. `copy` = chuỗi dựng sẵn → bản nháp sao chép. */
  adopt(doc: Omit<WorkDoc, "key" | "updated">, copy: boolean): string {
    let key: string;
    if (copy || !doc.chainId) {
      key = newKey();
      this.docs[key] = { ...doc, chainId: undefined, key, dirty: false, updated: Date.now() };
    } else {
      key = `chain:${doc.chainId}`;
      // đã có bản làm việc chưa lưu → giữ nguyên (không đè thay đổi của người dùng)
      if (!this.docs[key]) this.docs[key] = { ...doc, key, dirty: false, updated: Date.now() };
    }
    this.current = key;
    this.dropEmptyDrafts();
    this.persist();
    this.emit();
    return key;
  }

  /** Bản nháp vừa lưu lên máy chủ thành chuỗi `chainId` → đổi key, hết "chưa lưu". */
  saved(chainId: string, name: string) {
    const d = this.docs[this.current];
    if (!d) return;
    const key = `chain:${chainId}`;
    delete this.docs[this.current];
    this.docs[key] = { ...d, key, chainId, name, dirty: false, updated: Date.now() };
    this.current = key;
    this.savedTick++;
    this.persist();
    this.emit();
  }

  /** Bỏ một dự án khỏi máy (bản nháp: xóa hẳn; chuỗi đã lưu: bỏ bản làm việc). Đang mở thì chuyển sang bản nháp mới. */
  discard(key: string) {
    delete this.docs[key];
    if (key === this.current) {
      this.current = "";
      this.newDraft(false);
    }
    this.persist();
    this.emit();
  }

  renamed(chainId: string, name: string) {
    const d = this.docs[`chain:${chainId}`];
    if (d) d.name = name;
    this.savedTick++;
    this.persist();
    this.emit();
  }

  deleted(chainId: string) {
    this.savedTick++;
    this.discard(`chain:${chainId}`);
  }

  requestOpen(chainId: string, copy: boolean) {
    this.pendingOpen = { chainId, copy };
    this.emit();
  }

  setRunning(v: boolean) {
    this.running = v;
    this.emit();
  }

  touchSaved() {
    this.savedTick++;
    this.emit();
  }
}

export const chainStore = new ChainStore();

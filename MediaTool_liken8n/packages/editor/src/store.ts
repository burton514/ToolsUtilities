// Trạng thái editor + lịch sử undo/redo. Mọi thay đổi composition đều đi qua apply() (một đường lệnh duy nhất).
import { useSyncExternalStore } from "react";
import type { ResolvedLayer } from "@mediatool/api-client";
import { cloneLayer, compEnd, layerEnd, type Composition, type Layer } from "./model";

const AUTOSAVE_KEY = "mediatool.editor.autosave";

export type Platform = "none" | "tiktok" | "reels" | "shorts";

export interface ViewState {
  /** "fit" = vừa khung; số = tỉ lệ thật (1 = 100%) */
  zoom: number | "fit";
  panX: number;
  panY: number;
}

export interface Guides {
  grid: boolean; // lưới 1/3
  safe: boolean; // vùng an toàn chữ/hành động
  center: boolean; // đường tâm
  platform: Platform; // khung giao diện TikTok/Reels/Shorts
}

export interface EditorState {
  comp: Composition;
  /** lớp được chọn (lớp cuối là lớp "chính" mà inspector hiển thị) */
  selection: string[];
  selected: string | null;
  time: number;
  playing: boolean;
  rate: number; // tốc độ phát xem trước
  loop: boolean;
  snap: boolean;
  pxPerSec: number;
  view: ViewState;
  guides: Guides;
  /** thời gian đã giải mốc (engine trả về cùng khung xem trước) */
  resolved: Record<string, ResolvedLayer>;
  version: number;
}

export class EditorStore {
  state: EditorState;
  private past: Composition[] = [];
  private future: Composition[] = [];
  private lastMerge: { key: string; at: number } | null = null;
  private listeners = new Set<() => void>();
  private clipboard: Layer[] = [];

  constructor(initial: Composition) {
    let comp = initial;
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) comp = JSON.parse(saved);
    } catch {
      /* bỏ qua */
    }
    this.state = {
      comp, selection: [], selected: null, time: 0, playing: false, rate: 1, loop: false, snap: true, pxPerSec: 60,
      view: { zoom: "fit", panX: 0, panY: 0 }, guides: { grid: false, safe: false, center: false, platform: "none" }, resolved: {}, version: 0,
    };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
    this.listeners.forEach((l) => l());
  }

  set(patch: Partial<Omit<EditorState, "comp" | "version">>) {
    // giữ selection và selected khớp nhau
    if ("selected" in patch && !("selection" in patch)) patch = { ...patch, selection: patch.selected ? [patch.selected] : [] };
    if ("selection" in patch && !("selected" in patch)) patch = { ...patch, selected: patch.selection!.at(-1) ?? null };
    this.emit(patch);
  }

  /** Chọn lớp: additive (Ctrl/Shift) thì bật/tắt lớp đó trong vùng chọn. */
  select(id: string | null, additive = false) {
    if (!id) return this.set({ selection: [] });
    const sel = this.state.selection;
    if (additive) this.set({ selection: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] });
    else this.set({ selection: [id] });
  }

  /** Sửa composition. `merge`: các thay đổi liên tiếp cùng khóa (ví dụ đang kéo) gộp thành 1 bước undo. */
  apply(fn: (c: Composition) => Composition, merge?: string) {
    const now = Date.now();
    const merging = merge && this.lastMerge?.key === merge && now - this.lastMerge.at < 1500;
    if (!merging) {
      this.past.push(this.state.comp);
      if (this.past.length > 200) this.past.shift();
      this.future = [];
    }
    this.lastMerge = merge ? { key: merge, at: now } : null;
    const comp = fn(this.state.comp);
    comp.duration = Math.max(compEnd(comp), 1);
    const ids = new Set(comp.layers.map((l) => l.id));
    const selection = this.state.selection.filter((id) => ids.has(id));
    this.emit({ comp, selection, selected: selection.at(-1) ?? null });
    this.autosave();
  }

  updateLayer(id: string, patch: Partial<Layer> | ((l: Layer) => Partial<Layer>), merge?: string) {
    this.apply((c) => ({
      ...c,
      layers: c.layers.map((l) => (l.id === id ? ({ ...l, ...(typeof patch === "function" ? patch(l) : patch) } as Layer) : l)),
    }), merge);
  }

  /** Áp cùng thay đổi cho mọi lớp đang chọn (chỉnh hàng loạt). */
  updateSelected(patch: (l: Layer) => Partial<Layer>, merge?: string) {
    const sel = new Set(this.state.selection);
    this.apply((c) => ({ ...c, layers: c.layers.map((l) => (sel.has(l.id) ? ({ ...l, ...patch(l) } as Layer) : l)) }), merge);
  }

  deleteSelected(ripple = false) {
    const sel = new Set(this.state.selection);
    if (!sel.size) return;
    this.apply((c) => {
      const removed = c.layers.filter((l) => sel.has(l.id));
      let layers = c.layers.filter((l) => !sel.has(l.id));
      if (ripple) {
        // dồn các lớp phía sau lên lấp chỗ trống (kiểu ripple delete)
        const gapStart = Math.min(...removed.map((l) => l.start));
        const gap = Math.max(...removed.map(layerEnd)) - gapStart;
        layers = layers.map((l) => (l.start >= gapStart ? { ...l, start: +Math.max(gapStart, l.start - gap).toFixed(3) } : l));
      }
      return { ...c, layers };
    });
  }

  copy() {
    const sel = new Set(this.state.selection);
    this.clipboard = this.state.comp.layers.filter((l) => sel.has(l.id)).map((l) => structuredClone(l));
    return this.clipboard.length;
  }

  /** Dán tại playhead, giữ khoảng cách tương đối giữa các lớp đã chép. */
  paste() {
    if (!this.clipboard.length) return 0;
    const first = Math.min(...this.clipboard.map((l) => l.start));
    const copies = this.clipboard.map((l) => cloneLayer(l, +(this.state.time + (l.start - first)).toFixed(3)));
    this.apply((c) => ({ ...c, layers: [...c.layers, ...copies] }));
    this.set({ selection: copies.map((l) => l.id) });
    return copies.length;
  }

  undo() {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.state.comp);
    this.lastMerge = null;
    this.emit({ comp: prev });
    this.autosave();
  }

  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state.comp);
    this.lastMerge = null;
    this.emit({ comp: next });
    this.autosave();
  }

  canUndo = () => this.past.length > 0;
  canRedo = () => this.future.length > 0;

  replace(comp: Composition) {
    this.past.push(this.state.comp);
    this.future = [];
    this.emit({ comp, selection: [], selected: null, time: 0 });
    this.autosave();
  }

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private autosave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.state.comp));
      } catch {
        /* bỏ qua */
      }
    }, 400);
  }
}

export function useEditor<T>(store: EditorStore, select: (s: EditorState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.state));
}

// @mediatool/miniapp-sdk — hợp đồng giữa workspace (core UI) và mini app.
// Mini app CHỈ import gói này, @mediatool/ui và React. Mọi hàm của `ws` đều bất đồng bộ hoặc
// chỉ truyền dữ liệu serialize được, để sau này có thể chạy mini app trong iframe với cùng API.
import type { ComponentType } from "react";
import type { AssetRef, Job } from "@mediatool/api-client";

export type { AssetRef, Job } from "@mediatool/api-client";

export const SDK_VERSION = "0.1.0";

export interface MiniAppManifest {
  name: string;
  title: string;
  description: string;
  category: string;
  version: string;
  sdk: string;
  icon?: string;
  owners?: string[];
  accepts: { format: string; multiple?: boolean }[];
  layout?: "video" | "audio" | "compact";
  slots?: ("panel" | "toolbar" | "overlay" | "track" | "result")[];
  tools: string[];
  workflowSuggestions?: { title: string; prompt: string }[];
  related?: string[];
}

export interface ToolRunResult {
  /** outputs theo tên; asset là AssetRef, giá trị thường là chính giá trị đó */
  outputs: Record<string, any>;
  summary: string;
  warnings: string[];
  job: Job;
}

export interface TrackSpec {
  id: string;
  source: AssetRef;
  label?: string;
  editable?: boolean;
}

export interface Ws {
  input: {
    readonly current: AssetRef | null;
    onChange(cb: (a: AssetRef | null) => void): () => void;
  };
  player: {
    load(a: AssetRef): void;
    play(): void;
    pause(): void;
    seek(t: number): void;
    readonly time: number;
    onTime(cb: (t: number) => void): () => void;
    setTrackGain(trackId: string, gain: number): void;
    mute(trackId: string, muted: boolean): void;
  };
  timeline: {
    addTrack(t: TrackSpec): void;
    removeTrack(id: string): void;
    tracks(): TrackSpec[];
  };
  tools: {
    /** Chạy tool đã khai báo trong manifest.tools. Bước chạy tự hiện trên job bar. Lỗi → throw. */
    run(id: string, req?: { inputs?: Record<string, unknown>; params?: Record<string, unknown> }, opts?: { label?: string }): Promise<ToolRunResult>;
  };
  assets: {
    pick(opts?: { format?: string }): Promise<AssetRef | null>;
    url(a: AssetRef, download?: boolean): string;
    add(a: AssetRef, label?: string): void;
  };
  result: {
    show(a: AssetRef, opts?: { compareWith?: AssetRef | null }): void;
  };
  state: {
    /** Hook React: trạng thái riêng của mini app, lưu theo phiên làm việc. Chỉ gọi trong component. */
    use<T extends object>(initial: T): [T, (patch: Partial<T> | ((s: T) => Partial<T>)) => void];
    /** Đọc/ghi cùng trạng thái đó từ ngoài component (setup, toolbar). */
    get<T extends object>(): Partial<T>;
    set<T extends object>(patch: Partial<T>): void;
  };
  ui: {
    toast(message: string, kind?: "ok" | "warn" | "danger"): void;
    confirm(message: string): Promise<boolean>;
  };
  t(key: string, vars?: Record<string, string | number>): string;
}

export interface PanelProps {
  ws: Ws;
}

export interface ToolbarAction {
  id: string;
  /** Khóa chuỗi (strings/vi.json) hoặc chữ hiển thị */
  label: string;
  icon?: string;
  run(ws: Ws): void | Promise<void>;
}

export interface MiniAppDefinition {
  /** Chạy một lần sau khi người dùng chọn file input. */
  setup?(ws: Ws): void | Promise<void>;
  panel: ComponentType<PanelProps>;
  toolbar?: ToolbarAction[];
  overlay?: ComponentType<PanelProps>;
}

export function defineMiniApp(def: MiniAppDefinition): MiniAppDefinition {
  return def;
}

// ---------------------------------------------------------------- i18n
type Strings = Record<string, string>;
let active: Strings = {};

/** Workspace gọi khi mở mini app. Mini app không cần gọi. */
export function __setStrings(s: Strings) {
  active = s;
}

/** Lấy chuỗi giao diện theo khóa, thay {biến}. Thiếu khóa thì trả lại chính khóa. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = active[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

// Trạng thái của một phiên làm việc trong workspace + cài đặt `ws` (workspace API) cho mini app.
import { useSyncExternalStore } from "react";
import { isAssetRef, type AssetRef, type Job, type MediaToolClient, type OutputValue } from "@mediatool/api-client";
import { t as sdkT, type MiniAppManifest, type ToolRunResult, type TrackSpec, type Ws } from "@mediatool/miniapp-sdk";

export interface SessionAsset {
  ref: AssetRef;
  label: string;
  source: "input" | "output" | "upload";
}

export interface TrackState extends TrackSpec {
  gain: number;
  muted: boolean;
}

export interface JobView {
  id: string;
  toolId: string;
  label: string;
  status: Job["status"];
  progress: number;
  message: string;
  logs: string[];
  summary?: string;
  warnings?: string[];
  error?: string;
}

export interface Toast {
  id: number;
  message: string;
  kind?: "ok" | "warn" | "danger";
}

export interface SessionState {
  input: AssetRef | null;
  assets: SessionAsset[];
  tracks: TrackState[];
  jobs: JobView[];
  current: AssetRef | null;
  result: AssetRef | null;
  compare: AssetRef | null;
  mainGain: number;
  mainMuted: boolean;
  appState: Record<string, unknown>;
  toasts: Toast[];
}

const FORMAT_COMPAT: Record<string, string[]> = {
  media: ["video", "audio"],
  json: ["transcript", "timed_lyrics", "beat_grid", "scene_list", "time_ranges", "composition", "text_style", "voice"],
};

export function accepts(expected: string | null | undefined, actual: string): boolean {
  if (!expected || expected === "file" || expected === actual) return true;
  if ((FORMAT_COMPAT[expected] ?? []).includes(actual)) return true;
  // JSON chưa gắn loại (file .json người dùng tải lên) cắm được vào ô thuộc họ JSON; tool tự kiểm nội dung
  return actual === "json" && FORMAT_COMPAT.json.includes(expected);
}

export function toRef(a: { id?: string; asset_id?: string; format: string; filename?: string; size_bytes?: number }): AssetRef {
  return { asset_id: (a.asset_id ?? a.id)!, format: a.format, filename: a.filename, size_bytes: a.size_bytes };
}

export class Session {
  state: SessionState = {
    input: null, assets: [], tracks: [], jobs: [], current: null, result: null, compare: null,
    mainGain: 1, mainMuted: false, appState: {}, toasts: [],
  };
  mediaEl: HTMLMediaElement | null = null;
  private listeners = new Set<() => void>();
  private toastSeq = 0;

  constructor(
    readonly client: MediaToolClient,
    /** Tool được phép gọi. null = mọi tool (chế độ chạy một tool trong sandbox). */
    readonly allowedTools: string[] | null,
  ) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  set(patch: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>)) {
    const p = typeof patch === "function" ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  addAsset(ref: AssetRef, label: string, source: SessionAsset["source"]) {
    this.set((s) => (s.assets.some((a) => a.ref.asset_id === ref.asset_id) ? {} : { assets: [...s.assets, { ref, label, source }] }));
  }

  toast(message: string, kind?: Toast["kind"]) {
    const id = ++this.toastSeq;
    this.set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => this.set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 4500);
  }

  async upload(file: File, source: SessionAsset["source"] = "upload"): Promise<AssetRef> {
    const a = await this.client.uploadAsset(file);
    const ref = toRef(a);
    this.addAsset(ref, a.filename, source);
    return ref;
  }

  async setInput(file: File) {
    const ref = await this.upload(file, "input");
    this.set({ input: ref, current: ref });
    return ref;
  }

  private updateJob(id: string, patch: Partial<JobView> | ((j: JobView) => Partial<JobView>)) {
    this.set((s) => ({
      jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...(typeof patch === "function" ? patch(j) : patch) } : j)),
    }));
  }

  /** Theo dõi một job đã tạo: cập nhật job bar, chờ kết thúc, thêm output vào asset bin. */
  async track(job: Job, label: string): Promise<ToolRunResult> {
    this.set((s) => ({
      jobs: [{ id: job.id, toolId: job.tool_id, label, status: job.status, progress: 0, message: "", logs: [] }, ...s.jobs],
    }));
    const final = await this.client.waitJob(job.id, (ev) => {
      if (ev.event === "progress") this.updateJob(job.id, { progress: Number(ev.value ?? 0), message: String(ev.message || "") || undefined });
      else if (ev.event === "log") this.updateJob(job.id, (j) => ({ logs: [...j.logs.slice(-200), `[${ev.level}] ${ev.message}`] }));
      else if (ev.event === "status" || ev.event === "snapshot") this.updateJob(job.id, { status: ev.status as Job["status"] });
    });
    const outputs: Record<string, unknown> = {};
    for (const [name, v] of Object.entries(final.result?.outputs ?? {}) as [string, OutputValue][]) {
      if (Array.isArray(v)) {
        outputs[name] = v;
        v.forEach((r, i) => this.addAsset(r, `${final.tool_id} · ${name} ${i + 1}`, "output"));
      } else if (isAssetRef(v)) {
        outputs[name] = v;
        this.addAsset(v, `${final.tool_id} · ${name}`, "output");
      } else {
        outputs[name] = (v as { value: unknown }).value;
      }
    }
    this.updateJob(job.id, {
      status: final.status,
      progress: final.status === "succeeded" ? 1 : final.progress,
      summary: final.result?.summary,
      warnings: final.result?.warnings,
      error: final.error?.message,
    });
    if (final.status !== "succeeded") {
      const msg = final.error?.message ?? `Job ${final.status}`;
      this.toast(`${label}: ${msg}`, "danger");
      throw new Error(msg);
    }
    final.result?.warnings?.forEach((w) => this.toast(w, "warn"));
    return { outputs, summary: final.result?.summary ?? "", warnings: final.result?.warnings ?? [], job: final };
  }

  async runTool(id: string, req: { inputs?: Record<string, unknown>; params?: Record<string, unknown> } = {}, label?: string) {
    if (this.allowedTools && !this.allowedTools.includes(id)) {
      const msg = `Tool '${id}' chưa khai báo trong manifest.tools của mini app`;
      this.toast(msg, "danger");
      throw new Error(msg);
    }
    const inputs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(req.inputs ?? {})) {
      if (v == null) continue;
      inputs[k] = Array.isArray(v) ? v.map((x) => (isAssetRef(x) ? x.asset_id : x)) : isAssetRef(v) ? v.asset_id : v;
    }
    let job: Job;
    try {
      job = await this.client.submitJob(id, inputs, req.params ?? {});
    } catch (e) {
      const err = e as Error & { details?: { field: string; message: string }[] };
      const detail = err.details?.map((d) => `${d.field}: ${d.message}`).join("; ");
      this.toast(`${label ?? id}: ${err.message}${detail ? ` (${detail})` : ""}`, "danger");
      throw e;
    }
    return this.track(job, label ?? id);
  }

  cancel(jobId: string) {
    void this.client.cancelJob(jobId);
  }
}

export function useSession<T>(session: Session, select: (s: SessionState) => T): T {
  return useSyncExternalStore(session.subscribe, () => select(session.state));
}

/** Tạo `ws` cho một mini app. */
export function createWs(session: Session, _manifest: MiniAppManifest | null): Ws {
  const timeListeners = new Set<(t: number) => void>();
  const inputListeners = new Set<(a: AssetRef | null) => void>();
  let lastInput = session.state.input;
  session.subscribe(() => {
    if (session.state.input !== lastInput) {
      lastInput = session.state.input;
      inputListeners.forEach((f) => f(lastInput));
    }
  });
  const onTime = () => timeListeners.forEach((f) => f(session.mediaEl?.currentTime ?? 0));
  let bound: HTMLMediaElement | null = null;
  const bindTime = () => {
    if (bound === session.mediaEl) return;
    bound?.removeEventListener("timeupdate", onTime);
    bound = session.mediaEl;
    bound?.addEventListener("timeupdate", onTime);
  };

  return {
    input: {
      get current() {
        return session.state.input;
      },
      onChange(cb) {
        inputListeners.add(cb);
        return () => inputListeners.delete(cb);
      },
    },
    player: {
      load: (a) => session.set({ current: a }),
      play: () => void session.mediaEl?.play(),
      pause: () => session.mediaEl?.pause(),
      seek: (t) => {
        if (session.mediaEl) session.mediaEl.currentTime = t;
      },
      get time() {
        return session.mediaEl?.currentTime ?? 0;
      },
      onTime(cb) {
        bindTime();
        timeListeners.add(cb);
        return () => timeListeners.delete(cb);
      },
      setTrackGain: (id, gain) =>
        session.set((s) => (id === "main" ? { mainGain: gain } : { tracks: s.tracks.map((t) => (t.id === id ? { ...t, gain } : t)) })),
      mute: (id, muted) =>
        session.set((s) => (id === "main" ? { mainMuted: muted } : { tracks: s.tracks.map((t) => (t.id === id ? { ...t, muted } : t)) })),
    },
    timeline: {
      addTrack: (spec) =>
        session.set((s) => ({ tracks: [...s.tracks.filter((t) => t.id !== spec.id), { gain: 1, muted: false, ...spec }] })),
      removeTrack: (id) => session.set((s) => ({ tracks: s.tracks.filter((t) => t.id !== id) })),
      tracks: () => session.state.tracks.map(({ gain: _g, muted: _m, ...spec }) => spec),
    },
    tools: {
      run: (id, req, opts) => session.runTool(id, req, opts?.label),
    },
    assets: {
      pick: (opts) =>
        new Promise((resolve) => {
          const el = document.createElement("input");
          el.type = "file";
          if (opts?.format === "video") el.accept = "video/*";
          else if (opts?.format === "audio") el.accept = "audio/*";
          else if (opts?.format === "image") el.accept = "image/*";
          el.onchange = async () => {
            const f = el.files?.[0];
            resolve(f ? await session.upload(f) : null);
          };
          el.click();
        }),
      url: (a, download) => session.client.assetUrl(a.asset_id, download),
      add: (a, label) => session.addAsset(a, label ?? a.filename ?? a.asset_id, "output"),
    },
    result: {
      show: (a, opts) => session.set({ result: a, compare: opts?.compareWith ?? null, current: a }),
    },
    state: {
      use<T extends object>(initial: T) {
        const app = useSession(session, (s) => s.appState);
        const full = { ...initial, ...app } as T;
        const set = (patch: Partial<T> | ((s: T) => Partial<T>)) =>
          session.set((s) => {
            const prev = { ...initial, ...s.appState } as T;
            return { appState: { ...prev, ...(typeof patch === "function" ? patch(prev) : patch) } };
          });
        return [full, set];
      },
      get: <T extends object>() => session.state.appState as Partial<T>,
      set: (patch) => session.set((s) => ({ appState: { ...s.appState, ...patch } })),
    },
    ui: {
      toast: (m, k) => session.toast(m, k),
      confirm: async (m) => window.confirm(m),
    },
    t: sdkT,
  };
}

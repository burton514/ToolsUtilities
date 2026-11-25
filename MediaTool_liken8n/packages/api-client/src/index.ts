// Client HTTP cho MediaTool core (/v1). Mọi client (sandbox, desktop, web, mobile) dùng chung.
// MVP viết tay; sau này sinh tự động từ OpenAPI của core.

export interface AssetRef {
  asset_id: string;
  format: string;
  filename?: string;
  size_bytes?: number;
}

export interface Asset {
  id: string;
  format: string;
  filename: string;
  size_bytes: number;
  created_at: string;
  lineage?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
}

export interface FieldSpec {
  name: string;
  format: string | null;
  required: boolean;
  multiple: boolean;
  description: string;
  type?: string;
}

export type Status = { state: "available" } | { state: "unavailable"; reason: string };

export interface ToolSummary {
  id: string;
  category: string;
  name: string;
  summary: string;
  version: string | null;
  tool_status: string | null;
  tags: string[];
  status: Status;
  runtime: { ram_mb: number; gpu: string; heavy: boolean; profile: string; timeout_s: number } | null;
  inputs: FieldSpec[] | null;
  outputs: FieldSpec[] | null;
  has_docs: boolean;
  example_count: number;
}

export interface ToolDetail extends ToolSummary {
  manifest: {
    tool: Record<string, unknown>;
    examples: { title: string; inputs: Record<string, unknown>; params: Record<string, unknown> }[];
    [k: string]: unknown;
  } | null;
  params_schema: JsonSchema | null;
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  description?: string;
  title?: string;
  minimum?: number;
  maximum?: number;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  [k: string]: unknown;
}

export interface MiniAppEntry {
  name: string;
  manifest: Record<string, unknown>;
  status: Status;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type OutputValue = AssetRef | AssetRef[] | { value: unknown };

export interface JobResult {
  summary: string;
  warnings: string[];
  outputs: Record<string, OutputValue>;
  peak_ram_mb?: number | null;
}

export interface JobErrorInfo {
  kind: string;
  code: string;
  message: string;
  field?: string | null;
}

export interface Job {
  id: string;
  tool_id: string;
  status: JobStatus;
  inputs: unknown;
  params: unknown;
  progress: number;
  message: string;
  result: JobResult | null;
  error: JobErrorInfo | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobEvent {
  event: "snapshot" | "status" | "progress" | "log" | string;
  [k: string]: unknown;
}

export interface LayerBounds {
  id: string;
  /** góc trái trên + kích thước, theo tỉ lệ 0..1 của khung hình */
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export interface PreviewFrame {
  /** data:image/jpeg;base64,... */
  image: string;
  width: number;
  height: number;
  bounds: LayerBounds[];
  render_ms: number;
  /** thời gian đã giải mốc của từng lớp (engine tính, dùng để timeline hiển thị đúng) */
  resolved?: Record<string, ResolvedLayer>;
}

/** Một tham số của gói hiệu ứng (theo effect.toml). */
export interface EffectParam {
  key: string;
  label: string;
  type: "float" | "color";
  min: number;
  max: number;
  step?: number | null;
  default: number | string;
  unit?: string | null;
  hint?: string | null;
}

/** Gói hiệu ứng trong thư viện (library/effects/<id>). */
export interface EffectInfo {
  id: string;
  name: string;
  category: string;
  kind: "effect" | "transition";
  description: string;
  sample_radius: number;
  order: number;
  params: EffectParam[];
}

export interface ResolvedLayer {
  start: number;
  duration: number;
  animations: { kind: string; windows: [number, number][] }[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: { field: string; message: string }[] = [],
  ) {
    super(message);
  }
}

export const isAssetRef = (v: unknown): v is AssetRef =>
  typeof v === "object" && v !== null && "asset_id" in v && "format" in v;

export class MediaToolClient {
  readonly baseUrl: string;
  private token?: string;

  constructor(opts: { baseUrl?: string; token?: string } = {}) {
    this.baseUrl = (opts.baseUrl ?? "").replace(/\/$/, "");
    this.token = opts.token;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}`, ...extra } : extra;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: this.headers(body !== undefined ? { "Content-Type": "application/json" } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw await toError(res);
    const type = res.headers.get("content-type") ?? "";
    return (type.includes("json") ? res.json() : res.text()) as Promise<T>;
  }

  health = () => this.req<{ ok: boolean; version: string }>("GET", "/health");
  system = () => this.req<Record<string, unknown>>("GET", "/v1/system");
  listTools = async () => (await this.req<{ tools: ToolSummary[] }>("GET", "/v1/tools")).tools;
  getTool = (id: string) => this.req<ToolDetail>("GET", `/v1/tools/${id}`);
  toolDocs = (id: string) => this.req<string>("GET", `/v1/tools/${id}/docs`);
  listMiniApps = async () => (await this.req<{ miniapps: MiniAppEntry[] }>("GET", "/v1/miniapps")).miniapps;
  reloadRegistry = () => this.req<{ tools: number; miniapps: number }>("POST", "/v1/registry/reload");

  listAssets = async () => (await this.req<{ assets: Asset[] }>("GET", "/v1/assets")).assets;
  getAsset = (id: string) => this.req<Asset>("GET", `/v1/assets/${id}`);
  registerPath = (path: string, format?: string) => this.req<Asset>("POST", "/v1/assets/register", { path, format });

  async uploadAsset(file: Blob, filename?: string, format?: string): Promise<Asset> {
    const form = new FormData();
    if (format) form.append("format", format);
    form.append("file", file, filename ?? (file as File).name ?? "upload.bin");
    const res = await fetch(this.baseUrl + "/v1/assets", { method: "POST", headers: this.headers(), body: form });
    if (!res.ok) throw await toError(res);
    return res.json();
  }

  assetUrl(id: string, download = false): string {
    const q = new URLSearchParams();
    if (download) q.set("download", "1");
    if (this.token) q.set("token", this.token);
    const qs = q.toString();
    return `${this.baseUrl}/v1/assets/${id}/content${qs ? "?" + qs : ""}`;
  }

  /** Engine native render một khung hình của composition (JPEG) + khung bao từng lớp để chỉnh trên preview. */
  previewFrame = (composition: unknown, time: number, width: number, signal?: AbortSignal) =>
    fetch(this.baseUrl + "/v1/preview/frame", {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ composition, time, width }),
      signal,
    }).then(async (res) => {
      if (!res.ok) throw await toError(res);
      return res.json() as Promise<PreviewFrame>;
    });

  /** Gói hiệu ứng trong thư viện (tên, nhóm, tham số) — dùng để tự sinh giao diện. */
  listEffects = () => this.req<{ effects: EffectInfo[]; problems: string[] }>("GET", "/v1/library/effects");

  /** Chuẩn hóa bản dựng (dạng cũ → mới) + giải mốc thời gian bằng chính engine render. */
  prepareComposition = <T = unknown>(composition: unknown) => this.req<T>("POST", "/v1/composition/prepare", { composition });

  /** Dải ảnh thu nhỏ của video (engine native, có cache) — dùng làm nền clip trên timeline. */
  filmstripUrl(id: string, count: number, height: number, range?: [number, number]): string {
    const q = new URLSearchParams({ count: String(count), height: String(height) });
    if (range) {
      q.set("from", range[0].toFixed(3));
      q.set("to", range[1].toFixed(3));
    }
    if (this.token) q.set("token", this.token);
    return `${this.baseUrl}/v1/assets/${id}/filmstrip?${q}`;
  }

  /** Ảnh đại diện của video: một khung giữa video (engine native, có cache). */
  thumbnailUrl(id: string, height = 360): string {
    return this.filmstripUrl(id, 1, height);
  }

  /** Đỉnh sóng âm 0..1 (engine native, có cache). */
  peaks = (id: string, buckets: number) => this.req<{ buckets: number; peaks: number[] }>("GET", `/v1/assets/${id}/peaks?buckets=${buckets}`);

  listJobs = async () => (await this.req<{ jobs: Job[] }>("GET", "/v1/jobs")).jobs;
  getJob = (id: string) => this.req<Job>("GET", `/v1/jobs/${id}`);
  cancelJob = (id: string) => this.req<{ cancelled: boolean }>("POST", `/v1/jobs/${id}/cancel`);
  submitJob = (toolId: string, inputs: Record<string, unknown> = {}, params: Record<string, unknown> = {}) =>
    this.req<Job>("POST", `/v1/tools/${toolId}/jobs`, { inputs, params });
  runExample = (toolId: string, index: number, params?: Record<string, unknown>) =>
    this.req<Job>("POST", `/v1/tools/${toolId}/examples/${index}/jobs`, { params: params ?? {} });

  /** Theo dõi sự kiện của job qua SSE. Trả hàm để ngừng theo dõi. */
  watchJob(jobId: string, onEvent: (ev: JobEvent) => void): () => void {
    const url = `${this.baseUrl}/v1/jobs/${jobId}/events${this.token ? `?token=${encodeURIComponent(this.token)}` : ""}`;
    const es = new EventSource(url);
    const handler = (name: string) => (e: MessageEvent) => {
      try {
        onEvent({ ...(JSON.parse(e.data) as object), event: name } as JobEvent);
      } catch {
        /* bỏ qua dòng hỏng */
      }
    };
    for (const name of ["snapshot", "status", "progress", "log"]) es.addEventListener(name, handler(name) as EventListener);
    es.onerror = () => es.close(); // server đóng stream khi job xong
    return () => es.close();
  }

  /** Chờ job kết thúc. Trả job cuối cùng (không ném lỗi khi job failed). */
  waitJob(jobId: string, onEvent?: (ev: JobEvent) => void): Promise<Job> {
    return new Promise((resolve) => {
      let done = false;
      const finish = async () => {
        if (done) return;
        done = true;
        stop();
        resolve(await this.getJob(jobId));
      };
      const stop = this.watchJob(jobId, (ev) => {
        onEvent?.(ev);
        const status = (ev.status as string | undefined) ?? undefined;
        if (status && ["succeeded", "failed", "cancelled"].includes(status)) void finish();
      });
      // phòng khi SSE bị chặn: hỏi trạng thái định kỳ
      const timer = setInterval(async () => {
        if (done) return clearInterval(timer);
        const j = await this.getJob(jobId).catch(() => null);
        if (j && ["succeeded", "failed", "cancelled"].includes(j.status)) {
          clearInterval(timer);
          void finish();
        }
      }, 2000);
    });
  }
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json();
    const e = body?.error ?? {};
    return new ApiError(res.status, e.code ?? "HTTP_" + res.status, e.message ?? res.statusText, e.details ?? []);
  } catch {
    return new ApiError(res.status, "HTTP_" + res.status, res.statusText);
  }
}

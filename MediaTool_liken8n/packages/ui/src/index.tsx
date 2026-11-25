// @mediatool/ui — component dùng chung cho app, workspace, editor và mọi mini app.
import "./ui.css";
import { useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, Upload, XCircle } from "lucide-react";

export function Section({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-section">
      {title && <h4>{title}</h4>}
      {children}
    </section>
  );
}

export function Field({ label, value, hint, children }: { label: ReactNode; value?: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="mt-field">
      <span className="mt-label">
        <span>{label}</span>
        {value !== undefined && <span className="mt-value">{value}</span>}
      </span>
      {children}
      {hint && <span className="mt-hint">{hint}</span>}
    </label>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <div className="mt-hint">{children}</div>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  primary?: boolean; danger?: boolean; ghost?: boolean; small?: boolean; large?: boolean; block?: boolean;
  icon?: ReactNode; loading?: boolean;
};
export function Button({ primary, danger, ghost, small, large, block, icon, loading, className = "", children, disabled, ...rest }: BtnProps) {
  const cls = ["mt-btn", primary && "primary", danger && "danger", ghost && "ghost", small && "small", large && "large", block && "block", className]
    .filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 size={small ? 14 : 16} className="mt-spin" /> : icon}
      {children}
    </button>
  );
}

/** Nút chỉ có icon: bắt buộc có nhãn (aria-label + tooltip). */
export function IconButton({ label, on, small, className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; on?: boolean; small?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={on} className={["mt-iconbtn", on && "on", small && "small", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </button>
  );
}

export function Slider(props: {
  label: ReactNode; value: number; min: number; max: number; step?: number; unit?: string; hint?: ReactNode;
  format?: (v: number) => string; onChange: (v: number) => void;
}) {
  const shown = props.format ? props.format(props.value) : `${props.value}${props.unit ?? ""}`;
  return (
    <Field label={props.label} value={shown} hint={props.hint}>
      <input className="mt-slider" type="range" min={props.min} max={props.max} step={props.step ?? 1}
        value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </Field>
  );
}

export function Select<T extends string | number>(props: {
  label?: ReactNode; value: T; options: (T | { value: T; label: string })[]; hint?: ReactNode; onChange: (v: T) => void;
}) {
  const opts = props.options.map((o) => (typeof o === "object" ? o : { value: o, label: String(o) }));
  const sel = (
    <select className="mt-select" value={String(props.value)}
      onChange={(e) => {
        const found = opts.find((o) => String(o.value) === e.target.value);
        if (found) props.onChange(found.value);
      }}>
      {opts.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
    </select>
  );
  return props.label ? <Field label={props.label} hint={props.hint}>{sel}</Field> : sel;
}

export function Toggle({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; hint?: ReactNode; onChange: (v: boolean) => void }) {
  return (
    <div>
      <label className="mt-toggle">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {hint && <div className="mt-hint" style={{ marginLeft: 25 }}>{hint}</div>}
    </div>
  );
}

export function TextInput({ label, value, onChange, placeholder, hint }: { label?: ReactNode; value: string; placeholder?: string; hint?: ReactNode; onChange: (v: string) => void }) {
  const el = <input className="mt-input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
  return label ? <Field label={label} hint={hint}>{el}</Field> : el;
}

export function NumberInput({ label, value, onChange, min, max, step, hint }: { label?: ReactNode; value: number; min?: number; max?: number; step?: number; hint?: ReactNode; onChange: (v: number) => void }) {
  const el = <input className="mt-input" type="number" value={value} min={min} max={max} step={step ?? "any"} onChange={(e) => onChange(Number(e.target.value))} />;
  return label ? <Field label={label} hint={hint}>{el}</Field> : el;
}

export function TextArea({ label, value, onChange, rows = 6, placeholder, hint }: { label?: ReactNode; value: string; rows?: number; placeholder?: string; hint?: ReactNode; onChange: (v: string) => void }) {
  const el = <textarea className="mt-textarea" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
  return label ? <Field label={label} hint={hint}>{el}</Field> : el;
}

export function Badge({ kind, children }: { kind?: "ok" | "warn" | "danger" | "accent"; children: ReactNode }) {
  return <span className={`mt-badge ${kind ?? ""}`}>{children}</span>;
}

export function ProgressBar({ value, kind }: { value: number; kind?: "ok" | "danger" }) {
  return (
    <div className={`mt-progress ${kind ?? ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

export function Notice({ kind, children }: { kind?: "ok" | "warn" | "danger"; children: ReactNode }) {
  const Icon = kind === "ok" ? CheckCircle2 : kind === "warn" ? AlertTriangle : kind === "danger" ? XCircle : Info;
  return (
    <div className={`mt-notice ${kind ?? ""}`} role={kind === "danger" ? "alert" : "status"}>
      <Icon size={16} />
      <div>{children}</div>
    </div>
  );
}

export function Card({ children, onClick, className = "" }: { children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <div className={`mt-card ${onClick ? "clickable" : ""} ${className}`} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => onClick && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}>
      {children}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mt-pagehead">
      <div>
        <h1 className="mt-h1">{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div style={{ display: "flex", gap: 8 }}>{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-empty">
      {icon && <div className="mt-empty-icon">{icon}</div>}
      <b>{title}</b>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

/** Bảng "nhãn — giá trị" dễ đọc (ví dụ kết quả của tool thông tin video). */
export function KeyValueTable({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <table className="mt-kv">
      <tbody>
        {items.map((it, i) => (
          <tr key={i}><th scope="row">{it.label}</th><td>{it.value}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="mt-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} className={`mt-tab ${value === t.value ? "on" : ""}`} onClick={() => onChange(t.value)}>{t.label}</button>
      ))}
    </div>
  );
}

/** Vùng chọn / kéo thả file. */
export function Dropzone({ accept, label, hint, busy, onFile }: { accept?: string; label: ReactNode; hint?: ReactNode; busy?: boolean; onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className={`mt-drop ${over ? "over" : ""}`} role="button" tabIndex={0}
      onClick={() => !busy && ref.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
      {busy ? <Loader2 size={26} className="mt-spin" /> : <Upload size={26} />}
      <b>{busy ? "Đang tải lên…" : label}</b>
      {hint && <span className="mt-hint">{hint}</span>}
      <input ref={ref} type="file" hidden accept={accept} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
    </div>
  );
}

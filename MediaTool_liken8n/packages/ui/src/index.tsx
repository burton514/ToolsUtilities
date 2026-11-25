// @mediatool/ui — component dùng chung cho workspace, sandbox và mọi mini app.
import "./ui.css";
import type { ReactNode, ButtonHTMLAttributes } from "react";

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

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; danger?: boolean; small?: boolean; block?: boolean };
export function Button({ primary, danger, small, block, className = "", ...rest }: BtnProps) {
  const cls = ["mt-btn", primary && "primary", danger && "danger", small && "small", block && "block", className].filter(Boolean).join(" ");
  return <button type="button" className={cls} {...rest} />;
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
      {hint && <div className="mt-hint" style={{ marginLeft: 24 }}>{hint}</div>}
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
    <div className={`mt-progress ${kind ?? ""}`}>
      <div style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

export function Notice({ kind, children }: { kind?: "ok" | "warn" | "danger"; children: ReactNode }) {
  return <div className={`mt-notice ${kind ?? ""}`}>{children}</div>;
}

// Control dạng "dòng thuộc tính" gọn kiểu app dựng chuyên nghiệp (CapCut/Premiere): nhãn | điều khiển | ô số.
// Cùng tên/cùng props với @mediatool/ui nên mọi bảng trong editor (inspector, viền, bóng, hiệu ứng, chuyển động…)
// đổi giao diện một lần ở đây.
import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Info, RotateCcw } from "lucide-react";

const decimals = (step: number) => (step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step))));
const snap = (v: number, min: number, max: number, step: number) => {
  const s = Math.round((v - min) / step) * step + min;
  return +Math.min(max, Math.max(min, s)).toFixed(decimals(step));
};

/** Nhóm thuộc tính thu gọn được, có nút đặt lại (tùy chọn) và nút phụ ở đầu nhóm. */
export function Section({ title, children, onReset, actions, defaultOpen = true }: {
  title?: ReactNode; children: ReactNode; onReset?: () => void; actions?: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!title) return <section className="ip-sec"><div className="ip-sec-body">{children}</div></section>;
  return (
    <section className={`ip-sec ${open ? "" : "closed"}`}>
      <div className="ip-sec-head">
        <button className="ip-sec-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>{title}</span>
        </button>
        {actions}
        {onReset && <button className="ip-icon" title="Đặt lại" aria-label="Đặt lại" onClick={onReset}><RotateCcw size={13} /></button>}
      </div>
      {open && <div className="ip-sec-body">{children}</div>}
    </section>
  );
}

/** Một dòng: nhãn bên trái, điều khiển bên phải. Gợi ý hiện bằng biểu tượng ⓘ. */
export function Field({ label, hint, children, value }: { label: ReactNode; hint?: ReactNode; children: ReactNode; value?: ReactNode }) {
  return (
    <div className="ip-row">
      <span className="ip-label">
        <span className="ip-label-text">{label}</span>
        {hint && <span className="ip-hint" title={typeof hint === "string" ? hint : undefined}><Info size={11} /></span>}
      </span>
      <div className="ip-ctl">{children}{value !== undefined && <span className="ip-unit">{value}</span>}</div>
    </div>
  );
}

/** Ô số gọn: hiển thị dạng đã định dạng, bấm vào để gõ. */
function NumBox({ value, min, max, step, format, unit, onChange }: {
  value: number; min?: number; max?: number; step: number; format?: (v: number) => string; unit?: string; onChange: (v: number) => void;
}) {
  const [edit, setEdit] = useState<string | null>(null);
  const shown = format ? format(value) : `${+value.toFixed(decimals(step))}${unit ?? ""}`;
  const commit = () => {
    if (edit === null) return;
    const n = parseFloat(edit.replace(",", "."));
    if (Number.isFinite(n)) onChange(snap(n, min ?? -1e9, max ?? 1e9, step));
    setEdit(null);
  };
  return (
    <input className="ip-num" value={edit ?? shown} onFocus={(e) => { setEdit(String(+value.toFixed(decimals(step)))); requestAnimationFrame(() => e.target.select()); }}
      onChange={(e) => setEdit(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setEdit(null); (e.target as HTMLInputElement).blur(); }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
          onChange(snap(value + d, min ?? -1e9, max ?? 1e9, step));
          setEdit(null);
        }
      }} />
  );
}

/** Thanh trượt một dòng: kéo trên nhãn để chỉnh nhanh (Shift = chậm), ô số gõ trực tiếp, `trailing` cho nút keyframe. */
export function Slider(props: {
  label: ReactNode; value: number; min: number; max: number; step?: number; unit?: string; hint?: ReactNode;
  format?: (v: number) => string; onChange: (v: number) => void; trailing?: ReactNode;
}) {
  const { label, value, min, max, hint, format, unit, onChange, trailing } = props;
  const step = props.step ?? 1;
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min || 1)) * 100));
  const drag = useRef<{ x: number; v: number } | null>(null);
  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, v: value };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  return (
    <div className={`ip-row ip-slider ${trailing ? "has-trail" : ""}`}>
      <span className="ip-label ip-scrub" title="Kéo sang trái/phải để chỉnh (giữ Shift: chậm)"
        onPointerDown={scrub}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const k = (max - min) / (e.shiftKey ? 1200 : 240);
          onChange(snap(drag.current.v + (e.clientX - drag.current.x) * k, min, max, step));
        }}
        onPointerUp={() => (drag.current = null)}>
        <span className="ip-label-text">{label}</span>
        {hint && <span className="ip-hint" title={typeof hint === "string" ? hint : undefined}><Info size={11} /></span>}
      </span>
      <input className="ip-range" type="range" min={min} max={max} step={step} value={value} style={{ ["--p" as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))} />
      <NumBox value={value} min={min} max={max} step={step} format={format} unit={unit} onChange={onChange} />
      {trailing}
    </div>
  );
}

export function NumberInput({ label, value, onChange, min, max, step, hint, unit }: {
  label?: ReactNode; value: number; min?: number; max?: number; step?: number; hint?: ReactNode; unit?: string; onChange: (v: number) => void;
}) {
  const el = <NumBox value={value} min={min} max={max} step={step ?? 0.1} unit={unit} onChange={onChange} />;
  return label ? <Field label={label} hint={hint}><span className="ip-numwrap">{el}</span></Field> : <span className="ip-numwrap">{el}</span>;
}

export function Select<T extends string | number>(props: {
  label?: ReactNode; value: T; options: (T | { value: T; label: string })[]; hint?: ReactNode; onChange: (v: T) => void;
}) {
  const opts = props.options.map((o) => (typeof o === "object" ? o : { value: o, label: String(o) }));
  const sel = (
    <select className="ip-select" value={String(props.value)}
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
    <Field label={label} hint={hint}>
      <button role="switch" aria-checked={checked} className={`ip-switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><i /></button>
    </Field>
  );
}

export function TextInput({ label, value, onChange, placeholder, hint }: { label?: ReactNode; value: string; placeholder?: string; hint?: ReactNode; onChange: (v: string) => void }) {
  const el = <input className="ip-input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
  return label ? <Field label={label} hint={hint}>{el}</Field> : el;
}

export function TextArea({ value, onChange, rows = 3, placeholder }: { label?: ReactNode; value: string; rows?: number; placeholder?: string; hint?: ReactNode; onChange: (v: string) => void }) {
  return <textarea className="ip-textarea" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

/** Nhóm nút chọn một (segmented). */
export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label?: ReactNode }) {
  const el = (
    <div className="ip-seg" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} title={o.title} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
  return label ? <Field label={label}>{el}</Field> : el;
}

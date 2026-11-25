// Bố cục editor chỉnh được: thanh phân cách kéo được giữa thư viện | xem trước | bảng thuộc tính, và giữa phần trên | timeline.
// Mỗi vùng có kích thước tối thiểu; kích thước được nhớ (localStorage); bấm đúp thanh phân cách để về mặc định;
// dùng được bằng bàn phím (←/→, ↑/↓; Shift = bước lớn).
import { useCallback, useEffect, useState, type RefObject } from "react";
import { startDrag } from "./pointer";

const KEY = "mediatool.editor.layout";
export const LAYOUT_DEFAULT = { lib: 230, insp: 320, tl: 300 };
/** Kích thước tối thiểu của từng vùng (px). */
export const LAYOUT_MIN = { lib: 170, insp: 270, tl: 150, preview: 360, main: 240, libMax: 480, inspMax: 620 };

export type Layout = typeof LAYOUT_DEFAULT;

function load(): Layout {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v.lib === "number" && typeof v.insp === "number" && typeof v.tl === "number") return v;
  } catch {
    /* bỏ qua */
  }
  return { ...LAYOUT_DEFAULT };
}

/** Giới hạn từng kích thước theo khung hiện tại để vùng nào cũng không nhỏ hơn mức tối thiểu. */
const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), Math.max(a, b));

/**
 * Giới hạn kích thước để vùng nào cũng không nhỏ hơn mức tối thiểu. Vùng đang kéo (`changed`) chỉ lấy chỗ của khung
 * xem trước, không đẩy vùng khác; khi cửa sổ nhỏ lại thì bảng thuộc tính co trước, rồi đến thư viện.
 */
function clampLayout(l: Layout, root: HTMLElement | null, fixedH: number, changed?: keyof Layout): Layout {
  if (!root) return l;
  const W = root.clientWidth, H = root.clientHeight;
  let lib = clamp(l.lib, LAYOUT_MIN.lib, LAYOUT_MIN.libMax);
  let insp = clamp(l.insp, LAYOUT_MIN.insp, LAYOUT_MIN.inspMax);
  let over = lib + insp + LAYOUT_MIN.preview - W;
  if (over > 0) {
    if (changed === "lib") lib = Math.max(LAYOUT_MIN.lib, lib - over);
    else if (changed === "insp") insp = Math.max(LAYOUT_MIN.insp, insp - over);
    else {
      const take = Math.min(over, insp - LAYOUT_MIN.insp);
      insp -= take;
      over -= take;
      lib = Math.max(LAYOUT_MIN.lib, lib - over);
    }
  }
  const tl = clamp(l.tl, LAYOUT_MIN.tl, H - fixedH - LAYOUT_MIN.main);
  return { lib: Math.round(lib), insp: Math.round(insp), tl: Math.round(tl) };
}

/** Trạng thái bố cục + biến CSS để gắn lên `.ed-root`. `fixedH()`: tổng chiều cao thanh trên + chân trang. */
export function useLayout(root: RefObject<HTMLElement>, fixedH: () => number) {
  const [layout, setLayout] = useState<Layout>(load);
  const set = useCallback((patch: Partial<Layout>, persist = false) => {
    setLayout((cur) => {
      const keys = Object.keys(patch) as (keyof Layout)[];
      const next = clampLayout({ ...cur, ...patch }, root.current, fixedH(), keys.length === 1 ? keys[0] : undefined);
      if (persist) {
        try {
          localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          /* bỏ qua */
        }
      }
      return next;
    });
  }, [root, fixedH]);
  // cửa sổ đổi cỡ → giữ mọi vùng ≥ tối thiểu
  useEffect(() => {
    const fit = () => set({});
    fit();
    const ro = new ResizeObserver(fit);
    if (root.current) ro.observe(root.current);
    return () => ro.disconnect();
  }, [root, set]);
  const vars = { "--lib-w": `${layout.lib}px`, "--insp-w": `${layout.insp}px`, "--tl-h": `${layout.tl}px` } as React.CSSProperties;
  return { layout, set, vars };
}

/** Thanh phân cách kéo được. `value` là kích thước hiện tại; `toValue(ev)` đổi vị trí chuột thành kích thước mới. */
export function Splitter({ axis, value, toValue, onChange, onReset, label, className = "", style }: {
  axis: "x" | "y"; value: number; toValue: (ev: PointerEvent) => number; onChange: (v: number, done?: boolean) => void;
  onReset: () => void; label: string; className?: string; style?: React.CSSProperties;
}) {
  const [active, setActive] = useState(false);
  return (
    <div role="separator" aria-orientation={axis === "x" ? "vertical" : "horizontal"} aria-label={label} aria-valuenow={value}
      tabIndex={0} title={`${label} — kéo để chỉnh, bấm đúp để về mặc định`}
      className={`ed-split ${axis} ${active ? "active" : ""} ${className}`} style={style}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        setActive(true);
        document.body.classList.add(axis === "x" ? "ed-resizing-x" : "ed-resizing-y");
        let last = value;
        startDrag((ev) => {
          last = toValue(ev);
          onChange(last);
        }, () => {
          setActive(false);
          document.body.classList.remove("ed-resizing-x", "ed-resizing-y");
          onChange(last, true);
        });
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        const keys: Record<string, number> = axis === "x" ? { ArrowLeft: -step, ArrowRight: step } : { ArrowUp: -step, ArrowDown: step };
        if (e.key in keys) {
          e.preventDefault();
          onChange(value + keys[e.key], true);
        }
      }}>
      <span />
    </div>
  );
}

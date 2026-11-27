// Bảng chọn tool bên phải trình nối chuỗi. Chỉ có TOOL — chuỗi (dựng sẵn hay của tôi) là "dự án", mở ở thư viện Chuỗi đã lưu.
// Mọi thứ đọc từ registry của core qua API: nhóm, loại dữ liệu vào / ra, yêu thích — không có danh sách tool viết cứng ở đây.
// Bấm một tool để thêm (nếu đang chọn một node có output hợp thì tự nối tiếp sau node đó), hoặc kéo thả vào vị trí muốn đặt.
import { useMemo, useState } from "react";
import { ArrowRight, Link2, PanelRightClose, PanelRightOpen, Search, Star, X } from "lucide-react";
import type { MediaToolClient, ToolDetail } from "@mediatool/api-client";
import { accepts } from "@mediatool/workspace";
import { categoryOf, formatIcon, formatLabel, SourceLine } from "./meta";
import { favoritesFirst, StarButton } from "./favorites";

export const DRAG_TYPE = "application/x-mediatool-tool";

/** Node đang chọn để nối tiếp: tên hiển thị + các loại dữ liệu nó cho ra. */
export interface FollowFrom { label: string; formats: string[] }

/** Tool nhận được ít nhất một loại trong `formats` (file chưa rõ loại = nhận mọi tool có input). */
export const takesAny = (t: ToolDetail, formats: string[]) =>
  (t.inputs ?? []).some((i) => formats.some((f) => f === "file" || accepts(i.format ?? "file", f)));

function FormatSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="tp-select">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">Bất kỳ</option>
        {options.map((f) => <option key={f} value={f}>{formatLabel(f)}</option>)}
      </select>
    </label>
  );
}

export function ToolPalette({ client, tools, open, onToggle, follow, onClearFollow, onAdd, onFavorites }: {
  client: MediaToolClient;
  tools: Record<string, ToolDetail>;
  open: boolean;
  onToggle: () => void;
  follow: FollowFrom | null;
  onClearFollow: () => void;
  onAdd: (tool: ToolDetail) => void;
  onFavorites: (favorites: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [inF, setInF] = useState("");
  const [outF, setOutF] = useState("");
  const [useFollow, setUseFollow] = useState(true);

  const all = useMemo(() => Object.values(tools).filter((t) => (t.kind ?? "tool") === "tool"), [tools]);
  // giá trị của bộ lọc lấy từ chính dữ liệu: loại dữ liệu mà các tool dùng
  const fmts = (pick: (t: ToolDetail) => string[]) =>
    [...new Set(all.flatMap(pick))].filter(Boolean).sort((a, b) => formatLabel(a).localeCompare(formatLabel(b), "vi"));
  const inFormats = useMemo(() => fmts((t) => (t.inputs ?? []).map((i) => i.format ?? "file")), [all]);
  const outFormats = useMemo(() => fmts((t) => (t.outputs ?? []).map((o) => o.format ?? "")), [all]);

  const following = !!follow && useFollow;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((t) => {
      if (needle && !`${t.name} ${t.id} ${t.summary} ${t.tags.join(" ")}`.toLowerCase().includes(needle)) return false;
      // "nhận vào X": có input nhận được dữ liệu loại X (cùng quy tắc nối dây của trình nối)
      if (inF && !(t.inputs ?? []).some((i) => accepts(i.format ?? "file", inF))) return false;
      if (outF && !(t.outputs ?? []).some((o) => o.format === outF)) return false;
      if (following && !takesAny(t, follow!.formats)) return false;
      return true;
    });
  }, [all, q, inF, outF, following, follow]);
  const favorites = useMemo(() => favoritesFirst(shown.filter((t) => t.favorite != null)), [shown]);
  const groups = useMemo(() => {
    const g = new Map<string, ToolDetail[]>();
    for (const t of shown) if (t.favorite == null) g.set(t.category, [...(g.get(t.category) ?? []), t]);
    return [...g].sort((a, b) => categoryOf(a[0]).order - categoryOf(b[0]).order).map(([c, items]) => [c, favoritesFirst(items)] as const);
  }, [shown]);
  const filtered = !!(q || inF || outF);
  const reset = () => { setQ(""); setInF(""); setOutF(""); };

  if (!open) {
    return (
      <button className="tp-tab" onClick={onToggle} title="Mở bảng chọn tool" aria-label="Mở bảng chọn tool">
        <PanelRightOpen size={16} /><span>Tool</span>
      </button>
    );
  }

  const item = (t: ToolDetail) => (
    <li key={t.id}>
      <div className="tp-item" role="button" tabIndex={0} draggable title={`${t.summary}\n\nBấm để thêm · kéo thả vào vị trí muốn đặt`}
        onClick={() => onAdd(t)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAdd(t); } }}
        onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, t.id); e.dataTransfer.effectAllowed = "move"; }}>
        <span className="tp-icon" aria-hidden="true">{categoryOf(t.category).icon(16)}</span>
        <span className="tp-main">
          <span className="tp-name">{t.name}</span>
          <SourceLine sources={t.sources} max={1} />
          <span className="tp-io" aria-label={`Vào: ${(t.inputs ?? []).map((i) => formatLabel(i.format ?? "file")).join(", ") || "không"}; ra: ${(t.outputs ?? []).map((o) => formatLabel(o.format ?? "")).join(", ")}`}>
            {[...new Set((t.inputs ?? []).map((i) => i.format ?? "file"))].map((f) => <span key={`i${f}`} className="tp-fmt" title={`vào: ${formatLabel(f)}`}>{formatIcon(f, 12)}</span>)}
            <ArrowRight size={11} className="tp-arrow" />
            {[...new Set((t.outputs ?? []).map((o) => o.format ?? ""))].map((f) => <span key={`o${f}`} className="tp-fmt out" title={`ra: ${formatLabel(f)}`}>{formatIcon(f, 12)}</span>)}
            {t.runtime?.heavy && <span className="tp-tag warn" title="Chạy lâu / tốn RAM">nặng</span>}
          </span>
        </span>
        <StarButton client={client} tool={t} onChange={onFavorites} size={15} />
      </div>
    </li>
  );

  return (
    <aside className="tp" aria-label="Chọn tool">
      <div className="tp-head">
        <b>Thêm tool</b>
        <span className="sb-dim">{shown.length}/{all.length}</span>
        <button className="lib-btn" onClick={onToggle} title="Thu gọn" aria-label="Thu gọn bảng chọn tool"><PanelRightClose size={16} /></button>
      </div>

      <label className="tp-search">
        <Search size={14} aria-hidden="true" />
        <input placeholder="Tìm tool…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm tool" />
        {q && <button className="tp-clear" onClick={() => setQ("")} aria-label="Xóa tìm kiếm"><X size={13} /></button>}
      </label>

      {follow && (
        <button className={`tp-follow ${useFollow ? "on" : ""}`} aria-pressed={useFollow} onClick={() => setUseFollow((v) => !v)}
          title="Chỉ hiện tool nhận được output của node đang chọn; bấm tool sẽ tự nối dây">
          <Link2 size={14} />
          <span>Nối tiếp sau <b>{follow.label}</b></span>
          <span className="tp-follow-x" role="button" aria-label="Bỏ chọn node" onClick={(e) => { e.stopPropagation(); onClearFollow(); }}><X size={13} /></span>
        </button>
      )}

      <div className="tp-filters">
        <FormatSelect label="Nhận vào" value={inF} options={inFormats} onChange={setInF} />
        <FormatSelect label="Cho ra" value={outF} options={outFormats} onChange={setOutF} />
        {filtered && <button className="tp-reset" onClick={reset}>Bỏ lọc</button>}
      </div>

      <div className="tp-list">
        {!!favorites.length && (
          <section>
            <h5 className="tp-group fav"><Star size={12} /> Yêu thích</h5>
            <ul>{favorites.map(item)}</ul>
          </section>
        )}
        {groups.map(([c, items]) => (
          <section key={c}>
            <h5 className="tp-group">{categoryOf(c).icon(12)} {categoryOf(c).label}</h5>
            <ul>{items.map(item)}</ul>
          </section>
        ))}
        {!shown.length && (
          <div className="tp-empty">
            {following ? <>Không tool nào nhận được output của <b>{follow!.label}</b>{filtered ? " với bộ lọc này" : ""}.</> : "Không có tool khớp bộ lọc."}
            {(filtered || following) && <button className="tp-reset" onClick={() => { reset(); setUseFollow(false); }}>Xem tất cả tool</button>}
          </div>
        )}
      </div>
      <div className="tp-foot sb-dim">Bấm để thêm · kéo thả vào bảng nối</div>
    </aside>
  );
}

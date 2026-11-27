// Danh mục công cụ: thẻ theo nhóm, tìm kiếm, đánh sao. Mục "Yêu thích" đứng đầu; trong mỗi nhóm thứ đã đánh sao xếp trước.
import { useEffect, useMemo, useState } from "react";
import { Search, Star } from "lucide-react";
import type { MediaToolClient, ToolSummary } from "@mediatool/api-client";
import { Badge, Card, EmptyState, Notice, PageHeader } from "@mediatool/ui";
import { categoryOf, SourceLine } from "../meta";
import { applyFavorites, favoritesFirst, StarButton } from "../favorites";
import type { Route } from "../App";

export function Catalog({ client, go }: { client: MediaToolClient; go: (r: Route) => void }) {
  const [tools, setTools] = useState<ToolSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    client.listTools().then(setTools).catch((e) => setErr(e.message));
  }, [client]);

  const shown = useMemo(
    () => (tools ?? []).filter((t) => !q || `${t.name} ${t.summary} ${t.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase())),
    [tools, q],
  );
  const favorites = useMemo(() => favoritesFirst(shown.filter((t) => t.favorite != null)), [shown]);
  const groups = useMemo(() => {
    const m = new Map<string, ToolSummary[]>();
    shown.forEach((t) => m.set(t.category, [...(m.get(t.category) ?? []), t]));
    return [...m.entries()]
      .sort((a, b) => categoryOf(a[0]).order - categoryOf(b[0]).order)
      .map(([cat, items]) => [cat, favoritesFirst(items)] as const);
  }, [shown]);

  const card = (t: ToolSummary) => (
    <Card key={t.id} onClick={() => go({ page: "tool", id: t.id })} className="cat-card">
      <div className="cat-card-head">
        <div className="cat-icon">{categoryOf(t.category).icon(20)}</div>
        <span className="sb-row">
          {t.kind === "chain" && <Badge kind="accent">{t.editable ? "Chuỗi của tôi" : "Chuỗi"}</Badge>}
          {t.status.state !== "available" && <Badge kind="danger">Tạm ngưng</Badge>}
          <StarButton client={client} tool={t} onChange={(f) => setTools((ts) => ts && applyFavorites(ts, f))} />
        </span>
      </div>
      <h3 className="mt-h3">{t.name}</h3>
      <SourceLine sources={t.sources} />
      <p className="mt-dim cat-sum" title={t.summary}>{t.summary}</p>
    </Card>
  );

  return (
    <div className="sb-page">
      <PageHeader title="Công cụ" description="Chọn công cụ, đưa file vào và bấm Bắt đầu."
        actions={
          <label className="sb-search">
            <Search size={16} />
            <input placeholder="Tìm công cụ…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm công cụ" />
          </label>
        } />
      {err && <Notice kind="danger">Không kết nối được máy chủ MediaTool: {err}</Notice>}
      {tools && !shown.length && <EmptyState icon={<Search size={22} />} title="Không tìm thấy công cụ phù hợp" description="Thử từ khóa khác." />}
      {!!favorites.length && (
        <section className="cat-group">
          <h2 className="cat-title"><Star size={16} fill="currentColor" className="fav-title" /> Yêu thích</h2>
          <div className="cat-grid">{favorites.map(card)}</div>
        </section>
      )}
      {groups.map(([cat, items]) => (
        <section key={cat} className="cat-group">
          <h2 className="cat-title">{categoryOf(cat).icon(16)} {categoryOf(cat).label}</h2>
          <div className="cat-grid">{items.map(card)}</div>
        </section>
      ))}
    </div>
  );
}

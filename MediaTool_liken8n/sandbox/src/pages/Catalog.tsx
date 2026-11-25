// Danh mục công cụ: thẻ theo nhóm, tìm kiếm. Bấm thẻ để dùng ngay.
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { MediaToolClient, ToolSummary } from "@mediatool/api-client";
import { Badge, Card, EmptyState, Notice, PageHeader } from "@mediatool/ui";
import { categoryOf } from "../meta";
import type { Route } from "../App";

export function Catalog({ client, go }: { client: MediaToolClient; go: (r: Route) => void }) {
  const [tools, setTools] = useState<ToolSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    client.listTools().then(setTools).catch((e) => setErr(e.message));
  }, [client]);

  const groups = useMemo(() => {
    const m = new Map<string, ToolSummary[]>();
    (tools ?? [])
      .filter((t) => !q || `${t.name} ${t.summary} ${t.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase()))
      .forEach((t) => m.set(t.category, [...(m.get(t.category) ?? []), t]));
    return [...m.entries()].sort((a, b) => categoryOf(a[0]).order - categoryOf(b[0]).order);
  }, [tools, q]);

  return (
    <div className="sb-page">
      <PageHeader title="Công cụ" description="Mỗi công cụ làm một việc. Chọn công cụ, đưa file vào và bấm Bắt đầu."
        actions={
          <label className="sb-search">
            <Search size={16} />
            <input placeholder="Tìm công cụ…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm công cụ" />
          </label>
        } />
      {err && <Notice kind="danger">Không kết nối được máy chủ MediaTool: {err}</Notice>}
      {tools && !groups.length && <EmptyState icon={<Search size={22} />} title="Không tìm thấy công cụ phù hợp" description="Thử từ khóa khác." />}
      {groups.map(([cat, items]) => (
        <section key={cat} className="cat-group">
          <h2 className="cat-title">{categoryOf(cat).icon(16)} {categoryOf(cat).label}</h2>
          <div className="cat-grid">
            {items.map((t) => (
              <Card key={t.id} onClick={() => go({ page: "tool", id: t.id })} className="cat-card">
                <div className="cat-card-head">
                  <div className="cat-icon">{categoryOf(t.category).icon(20)}</div>
                  {t.status.state !== "available" && <Badge kind="danger">Tạm ngưng</Badge>}
                </div>
                <h3 className="mt-h3">{t.name}</h3>
                <p className="mt-dim">{t.summary}</p>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

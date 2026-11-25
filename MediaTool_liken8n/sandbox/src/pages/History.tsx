// Lịch sử xử lý: mọi lần chạy công cụ, trạng thái, kết quả.
import { useEffect, useState } from "react";
import { History as HistoryIcon } from "lucide-react";
import { isAssetRef, type AssetRef, type Job, type MediaToolClient, type ToolSummary } from "@mediatool/api-client";
import { EmptyState, PageHeader } from "@mediatool/ui";
import { PreviewModal } from "../AssetPreview";
import { StatusBadge, timeAgo } from "../meta";

export function History({ client }: { client: MediaToolClient }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [preview, setPreview] = useState<AssetRef | null>(null);
  useEffect(() => {
    const load = () => client.listJobs().then(setJobs).catch(() => setJobs([]));
    load();
    client.listTools().then(setTools).catch(() => undefined);
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [client]);
  const name = (id: string) => tools.find((t) => t.id === id)?.name ?? id;

  return (
    <div className="sb-page">
      <PageHeader title="Lịch sử xử lý" description="Các lần chạy công cụ gần đây. Bấm vào tên file kết quả để xem hoặc tải về." />
      {jobs && !jobs.length && <div className="mt-card"><EmptyState icon={<HistoryIcon size={22} />} title="Chưa có lần xử lý nào" /></div>}
      {!!jobs?.length && (
        <div className="mt-card hist" style={{ padding: 0 }}>
          <table className="hist-table">
            <thead><tr><th>Công cụ</th><th>Trạng thái</th><th>Kết quả</th><th>Thời gian</th></tr></thead>
            <tbody>
              {jobs.map((j) => {
                const outs = Object.values(j.result?.outputs ?? {}).flat().filter(isAssetRef);
                return (
                  <tr key={j.id}>
                    <td><b>{name(j.tool_id)}</b></td>
                    <td><StatusBadge status={j.status} /></td>
                    <td>
                      <div className="hist-summary">{j.result?.summary ?? j.error?.message ?? j.message}</div>
                      <div>{outs.map((a) => <button key={a.asset_id} className="sb-chip" onClick={() => setPreview(a)}>{a.filename}</button>)}</div>
                    </td>
                    <td className="mt-faint" title={new Date(j.created_at).toLocaleString("vi-VN")}>{timeAgo(j.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <PreviewModal client={client} asset={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

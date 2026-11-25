// Trang chủ: bắt đầu nhanh với các việc chính + hoạt động gần đây.
import { useEffect, useState } from "react";
import { ArrowRight, Clapperboard, FileSearch, Music4, Workflow } from "lucide-react";
import type { Job, MediaToolClient, ToolSummary } from "@mediatool/api-client";
import { Card, EmptyState, PageHeader } from "@mediatool/ui";
import { StatusBadge, timeAgo } from "../meta";
import type { Route } from "../App";

export function Home({ client, go }: { client: MediaToolClient; go: (r: Route) => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tools, setTools] = useState<ToolSummary[]>([]);
  useEffect(() => {
    client.listJobs().then((j) => setJobs(j.slice(0, 6))).catch(() => undefined);
    client.listTools().then(setTools).catch(() => undefined);
  }, [client]);
  const name = (id: string) => tools.find((t) => t.id === id)?.name ?? id;

  const actions: { title: string; desc: string; icon: JSX.Element; to: Route; tone: string }[] = [
    { title: "Dựng video", desc: "Ghép video, ảnh, chữ nghệ thuật, hiệu ứng trên timeline rồi xuất file.", icon: <Clapperboard size={22} />, to: { page: "editor" }, tone: "violet" },
    { title: "Xem thông tin video", desc: "Video dài bao lâu, nét cỡ nào, nặng bao nhiêu, có tiếng không.", icon: <FileSearch size={22} />, to: { page: "tool", id: "video_info" }, tone: "blue" },
    { title: "Tách âm thanh", desc: "Lấy riêng phần tiếng, hình và phụ đề từ một video.", icon: <Music4 size={22} />, to: { page: "tool", id: "video_demux" }, tone: "green" },
    { title: "Quy trình tự động", desc: "Nối nhiều công cụ thành một chuỗi chạy liền mạch.", icon: <Workflow size={22} />, to: { page: "chain" }, tone: "amber" },
  ];

  return (
    <div className="sb-page">
      <PageHeader title="Bạn muốn làm gì hôm nay?" description="Chọn một việc để bắt đầu. Mọi xử lý đều chạy trên máy chủ MediaTool của bạn." />
      <div className="home-actions">
        {actions.map((a) => (
          <Card key={a.title} onClick={() => go(a.to)} className={`home-action tone-${a.tone}`}>
            <div className="home-action-icon">{a.icon}</div>
            <h3 className="mt-h3">{a.title}</h3>
            <p className="mt-dim">{a.desc}</p>
            <span className="home-action-go">Bắt đầu <ArrowRight size={14} /></span>
          </Card>
        ))}
      </div>

      <div className="home-recent">
        <div className="home-recent-head">
          <h2 className="mt-h2">Gần đây</h2>
          {jobs.length > 0 && <button className="sb-link" onClick={() => go({ page: "history" })}>Xem tất cả</button>}
        </div>
        {jobs.length ? (
          <div className="mt-card" style={{ padding: 0 }}>
            {jobs.map((j) => (
              <div key={j.id} className="home-job">
                <div className="home-job-main">
                  <b>{name(j.tool_id)}</b>
                  <span className="mt-hint">{j.result?.summary ?? j.error?.message ?? j.message ?? ""}</span>
                </div>
                <StatusBadge status={j.status} />
                <span className="mt-faint home-job-time">{timeAgo(j.created_at)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-card"><EmptyState title="Chưa có hoạt động nào" description="Các lần xử lý của bạn sẽ hiện ở đây." /></div>
        )}
      </div>
    </div>
  );
}

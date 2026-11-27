// Dữ liệu hiển thị dùng chung: tên nhóm tiếng Việt, icon, trạng thái job, định dạng thời gian/dung lượng.
import type { ReactNode } from "react";
import {
  Activity, AudioLines, Braces, Captions, Clapperboard, File, FileText, FileVideo, Film, Image, Layers, ListVideo, MessageSquareText,
  Mic2, Music, Music2, Palette, Sparkles, Timer, Type, Video, Workflow, Wrench,
} from "lucide-react";
import type { JobStatus, SourceRef } from "@mediatool/api-client";
import { Badge } from "@mediatool/ui";

export const CATEGORY: Record<string, { label: string; icon: (size?: number) => ReactNode; order: number }> = {
  video: { label: "Video", icon: (s = 18) => <FileVideo size={s} />, order: 1 },
  audio: { label: "Âm thanh", icon: (s = 18) => <AudioLines size={s} />, order: 2 },
  music: { label: "Phân tích nhạc", icon: (s = 18) => <Music2 size={s} />, order: 3 },
  speech: { label: "Giọng nói", icon: (s = 18) => <Mic2 size={s} />, order: 4 },
  lyrics: { label: "Lời bài hát", icon: (s = 18) => <Captions size={s} />, order: 5 },
  karaoke: { label: "Karaoke", icon: (s = 18) => <Sparkles size={s} />, order: 6 },
  compose: { label: "Dựng hình", icon: (s = 18) => <Layers size={s} />, order: 7 },
  media: { label: "Tiện ích", icon: (s = 18) => <Wrench size={s} />, order: 8 },
  user: { label: "Chuỗi của tôi", icon: (s = 18) => <Workflow size={s} />, order: 0 },
};

export const categoryOf = (c: string) => CATEGORY[c] ?? { label: c, icon: (s = 18) => <Film size={s} />, order: 99 };
export const editorIcon = (s = 18) => <Clapperboard size={s} />;

const STATUS: Record<JobStatus, { label: string; kind?: "ok" | "warn" | "danger" | "accent" }> = {
  queued: { label: "Đang chờ" },
  running: { label: "Đang xử lý", kind: "accent" },
  succeeded: { label: "Hoàn tất", kind: "ok" },
  failed: { label: "Lỗi", kind: "danger" },
  cancelled: { label: "Đã hủy", kind: "warn" },
};
export const StatusBadge = ({ status }: { status: JobStatus }) => <Badge kind={STATUS[status].kind}>{STATUS[status].label}</Badge>;

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "vừa xong";
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}

export function fileSize(n?: number): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export const FORMAT_LABEL: Record<string, string> = {
  video: "video", audio: "âm thanh", image: "ảnh", subtitle: "phụ đề", json: "dữ liệu", media: "video hoặc âm thanh",
  file: "file", composition: "bản dựng", transcript: "lời phiên âm", timed_lyrics: "lời có thời gian",
  text: "văn bản", voice: "giọng đọc", beat_grid: "nhịp", scene_list: "danh sách cảnh", time_ranges: "khoảng thời gian",
  text_style: "kiểu chữ", font: "phông chữ", lut: "bảng màu LUT",
};
export const formatLabel = (f: string) => FORMAT_LABEL[f] ?? f;

/** Icon theo loại dữ liệu (format) — dùng ở bộ lọc, cổng nối, danh sách tool. Loại lạ → icon file chung. */
const FORMAT_ICON: Record<string, (s: number) => ReactNode> = {
  video: (s) => <Video size={s} />, audio: (s) => <AudioLines size={s} />, image: (s) => <Image size={s} />,
  subtitle: (s) => <Captions size={s} />, text: (s) => <FileText size={s} />, json: (s) => <Braces size={s} />,
  media: (s) => <Clapperboard size={s} />, composition: (s) => <Layers size={s} />, transcript: (s) => <MessageSquareText size={s} />,
  timed_lyrics: (s) => <Music size={s} />, voice: (s) => <Mic2 size={s} />, beat_grid: (s) => <Activity size={s} />,
  scene_list: (s) => <ListVideo size={s} />, time_ranges: (s) => <Timer size={s} />, text_style: (s) => <Type size={s} />,
  font: (s) => <Type size={s} />, lut: (s) => <Palette size={s} />,
};
export const formatIcon = (f: string, size = 14) => (FORMAT_ICON[f] ?? ((s: number) => <File size={s} />))(size);
export const ACCEPT: Record<string, string> = {
  video: "video/*", audio: "audio/*", image: "image/*", media: "video/*,audio/*",
  subtitle: ".srt,.vtt,.lrc,.ass,.ssa", text: ".txt,.md,text/plain", json: ".json,application/json", composition: ".json,application/json", voice: ".json,application/json", font: ".ttf,.otf,.woff,.woff2", lut: ".cube",
};

/** Nguồn của tool (repo) hiện cạnh tên: "chủ/repo · chủ/repo". Bấm mở repo ở tab mới, không kích hoạt thẻ / nút cha. */
export function SourceLine({ sources, max = 2, className = "" }: { sources?: SourceRef[]; max?: number; className?: string }) {
  if (!sources?.length) return null;
  const shown = sources.slice(0, max);
  const rest = sources.length - shown.length;
  return (
    <span className={`src-line ${className}`} title={sources.map((x) => x.name).join(" · ")}>
      {shown.map((x, i) => (
        <span key={x.name}>
          {i > 0 && <span className="src-sep"> · </span>}
          {x.url ? (
            <a href={x.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{x.name}</a>
          ) : x.name}
        </span>
      ))}
      {rest > 0 && <span className="src-sep"> +{rest}</span>}
    </span>
  );
}

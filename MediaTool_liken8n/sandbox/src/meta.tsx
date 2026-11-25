// Dữ liệu hiển thị dùng chung: tên nhóm tiếng Việt, icon, trạng thái job, định dạng thời gian/dung lượng.
import type { ReactNode } from "react";
import {
  AudioLines, Captions, Clapperboard, FileVideo, Film, Layers, Mic2, Music2, Sparkles, Wrench,
} from "lucide-react";
import type { JobStatus } from "@mediatool/api-client";
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
};
export const ACCEPT: Record<string, string> = { video: "video/*", audio: "audio/*", image: "image/*", media: "video/*,audio/*" };

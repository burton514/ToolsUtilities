// Yêu thích (đánh sao) tool / chuỗi — một nơi cho mọi trang: nút sao + sắp xếp "yêu thích lên đầu".
// Danh sách lưu trên máy chủ (/v1/favorites), không mất khi đổi trình duyệt / thiết bị.
import { useState } from "react";
import { Star } from "lucide-react";
import type { MediaToolClient, ToolSummary } from "@mediatool/api-client";

/** Đánh sao trước (theo thứ tự đánh sao), rồi tới phần còn lại theo tên. */
export function favoritesFirst<T extends Pick<ToolSummary, "favorite" | "name">>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const fa = a.favorite ?? null, fb = b.favorite ?? null;
    if (fa !== null && fb !== null) return fa - fb;
    if (fa !== null) return -1;
    if (fb !== null) return 1;
    return a.name.localeCompare(b.name, "vi");
  });
}

/** Nút sao: bấm để đánh / bỏ sao. Không mở thẻ cha (chặn lan sự kiện). */
export function StarButton({ client, tool, onChange, size = 18 }: {
  client: MediaToolClient;
  tool: Pick<ToolSummary, "id" | "name" | "favorite">;
  onChange: (favorites: string[]) => void;
  size?: number;
}) {
  const [busy, setBusy] = useState(false);
  const on = tool.favorite !== null && tool.favorite !== undefined;
  const label = on ? `Bỏ yêu thích "${tool.name}"` : `Đánh dấu yêu thích "${tool.name}"`;
  return (
    <button type="button" className={`fav-star ${on ? "on" : ""}`} aria-pressed={on} aria-label={label} title={label} disabled={busy}
      onKeyDown={(e) => e.stopPropagation()}  // Enter / Space trên nút sao không được mở thẻ cha
      onClick={async (e) => {
        e.stopPropagation();
        e.preventDefault();
        setBusy(true);
        try {
          onChange(await client.setFavorite(tool.id, !on));
        } finally {
          setBusy(false);
        }
      }}>
      <Star size={size} fill={on ? "currentColor" : "none"} />
    </button>
  );
}

/** Áp danh sách yêu thích mới (từ máy chủ) vào danh sách tool đang hiển thị. */
export function applyFavorites<T extends ToolSummary>(tools: T[], favorites: string[]): T[] {
  return tools.map((t) => ({ ...t, favorite: favorites.includes(t.id) ? favorites.indexOf(t.id) : null }));
}

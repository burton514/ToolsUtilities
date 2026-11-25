// Thư viện gói hiệu ứng (lấy từ core: GET /v1/library/effects). Một nguồn duy nhất cho bảng chọn hiệu ứng,
// danh sách hiệu ứng trong inspector và giao diện tham số tự sinh.
import { useEffect, useState } from "react";
import type { EffectInfo, MediaToolClient } from "@mediatool/api-client";

let cache: Promise<EffectInfo[]> | null = null;

export function useEffectLibrary(client: MediaToolClient): EffectInfo[] {
  const [list, setList] = useState<EffectInfo[]>([]);
  useEffect(() => {
    cache ??= client.listEffects().then((r) => r.effects).catch(() => {
      cache = null;
      return [];
    });
    let live = true;
    cache.then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, [client]);
  return list;
}

export const CATEGORY_LABEL: Record<string, string> = {
  look: "Bộ màu", film: "Phim", stylize: "Nghệ thuật", distort: "Biến dạng", light: "Ánh sáng", key: "Tách nền màu", transition: "Chuyển cảnh",
};

/** Màu đại diện cho thẻ hiệu ứng theo nhóm (chỉ để nhìn). */
export const CATEGORY_TONE: Record<string, string> = {
  look: "linear-gradient(135deg,#ff9a5a,#2dd4bf)", film: "linear-gradient(135deg,#a16207,#1c1917)", stylize: "linear-gradient(135deg,#f472b6,#6366f1)",
  distort: "linear-gradient(135deg,#22d3ee,#1e3a8a)", light: "linear-gradient(135deg,#fde68a,#f97316)", key: "linear-gradient(135deg,#22c55e,#064e3b)",
  transition: "linear-gradient(135deg,#a78bfa,#0f172a)",
};

/** Tham số mặc định của gói. */
export function defaultParams(e: EffectInfo): Record<string, number | string> {
  return Object.fromEntries(e.params.map((p) => [p.key, p.default as number | string]));
}

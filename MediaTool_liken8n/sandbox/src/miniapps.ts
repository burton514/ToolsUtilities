// Tự liệt kê mini app trong ../miniapps (bỏ qua thư mục bắt đầu bằng "_").
// MVP: Vite bundle chung với sandbox. Sau này: mỗi mini app build thành bundle riêng và nạp động.
import type { MiniAppDefinition, MiniAppManifest } from "@mediatool/miniapp-sdk";

const manifests = import.meta.glob<MiniAppManifest>("../../miniapps/*/manifest.json", { eager: true, import: "default" });
const strings = import.meta.glob<Record<string, string>>("../../miniapps/*/strings/vi.json", { eager: true, import: "default" });
const modules = import.meta.glob<MiniAppDefinition>("../../miniapps/*/index.tsx", { import: "default" });

export interface LocalMiniApp {
  name: string;
  manifest: MiniAppManifest;
  strings: Record<string, string>;
  load: () => Promise<MiniAppDefinition>;
}

const dirOf = (p: string) => p.split("/").slice(-2, -1)[0] ?? p.split("/").slice(-3, -2)[0];

export const localMiniApps: LocalMiniApp[] = Object.entries(manifests)
  .map(([path, manifest]) => {
    const dir = path.replace(/\/manifest\.json$/, "");
    const name = dirOf(path);
    return {
      name,
      manifest,
      strings: strings[`${dir}/strings/vi.json`] ?? {},
      load: modules[`${dir}/index.tsx`] ?? (async () => Promise.reject(new Error(`Thiếu ${dir}/index.tsx`))),
    };
  })
  .filter((m) => !m.name.startsWith("_"))
  .sort((a, b) => a.name.localeCompare(b.name));

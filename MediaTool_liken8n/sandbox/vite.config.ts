import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Core mặc định ở http://127.0.0.1:8787 (docker compose up). Đổi bằng biến MEDIATOOL_CORE.
const core = process.env.MEDIATOOL_CORE ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/v1": core, "/health": core },
    fs: { allow: [".."] }, // cho phép nạp mini app ở ../miniapps
  },
});

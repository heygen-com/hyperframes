import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// video.kuaibaoguang.cn's api/video-dashboard.php is shared-secret gated
// (?token=...) and sends no CORS headers, so the browser can't call it
// directly from this dev server's origin without baking the token into the
// client bundle. Proxying through Vite keeps VIDEO_API_TOKEN server-side —
// see .env.example over there for where that token comes from.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const videoApiBase = env.VIDEO_API_BASE || "https://video.kuaibaoguang.cn";
  const videoApiToken = env.VIDEO_API_TOKEN || "";

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5191,
      proxy: {
        "/video-api": {
          target: videoApiBase,
          changeOrigin: true,
          secure: true,
          rewrite: (path: string) => {
            const [, query = ""] = path.split("?");
            const params = new URLSearchParams(query);
            params.set("token", videoApiToken);
            return `/api/video-dashboard.php?${params.toString()}`;
          },
        },
      },
    },
  };
});

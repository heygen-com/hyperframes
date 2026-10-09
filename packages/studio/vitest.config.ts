import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    esbuild: { define: { "import.meta.hot": "undefined" } },
  }),
);

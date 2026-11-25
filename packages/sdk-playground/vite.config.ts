import { defineConfig } from "vite";
import path from "node:path";
import type { Plugin } from "vite";
import { createFsAdapter } from "../sdk/src/adapters/fs";
import { createCompositionApi } from "./src/compositionApi";

const COMP_ROOT = path.resolve(import.meta.dirname);

function compositionPlugin(): Plugin {
  const adapter = createFsAdapter({ root: COMP_ROOT });

  return {
    name: "hf-composition",
    configureServer(server) {
      const api = createCompositionApi(adapter, server.config.server);
      server.middlewares.use("/api/composition/versions", api.versions);
      server.middlewares.use("/api/composition", api.composition);
    },
  };
}

export default defineConfig({
  plugins: [compositionPlugin()],
});

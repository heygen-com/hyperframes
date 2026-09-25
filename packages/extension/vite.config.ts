import { resolve } from "node:path";

const source = (path: string) => resolve(import.meta.dirname, "src", path);

export default {
  resolve: {
    alias: {
      "@hyperframes/core/web-capture": resolve(
        import.meta.dirname,
        "../core/src/webCaptureContract.ts",
      ),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "chrome116",
    rollupOptions: {
      input: {
        background: source("background/index.ts"),
        offscreen: source("clipboard/offscreen.ts"),
        popup: source("popup/index.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/shared.js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
};

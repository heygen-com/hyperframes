import { resolve } from "node:path";

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
    emptyOutDir: false,
    sourcemap: true,
    target: "chrome116",
    lib: {
      entry: resolve(import.meta.dirname, "src/content/index.ts"),
      formats: ["iife"],
      name: "HyperFramesCaptureContent",
      fileName: () => "content.js",
    },
  },
};

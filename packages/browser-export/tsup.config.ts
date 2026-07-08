import { defineConfig } from "tsup";

export default defineConfig({
  // platform: "browser" makes the build FAIL if any node:* builtin sneaks in —
  // a compile-time guarantee that the whole package stays client-side runnable
  // (same pattern as @hyperframes/lint's browser entry).
  entry: { index: "src/index.ts" },
  format: ["esm"],
  outDir: "dist",
  target: "es2022",
  platform: "browser",
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
  external: ["mediabunny", "html-to-image"],
});

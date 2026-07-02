import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    outDir: "dist",
    target: "node22",
    platform: "node",
    bundle: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: true,
  },
  {
    // Browser-safe subset. platform: "browser" makes the build FAIL if any
    // node:* builtin sneaks into the rule engine — a compile-time guarantee
    // that @hyperframes/lint/browser stays client-side runnable.
    entry: { browser: "src/browser.ts" },
    format: ["esm"],
    outDir: "dist",
    target: "es2022",
    platform: "browser",
    bundle: true,
    splitting: false,
    sourcemap: true,
    clean: false,
    dts: true,
  },
]);

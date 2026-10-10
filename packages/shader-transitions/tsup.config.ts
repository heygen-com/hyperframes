import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs", "iife"],
  globalName: "HyperShader",
  noExternal: ["html2canvas"],
  dts: true,
  clean: true,
  minify: true,
});

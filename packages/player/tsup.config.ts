import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/hyperframes-player.ts", "src/slideshow/hyperframes-slideshow.ts"],
  format: ["esm", "cjs", "iife"],
  globalName: "HyperframesPlayer",
  dts: true,
  clean: true,
  minify: true,
  sourcemap: true,
});

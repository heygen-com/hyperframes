import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const packageVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))
  .version as string;

export default defineConfig({
  entry: ["src/hyperframes-player.ts", "src/slideshow/hyperframes-slideshow.ts"],
  format: ["esm", "cjs", "iife"],
  globalName: "HyperframesPlayer",
  noExternal: ["@hyperframes/core"],
  dts: true,
  clean: true,
  minify: true,
  sourcemap: true,
  define: {
    __HYPERFRAMES_RUNTIME_CDN_URL__: JSON.stringify(
      `https://cdn.jsdelivr.net/npm/@hyperframes/core@${packageVersion}/dist/hyperframe.runtime.iife.js`,
    ),
  },
});

import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const packageVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))
  .version as string;

export default defineConfig([
  {
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
  },
  // React bindings (`@hyperframes/player/react`). Built separately so react
  // stays external and the element itself is loaded via the package
  // self-reference at runtime — no IIFE build, and no `clean` (the first
  // config owns dist/ cleanup).
  {
    entry: { "react/index": "src/react/index.ts" },
    format: ["esm", "cjs"],
    // The bindings load the element via the package self-reference at
    // runtime; without this esbuild would inline the whole player bundle.
    external: ["@hyperframes/player"],
    dts: true,
    minify: true,
    sourcemap: true,
  },
]);

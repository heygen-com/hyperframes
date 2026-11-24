import { defineConfig } from "tsup";
import { copyFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const packageVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))
  .version as string;

const RUNTIME_FILE = "hyperframe.runtime.iife.js";
const coreDist = join(
  dirname(createRequire(import.meta.url).resolve("@hyperframes/core/package.json")),
  "dist",
);

const shared = {
  entry: ["src/hyperframes-player.ts", "src/slideshow/hyperframes-slideshow.ts"],
  globalName: "HyperframesPlayer",
  noExternal: ["@hyperframes/core"],
  minify: true,
  define: {
    __HYPERFRAMES_RUNTIME_CDN_URL__: JSON.stringify(
      `https://cdn.jsdelivr.net/npm/@hyperframes/core@${packageVersion}/dist/${RUNTIME_FILE}`,
    ),
  },
};

export default defineConfig([
  // An app's bundler takes the runtime from core, which the player depends on, as a chunk loaded only when needed.
  {
    ...shared,
    format: ["esm"],
    dts: true,
    clean: true,
    esbuildOptions: (options) => {
      options.external = [...(options.external ?? []), "@hyperframes/core/runtime-script"];
    },
  },
  {
    ...shared,
    format: ["cjs", "iife"],
    // These formats cannot split a chunk out, so the runtime stays a file beside them.
    esbuildOptions: (options) => {
      options.alias = {
        ...options.alias,
        "@hyperframes/core/runtime-script": "./src/runtime-beside-bundle.ts",
      };
      options.define = { ...options.define, "import.meta.url": "undefined" };
    },
    onSuccess: async () => copyFileSync(join(coreDist, RUNTIME_FILE), join("dist", RUNTIME_FILE)),
  },
]);

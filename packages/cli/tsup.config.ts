import { defineConfig } from "tsup";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  outDir: "dist",
  target: "node22",
  platform: "node",
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  banner: {
    js: `import { createRequire as __hf_createRequire } from "node:module";
import { fileURLToPath as __hf_fileURLToPath } from "node:url";
import { dirname as __hf_dirname } from "node:path";
const require = __hf_createRequire(import.meta.url);
const __filename = __hf_fileURLToPath(import.meta.url);
const __dirname = __hf_dirname(__filename);`,
  },
  external: [
    "puppeteer-core",
    "puppeteer",
    "@puppeteer/browsers",
    "open",
    "hono",
    "hono/*",
    "@hono/node-server",
    "cheerio",
    "mime-types",
    "adm-zip",
    "esbuild",
    "giget",
  ],
  noExternal: [
    "@hyperframes/core",
    "@hyperframes/producer",
    "@hyperframes/engine",
    "@clack/prompts",
    "@clack/core",
    "picocolors",
    "linkedom",
    "sisteransi",
    "is-unicode-supported",
    "citty",
  ],
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
  },
  esbuildOptions(options) {
    options.alias = {
      "@hyperframes/producer": resolve(__dirname, "../producer/src/index.ts"),
    };
  },
});

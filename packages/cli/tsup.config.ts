import { defineConfig } from "tsup";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    shaderTransitionWorker: "../producer/src/services/shaderTransitionWorker.ts",
  },
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
var require = __hf_createRequire(import.meta.url);
var __filename = __hf_fileURLToPath(import.meta.url);
var __dirname = __hf_dirname(__filename);`,
  },
  external: [
    "puppeteer-core",
    "puppeteer",
    "@puppeteer/browsers",
    // Native module — its platform binary (@img/sharp-<os>-<arch>) must be
    // resolved from node_modules at runtime, never bundled. Loaded lazily by
    // the capture pipeline; runtime resolution comes from the `dependencies`
    // entry in package.json.
    "sharp",
    "open",
    "hono",
    "hono/*",
    "@hono/node-server",
    "adm-zip",
    "esbuild",
    "giget",
    "postcss",
    // aws-lambda transitively pulls @aws-sdk/* + @smithy/* which include
    // .browser.js conditional exports esbuild can't bundle cleanly into
    // a node binary. Keep it external; the lambda subverb files dynamic-
    // import it only when the user runs `hyperframes lambda *`, so the
    // CLI's cold start doesn't load it. Runtime resolution comes from
    // @hyperframes/aws-lambda being a `dependencies` entry in package.json.
    "@hyperframes/aws-lambda",
    "@hyperframes/aws-lambda/sdk",
    // Same treatment for the GCP adapter: the cloudrun subverb files
    // dynamic-import `@hyperframes/gcp-cloud-run/sdk` only when the user runs
    // `hyperframes cloudrun *`. Keep it external; runtime resolution comes
    // from the `dependencies`/workspace entry, not the bundled CLI.
    "@hyperframes/gcp-cloud-run",
    "@hyperframes/gcp-cloud-run/sdk",
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
      // esbuild's alias map treats `@hyperframes/producer` as a file path
      // and would otherwise resolve `@hyperframes/producer/distributed`
      // to `../producer/src/index.ts/distributed` (treating the file as a
      // directory). Adding an explicit alias for every subpath we import
      // avoids the prefix-substitution misfire.
      "@hyperframes/producer/distributed": resolve(__dirname, "../producer/src/distributed.ts"),
      // Same reason: the lambda CLI imports `@hyperframes/aws-lambda/sdk`,
      // which would resolve to `../aws-lambda/src/index.ts/sdk` without
      // an explicit subpath alias. The SDK subpath has its own barrel.
      "@hyperframes/aws-lambda/sdk": resolve(__dirname, "../aws-lambda/src/sdk/index.ts"),
      // Same for the GCP adapter's SDK subpath barrel.
      "@hyperframes/gcp-cloud-run/sdk": resolve(__dirname, "../gcp-cloud-run/src/sdk/index.ts"),
      // hf#677 follow-up: the shader-blend worker imports from
      // `@hyperframes/engine/shader-transitions` (subpath export) — a
      // standalone TS file with zero internal imports that survives the
      // worker_thread loader boundary.
      "@hyperframes/engine/shader-transitions": resolve(
        __dirname,
        "../engine/src/utils/shaderTransitions.ts",
      ),
    };
    options.loader = { ...options.loader, ".browser.js": "text" };
  },
});

import { defineConfig } from "tsup";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { sourceAliases } from "../../scripts/package-subpaths.mjs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    runtimeVersion: "src/runtimeVersion.ts",
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
    "@hyperframes/gcp-cloud-run/terraform",
  ],
  noExternal: [
    "@hyperframes/core",
    "@hyperframes/parsers",
    "@hyperframes/studio-server",
    "@hyperframes/lint",
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
      // Exact subpaths are generated from the same contracts as package
      // exports, avoiding esbuild's root-alias prefix substitution trap.
      ...sourceAliases(resolve(__dirname, "../producer"), [".", "./distributed"]),
      ...sourceAliases(resolve(__dirname, "../engine"), [".", "./shader-transitions"]),
    };
    options.loader = { ...options.loader, ".browser.js": "text" };
  },
});

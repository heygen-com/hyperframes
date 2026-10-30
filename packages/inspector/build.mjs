// Builds the inspector for Node and for the page. Bun runs the TypeScript sources directly (package.json "bun").
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { rewriteRelativeImportExtensions } from "../../scripts/rewrite-relative-import-extensions.mjs";

const at = (path) => fileURLToPath(new URL(path, import.meta.url));
const { dependencies } = JSON.parse(readFileSync(at("./package.json"), "utf8"));
// Declared dependencies stay imports; the workspace's own sources (core, parsers) are bundled in.
const external = Object.keys(dependencies).filter((name) => !name.startsWith("@hyperframes/"));
// Bundled CommonJS dependencies call require(); an ES module has none until the banner defines it.
const banner = {
  js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
};
const node = { bundle: true, platform: "node", format: "esm", target: "node22", external, banner };

await Promise.all([
  build({ ...node, entryPoints: [at("./src/live.ts")], outfile: at("./dist/live.js") }),
  build({ ...node, entryPoints: [at("./src/service.ts")], outfile: at("./dist/service.js") }),
  build({
    ...node,
    entryPoints: [at("./src/server.ts")],
    outfile: at("./dist/server.js"),
    banner: { js: `#!/usr/bin/env node\n${banner.js}` },
    plugins: [
      {
        name: "external-service",
        setup(build) {
          build.onResolve({ filter: /^\.\/service$/ }, () => ({
            path: "./service.js",
            external: true,
          }));
        },
      },
    ],
  }),
  build({
    entryPoints: [at("./src/liveRuntime.ts")],
    outfile: at("./dist/inspection.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
  }),
]);
// Declarations keep the packages/ layout under dist/types, so their relative imports still resolve once packed.
rmSync(at("./dist/types"), { recursive: true, force: true });
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
execFileSync(process.execPath, [tsc, "-p", at("./tsconfig.types.json")], { stdio: "inherit" });
// tsc emits declarations for TypeScript only; the element map's JavaScript ships its own.
copyFileSync(at("./src/elementMap.d.ts"), at("./dist/types/inspector/src/elementMap.d.ts"));
rewriteRelativeImportExtensions(at("./dist/types"));

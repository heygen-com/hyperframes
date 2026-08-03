import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import { bundleToSingleHtml } from "../../packages/core/src/compiler/index.ts";

const [projectArg, outputArg] = process.argv.slice(2);

if (!projectArg || !outputArg) {
  console.error("Usage: bun scripts/docs/bundle-live-reference.mjs <project-dir> <output.html>");
  process.exit(1);
}

const projectDir = resolve(projectArg);
const outputPath = resolve(outputArg);
const bundledHtml = await bundleToSingleHtml(projectDir, { runtime: "inline" });
const relativeProjectRoot = relative(dirname(outputPath), projectDir).split(sep).join("/");
const baseHref = relativeProjectRoot ? `${relativeProjectRoot}/` : "./";
const html = bundledHtml
  .replace("<head>", `<head>\n    <base href="${baseHref}">`)
  .replace(/[ \t]+$/gm, "");

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, html);
console.log(`${outputPath} (${Buffer.byteLength(html).toLocaleString()} bytes)`);

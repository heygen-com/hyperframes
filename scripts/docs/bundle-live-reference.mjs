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
if (!bundledHtml.includes("<head>")) {
  console.error("Bundled output has no <head>; refusing to publish an embed with no <base>.");
  process.exit(1);
}

// Only the <base> is injected. Trailing whitespace is left alone: the bundle
// inlines the runtime, so a document-wide strip would also reach inside script
// template literals, where trailing spaces are data.
const html = bundledHtml.replace("<head>", `<head>\n    <base href="${baseHref}">`);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, html);
console.log(`${outputPath} (${Buffer.byteLength(html).toLocaleString()} bytes)`);

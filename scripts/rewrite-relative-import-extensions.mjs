#!/usr/bin/env node
// Every package whose JavaScript or declarations come out of tsc runs this on its output.
// tsc copies relative specifiers verbatim, so the extensionless `./types` that bundler
// resolution accepts in source would ship as-is, and strict Node ESM (a NodeNext consumer, or
// `node` itself for JavaScript) cannot resolve it. This adds `.js` or `/index.js` after emit.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RELATIVE_SPECIFIER_PATTERNS = [
  /(\bfrom\s*["'])(\.\.?\/[^"']+)(["'])/g,
  /(\bimport\s+["'])(\.\.?\/[^"']+)(["'])/g,
  /(\bimport\(\s*["'])(\.\.?\/[^"']+)(["']\s*\))/g,
];
const EXPLICIT_EXTENSION = /\.(?:[cm]?js|json|wasm|node)$/;

/**
 * Return the specifier Node ESM resolves to the same file, or undefined when nothing matches.
 * A declaration names the JavaScript it describes, so it resolves against declarations but gains `.js`.
 */
function resolveRelativeSpecifier(fromFile, specifier, emittedExtension) {
  if (EXPLICIT_EXTENSION.test(specifier)) return specifier;
  const target = resolve(dirname(fromFile), specifier);
  if (existsSync(`${target}${emittedExtension}`)) return `${specifier}.js`;
  if (existsSync(join(target, `index${emittedExtension}`))) return `${specifier}/index.js`;
  return undefined;
}

/**
 * Rewrite one emitted file. Declarations must resolve, since an unresolved one is a broken type
 * contract. JavaScript leaves an unresolved specifier alone: it may sit inside a string, and the
 * packed-manifest verifier still rejects a real extensionless import.
 */
function rewriteRelativeImports(file, source) {
  const declaration = file.endsWith(".d.ts");
  return RELATIVE_SPECIFIER_PATTERNS.reduce(
    (text, pattern) =>
      text.replace(pattern, (whole, open, specifier, close) => {
        const resolved = resolveRelativeSpecifier(file, specifier, declaration ? ".d.ts" : ".js");
        if (resolved) return open + resolved + close;
        if (declaration) throw new Error(`${file} imports ${specifier}, which has no declaration`);
        return whole;
      }),
    source,
  );
}

const EMITTED_FILE = /\.(?:js|d\.ts)$/;

function rewriteEmittedFile(file) {
  const source = readFileSync(file, "utf8");
  const rewritten = rewriteRelativeImports(file, source);
  if (rewritten === source) return false;
  writeFileSync(file, rewritten);
  return true;
}

export function rewriteRelativeImportExtensions(dir) {
  return readdirSync(dir, { recursive: true })
    .map((entry) => join(dir, entry))
    .filter((file) => EMITTED_FILE.test(file))
    .filter(rewriteEmittedFile).length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? "dist");
  const changedFiles = rewriteRelativeImportExtensions(dir);
  console.log(JSON.stringify({ event: "relative_import_extensions_rewritten", dir, changedFiles }));
}

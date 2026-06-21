import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";

const distDir = resolve(import.meta.dirname, "../dist");
const runtimeExtensions = new Set([".js", ".mjs", ".cjs", ".json", ".wasm", ".node"]);

function listJavaScriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listJavaScriptFiles(fullPath));
    } else if (entry.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

function hasRuntimeExtension(specifier: string): boolean {
  return runtimeExtensions.has(extname(specifier));
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function resolveExistingJsSpecifier(fromFile: string, specifier: string): string | undefined {
  const absolute = resolve(dirname(fromFile), specifier);
  const jsFile = `${absolute}.js`;
  const indexFile = join(absolute, "index.js");

  if (existsSync(jsFile)) return `${specifier}.js`;
  if (existsSync(indexFile)) return `${specifier}/index.js`;
}

function resolveRuntimeSpecifier(fromFile: string, specifier: string): string {
  if (!isRelativeSpecifier(specifier)) return specifier;
  if (hasRuntimeExtension(specifier)) return specifier;

  return resolveExistingJsSpecifier(fromFile, specifier) ?? specifier;
}

function rewriteSpecifiers(filePath: string, source: string): string {
  const patterns = [
    /(from\s+["'])(\.\.?\/[^"']+)(["'])/g,
    /(import\s+["'])(\.\.?\/[^"']+)(["'])/g,
    /(import\(\s*["'])(\.\.?\/[^"']+)(["']\s*\))/g,
  ];

  return patterns.reduce(
    (nextSource, pattern) =>
      nextSource.replace(pattern, (_match, prefix: string, specifier: string, suffix: string) => {
        return `${prefix}${resolveRuntimeSpecifier(filePath, specifier)}${suffix}`;
      }),
    source,
  );
}

let changed = 0;
for (const filePath of listJavaScriptFiles(distDir)) {
  const source = readFileSync(filePath, "utf8");
  const rewritten = rewriteSpecifiers(filePath, source);
  if (rewritten !== source) {
    writeFileSync(filePath, rewritten);
    changed += 1;
  }
}

console.log(
  JSON.stringify({
    event: "core_esm_extensions_rewritten",
    distDir: normalize(distDir),
    changedFiles: changed,
  }),
);

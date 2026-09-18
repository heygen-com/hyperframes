import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveDocsRoot(argv2) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  return { root, docs: path.resolve(argv2 || path.join(root, "docs")) };
}

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function readCatalogGalleryData(docs) {
  const raw = fs.readFileSync(path.join(docs, "snippets/catalog-gallery-data.mdx"), "utf8");
  return JSON.parse(raw.replace(/^export const catalogGalleryData = /, "").replace(/;\s*$/, ""));
}

export function getCatalogTab(config) {
  return config.navigation.tabs.find((t) => t.tab === "Catalog");
}

// Same output as packages/core/src/tokenSlug.ts's slugify, minus its CSS-variable-name
// fallback: a character-scan trim instead of /^-+|-+$/, which CodeQL flags as polynomial
// ReDoS (js/polynomial-redos) on adversarial input.
export function slug(s) {
  const collapsed = s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === "-") start++;
  while (end > start && collapsed[end - 1] === "-") end--;
  return collapsed.slice(start, end);
}

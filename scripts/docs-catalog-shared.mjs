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
// fallback. Collapsing every run of non-alphanumeric characters to one "-" first means a
// leading or trailing "-" can only ever be a single character, so trimming it needs no
// quantifier — unlike /^-+|-+$/, which CodeQL flags as polynomial ReDoS (js/polynomial-redos)
// on adversarial input.
export function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "");
}

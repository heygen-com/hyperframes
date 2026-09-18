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

// A composition is eligible for live preview the same way the gallery's own inventory
// decides it: a paused GSAP timeline registered for seeking, not itself mounting a further
// sub-composition. The one place that names the real cause instead of going silent.
export function previewGap(html) {
  if (/navigator\.gpu/.test(html)) return "webgpu";
  if (/data-composition-src=/.test(html)) return "nested-composition";
  if (!/__timelines\[/.test(html)) return "no-timeline";
  return null;
}

// Same output as packages/core/src/tokenSlug.ts's slugify, minus its CSS-variable fallback.
// Collapsing every non-alphanumeric run to one "-" first means the trim needs no quantifier,
// avoiding the polynomial-ReDoS CodeQL flags on /^-+|-+$/ (js/polynomial-redos).
export function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "");
}

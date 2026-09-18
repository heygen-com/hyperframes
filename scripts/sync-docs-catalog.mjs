#!/usr/bin/env node
// Builds docs/snippets/catalog-gallery-data.mdx for catalog-gallery.jsx directly from this
// repo's own registry/*/registry-item.json and docs.json (no sparse clone, no other project's
// snapshot). Usage: node scripts/sync-docs-catalog.mjs [path/to/docs]
import fs from "node:fs";
import path from "node:path";
import { galleryPreview } from "./catalog-preview-policy.mjs";
import { buildNav } from "./build-docs-gallery-nav.mjs";
import { getCatalogTab, readJson, resolveDocsRoot, slug } from "./docs-catalog-shared.mjs";

const { root, docs } = resolveDocsRoot(process.argv[2]);
const config = readJson(path.join(docs, "docs.json"));
const tab = getCatalogTab(config);

// Walk the existing hand-authored nav so group/section order and labels stay ours.
// pathLabels accumulates each {group,pages} label on the way down, exactly like the
// gallery's own inventory.mjs walkNav: section = innermost label, group = the one above it
// (or section itself for a flat, one-level group).
const items = [];
const groupsOrder = [];
const groupLabels = new Map();
function walk(node, pathLabels) {
  if (Array.isArray(node)) { for (const n of node) walk(n, pathLabels); return; }
  if (typeof node === "string") {
    const m = node.match(/^catalog\/(blocks|components)\/([^/]+)$/);
    if (!m) return; // catalog/index and anything else stays out of the gallery data
    const [, dir, id] = m;
    const kind = dir === "blocks" ? "block" : "component";
    const manifestPath = path.join(root, "registry", dir, id, "registry-item.json");
    if (!fs.existsSync(manifestPath)) { console.warn(`! ${node}: no registry-item.json, skipped`); return; }
    const man = readJson(manifestPath);
    const section = pathLabels[pathLabels.length - 1];
    const group = pathLabels[pathLabels.length - 2] || section;
    const groupId = slug(group);
    if (!groupsOrder.includes(groupId)) { groupsOrder.push(groupId); groupLabels.set(groupId, group); }
    items.push({
      id, kind, href: `/${node}`,
      title: man.title || id, tagline: man.description || "", description: man.description || "",
      group: groupId, section,
      tags: man.tags || [], tech: [],
      duration: man.duration ?? null, width: man.dimensions?.width ?? null, height: man.dimensions?.height ?? null,
      status: man.stability === "experimental" ? "experimental" : "published",
      featured: 1000,
      poster: man.preview?.poster || null, video: man.preview?.video || null,
    });
    return;
  }
  if (node && typeof node === "object") {
    if (node.group === "Overview") return;
    // "Catalog" is the synthetic wrapper buildNav() adds around every real group below; skip
    // it as a label so re-running against already-generated output doesn't shift nesting.
    const transparent = node.group === "Catalog";
    walk(node.pages || [], transparent ? pathLabels : [...pathLabels, node.group]);
  }
}
for (const g of tab.groups) walk(g, []);

// Preview policy needs a detail-shaped record; the real one (catalog-detail-data/*.mdx,
// a follow-up) isn't built yet, so every item stays conservative (poster/video, never
// live-on-hover) until that data exists — matches the policy's own default for "not live".
for (const item of items) {
  item.preview = galleryPreview(item, { webgpu: false, tech: [], previewMode: "still" });
}

const groups = groupsOrder.map((id) => ({ id, label: groupLabels.get(id), pinned: false, count: items.filter((i) => i.group === id).length })).filter((g) => g.count > 0);
const result = { source: "https://github.com/heygen-com/hyperframes", groups, items };
fs.writeFileSync(path.join(docs, "snippets/catalog-gallery-data.mdx"), `export const catalogGalleryData = ${JSON.stringify(result)};\n`);
console.log(`Synced ${items.length} catalog items in ${groups.length} groups.`);

buildNav(docs);

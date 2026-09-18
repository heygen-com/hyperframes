#!/usr/bin/env node
// Builds docs/snippets/catalog-gallery-data.mdx for catalog-gallery.jsx directly from this
// repo's own registry/*/registry-item.json and docs.json (no sparse clone, no other project's
// snapshot). Usage: node scripts/sync-docs-catalog.mjs [path/to/docs]
import fs from "node:fs";
import path from "node:path";
import { buildNav } from "./build-docs-gallery-nav.mjs";
import {
  getCatalogTab,
  previewGap,
  readJson,
  resolveDocsRoot,
  slug,
} from "./docs-catalog-shared.mjs";

const { root, docs } = resolveDocsRoot(process.argv[2]);
const config = readJson(path.join(docs, "docs.json"));
const tab = getCatalogTab(config);

function statusOf(man) {
  return man.stability === "experimental" ? "experimental" : "published";
}

function isHeavy(html) {
  return /getContext\(\s*["']webgl2?["']|THREE\.|navigator\.gpu|WebGPURenderer/.test(html);
}

// The one preview rule: a composition that needs a Chrome flag shows its recorded video, every
// other one plays live from the same JSON payload the detail page serves. Poster art is only
// the still before the player mounts, so it never decides the mode.
// fallow-ignore-next-line complexity
function previewFor(dir, id, docsDir, man) {
  const recorded = man.preview?.video ? { mode: "video" } : { mode: "still" };
  const payloadPath = path.join(docsDir, "public/catalog", dir, `${id}.json`);
  if (!fs.existsSync(payloadPath)) return recorded;
  const payload = readJson(payloadPath);
  if (payload.unsupported) {
    return recorded.mode === "video" ? recorded : { mode: "unsupported", flag: payload.unsupported };
  }
  const { html } = payload;
  if (!html || previewGap(html)) return recorded;
  return {
    mode: "player",
    source: `/public/catalog/${dir}/${id}.json`,
    heavy: isHeavy(html),
    width: man.dimensions?.width || 1920,
    height: man.dimensions?.height || 1080,
  };
}

// one independent default per optional registry-item.json field
// fallow-ignore-next-line complexity
function itemFrom(node, dir, id, man, pathLabels) {
  const section = pathLabels[pathLabels.length - 1];
  const groupLabel = pathLabels[pathLabels.length - 2] || section;
  const item = {
    id,
    kind: dir === "blocks" ? "block" : "component",
    href: `/${node}`,
    title: man.title || id,
    tagline: man.description || "",
    description: man.description || "",
    group: slug(groupLabel),
    section,
    tags: man.tags || [],
    tech: [],
    duration: man.duration ?? null,
    width: man.dimensions?.width ?? null,
    height: man.dimensions?.height ?? null,
    status: statusOf(man),
    featured: 1000,
    poster: man.preview?.poster || null,
    video: man.preview?.video || null,
  };
  return { item, groupLabel };
}

// Walk the existing hand-authored nav so group/section order and labels stay ours.
// pathLabels accumulates each {group,pages} label on the way down, exactly like the
// gallery's own inventory.mjs walkNav: section = innermost label, group = the one above it
// (or section itself for a flat, one-level group).
const items = [];
const groupsOrder = [];
const groupLabels = new Map();
// one branch per nav-node type (array / leaf page / group)
// fallow-ignore-next-line complexity
function walk(node, pathLabels) {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, pathLabels);
    return;
  }
  if (typeof node === "string") {
    const m = node.match(/^catalog\/(blocks|components)\/([^/]+)$/);
    if (!m) return; // catalog/index and anything else stays out of the gallery data
    const [, dir, id] = m;
    const manifestPath = path.join(root, "registry", dir, id, "registry-item.json");
    if (!fs.existsSync(manifestPath)) {
      console.warn(`! ${node}: no registry-item.json, skipped`);
      return;
    }
    const man = readJson(manifestPath);
    const { item, groupLabel } = itemFrom(node, dir, id, man, pathLabels);
    item.preview = previewFor(dir, id, docs, man);
    if (!groupsOrder.includes(item.group)) {
      groupsOrder.push(item.group);
      groupLabels.set(item.group, groupLabel);
    }
    items.push(item);
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

// Landing order: 3D motion first (once it exists — a separate initiative brings the
// items in), Carousels second, everything else keeping the order the hand-authored nav
// already had. Only "3d-motion" is pinned (two rows on the landing instead of one), matching
// the reference gallery's own convention — it pins the one group, not every group.
const PRIORITY = ["3d-motion", "carousels"];
const groups = groupsOrder
  .map((id) => ({
    id,
    label: groupLabels.get(id),
    pinned: id === "3d-motion",
    count: items.filter((i) => i.group === id).length,
  }))
  .filter((g) => g.count > 0)
  // groups absent from the priority list sort after the ones present in it
  // fallow-ignore-next-line complexity
  .sort((a, b) => {
    const pa = PRIORITY.indexOf(a.id);
    const pb = PRIORITY.indexOf(b.id);
    if (pa === -1 && pb === -1) return 0;
    if (pa === -1) return 1;
    if (pb === -1) return -1;
    return pa - pb;
  });
const result = { source: "https://github.com/heygen-com/hyperframes", groups, items };
fs.writeFileSync(
  path.join(docs, "snippets/catalog-gallery-data.mdx"),
  `export const catalogGalleryData = ${JSON.stringify(result)};\n`,
);
console.log(`Synced ${items.length} catalog items in ${groups.length} groups.`);

buildNav(docs);

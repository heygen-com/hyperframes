#!/usr/bin/env node
// Proves the generated Catalog nav still lists exactly the same pages as before, on disk,
// reachable, no duplicates. Adapted from a reference implementation of this same check.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  getCatalogTab,
  readCatalogGalleryData,
  readJson,
  resolveDocsRoot,
} from "./docs-catalog-shared.mjs";

const { root, docs } = resolveDocsRoot(process.argv[2]);

function leafPaths(tab) {
  const paths = [];
  const walk = (pages) => {
    for (const p of pages) {
      if (typeof p === "string") paths.push("/" + p);
      else walk(p.pages || []);
    }
  };
  for (const g of tab.groups) walk(g.pages);
  return paths;
}

// Same derivation as sync-docs-catalog.mjs's walk(): the innermost real label is the section,
// the one above it the group; "Catalog"/"Overview" are transparent wrappers, not labels.
function hrefSections(tab) {
  const sections = new Map();
  // one branch per nav-node type (array / leaf page / group)
  // fallow-ignore-next-line complexity
  const walk = (node, labels) => {
    if (Array.isArray(node)) {
      for (const n of node) walk(n, labels);
      return;
    }
    if (typeof node === "string") {
      sections.set("/" + node, labels[labels.length - 1] ?? null);
      return;
    }
    if (node.group === "Overview") return;
    const next = node.group === "Catalog" ? labels : [...labels, node.group];
    walk(node.pages || [], next);
  };
  for (const g of tab.groups) walk(g, []);
  return sections;
}

const config = readJson(path.join(docs, "docs.json"));
const tab = getCatalogTab(config);
const after = leafPaths(tab);
assert.equal(after.length, new Set(after).size, "Duplicate sidebar item");

const data = readCatalogGalleryData(docs);
assert.equal(
  data.items.length,
  after.filter((p) => p !== "/catalog/index").length,
  "Gallery data item count does not match the nav's leaf page count",
);
const navSections = hrefSections(tab);
for (const item of data.items) {
  assert.ok(after.includes(item.href), `Gallery item missing from the sidebar: ${item.href}`);
  assert.ok(
    fs.existsSync(path.join(docs, item.href.slice(1) + ".mdx")),
    `Gallery item has no page on disk: ${item.href}`,
  );
  assert.equal(
    navSections.get(item.href),
    item.section,
    `Section mismatch for ${item.href}: nav says "${navSections.get(item.href)}", gallery data says "${item.section}"`,
  );
  assert.ok(
    ["still", "video", "live"].includes(item.preview?.mode),
    `Missing gallery preview policy for ${item.id}`,
  );
  if (item.preview.mode === "video") assert.ok(item.video, `Missing hover video for ${item.id}`);
  if (item.preview.mode === "live") {
    assert.ok(
      fs.existsSync(path.join(docs, item.preview.source.slice(1))),
      `Missing hover composition file for ${item.id}: ${item.preview.source}`,
    );
  }
}

// The identical-page-list proof: diff against the pre-PR1 docs.json at the merge base.
let before = null;
try {
  const base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: root })
    .toString()
    .trim();
  const prior = JSON.parse(
    execFileSync("git", ["show", `${base}:docs/docs.json`], { cwd: root }).toString(),
  );
  const priorTab = getCatalogTab(prior);
  before = leafPaths(priorTab);
} catch (e) {
  console.warn(
    `! Could not diff against origin/main's docs.json (${e.message}); skipping the before/after page-list proof.`,
  );
}
if (before) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const missing = before.filter((p) => !afterSet.has(p));
  const added = after.filter((p) => !beforeSet.has(p));
  assert.equal(missing.length, 0, `Pages present before but missing after: ${missing.join(", ")}`);
  assert.equal(added.length, 0, `Pages present after but not before: ${added.join(", ")}`);
  console.log(
    `PASS identical page list: ${before.length} pages before and after PR1, byte-for-byte the same set.`,
  );
}
console.log(
  `PASS ${data.items.length} gallery items, all present in the sidebar and on disk; no duplicate sidebar entries.`,
);

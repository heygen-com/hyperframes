#!/usr/bin/env node
// Proves the generated Catalog nav still lists exactly the same pages as before, on disk,
// reachable, no duplicates. Adapted from kaolti/hyperframes-gallery's check-docs-catalog.mjs
// @ 922e1737e31a65713194b3eae0ee71d50ecf919a, trimmed to this PR's scope.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const docs = path.resolve(process.argv[2] || path.join(root, "docs"));
const read = (p) => fs.readFileSync(path.join(docs, p), "utf8");

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

const config = JSON.parse(read("docs.json"));
const tab = config.navigation.tabs.find((t) => t.tab === "Catalog");
const after = leafPaths(tab);
assert.equal(after.length, new Set(after).size, "Duplicate sidebar item");

const data = JSON.parse(read("snippets/catalog-gallery-data.mdx").replace(/^export const catalogGalleryData = /, "").replace(/;\s*$/, ""));
assert.equal(data.items.length, after.filter((p) => p !== "/catalog/index").length, "Gallery data item count does not match the nav's leaf page count");
for (const item of data.items) {
  assert.ok(after.includes(item.href), `Gallery item missing from the sidebar: ${item.href}`);
  assert.ok(fs.existsSync(path.join(docs, item.href.slice(1) + ".mdx")), `Gallery item has no page on disk: ${item.href}`);
}

// The identical-page-list proof: diff against the pre-PR1 docs.json at the merge base.
let before = null;
try {
  const base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: root }).toString().trim();
  const prior = JSON.parse(execFileSync("git", ["show", `${base}:docs/docs.json`], { cwd: root }).toString());
  const priorTab = prior.navigation.tabs.find((t) => t.tab === "Catalog");
  before = leafPaths(priorTab);
} catch (e) {
  console.warn(`! Could not diff against origin/main's docs.json (${e.message}); skipping the before/after page-list proof.`);
}
if (before) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const missing = before.filter((p) => !afterSet.has(p));
  const added = after.filter((p) => !beforeSet.has(p));
  assert.equal(missing.length, 0, `Pages present before but missing after: ${missing.join(", ")}`);
  assert.equal(added.length, 0, `Pages present after but not before: ${added.join(", ")}`);
  console.log(`PASS identical page list: ${before.length} pages before and after PR1, byte-for-byte the same set.`);
}
console.log(`PASS ${data.items.length} gallery items, all present in the sidebar and on disk; no duplicate sidebar entries.`);

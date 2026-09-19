#!/usr/bin/env node
// Proves the generated Catalog nav lists every page on disk and reachable, with no page
// lost and no duplicates. Adapted from a reference implementation of this same check.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import {
  getCatalogTab,
  previewGap,
  readCatalogGalleryData,
  readJson,
  resolveDocsRoot,
} from "./docs-catalog-shared.mjs";

const { root, docs } = resolveDocsRoot(process.argv[2]);

// Items allowed without a live preview, each with the reason it has none.
const NO_LIVE = new Map([
  [
    "heygen-avatar-promo-card",
    "its source videos are not on the CDN yet; a maintainer runs host-registry-assets",
  ],
]);

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
  assert.match(
    fs.readFileSync(path.join(docs, item.href.slice(1) + ".mdx"), "utf8"),
    /<CatalogDetail\b/,
    `${item.href} does not render the shared item-page layout`,
  );
  assert.equal(
    navSections.get(item.href),
    item.section,
    `Section mismatch for ${item.href}: nav says "${navSections.get(item.href)}", gallery data says "${item.section}"`,
  );
  assert.ok(
    ["still", "video", "player", "unsupported"].includes(item.preview?.mode),
    `Missing gallery preview policy for ${item.id}`,
  );
  assert.ok(
    item.preview.mode !== "still" || NO_LIVE.has(item.id),
    `${item.id} has neither a live payload nor a Chrome-flag reason for its recorded video`,
  );
  if (item.preview.mode === "video" && !NO_LIVE.has(item.id)) {
    assert.ok(item.video, `Missing hover video for ${item.id}`);
    const file = path.join(docs, "public/catalog", `${item.kind}s`, `${item.id}.json`);
    const payload = fs.existsSync(file) ? readJson(file) : {};
    assert.ok(
      payload.unsupported || previewGap(payload.html ?? "") === "webgpu",
      `${item.id} shows its recorded video although its payload plays live`,
    );
  }
  if (item.preview.mode === "player") {
    assert.ok(
      fs.existsSync(path.join(docs, item.preview.source.slice(1))),
      `Missing preview payload for ${item.id}: ${item.preview.source}`,
    );
  }
}

// The no-page-lost proof: diff against docs.json at the merge base. A checkout that can't
// compute it (shallow clone, missing origin/main) must fail loudly, not skip and exit 0.
const base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: root })
  .toString()
  .trim();
const prior = JSON.parse(
  execFileSync("git", ["show", `${base}:docs/docs.json`], { cwd: root }).toString(),
);
const priorTab = getCatalogTab(prior);
const before = leafPaths(priorTab);
const beforeSet = new Set(before);
const afterSet = new Set(after);
const missing = before.filter((p) => !afterSet.has(p));
const added = after.filter((p) => !beforeSet.has(p));
assert.equal(missing.length, 0, `Pages present before but missing after: ${missing.join(", ")}`);
console.log(
  `PASS no page lost: ${before.length} pages before, ${after.length} after` +
    (added.length ? ` (${added.length} legitimately new: ${added.join(", ")})` : ""),
);
console.log(
  `PASS ${data.items.length} gallery items, all present in the sidebar and on disk; no duplicate sidebar entries.`,
);

// Mintlify's build drops .html/.js/.css from docs/public with no error; a file there 404s
// in production while its page still serves. Catches this before a card fetches a ghost.
const publicRoot = path.join(docs, "public");
const badExtensions = fs
  .readdirSync(publicRoot, { recursive: true })
  .filter((f) => /\.(html|js|css)$/i.test(f));
assert.equal(
  badExtensions.length,
  0,
  `docs/public serves only JSON and images in production; drop or rename: ${badExtensions.join(", ")}`,
);
console.log(`PASS no .html/.js/.css under docs/public (Mintlify would drop it from the build).`);

// Mintlify's snippet bundler only preserves the exported binding's own closure; a sibling
// top-level const/function in the same file silently vanishes from the deployed build
// (ReferenceError at runtime, no build-time error). Catch it here instead of live.
function assertNoBareTopLevelBindings(snippetPath) {
  const source = fs.readFileSync(snippetPath, "utf-8");
  const sourceFile = ts.createSourceFile(
    snippetPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JSX,
  );
  const isExported = (node) =>
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const bare = sourceFile.statements.filter(
    (s) => (ts.isVariableStatement(s) || ts.isFunctionDeclaration(s)) && !isExported(s),
  );
  assert.equal(
    bare.length,
    0,
    `${path.relative(root, snippetPath)}: top-level declaration(s) outside the exported ` +
      `binding are dropped by Mintlify's snippet bundler on deploy: ${bare
        .map((s) => s.getText(sourceFile).split("\n")[0])
        .join(" | ")}`,
  );
}
assertNoBareTopLevelBindings(path.join(docs, "snippets/catalog-gallery.jsx"));
console.log(`PASS catalog-gallery.jsx has no top-level binding outside the exported component.`);

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { generatedCatalogDifferences } from "./catalog-drift.ts";
import { generateCatalog } from "./generate-catalog.ts";

function write(root: string, path: string, value: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), value);
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], {
    cwd: root,
    stdio: "pipe",
    env: { ...process.env, LEFTHOOK: "0" },
  });
}

function commit(root: string): void {
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "fixture");
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "catalog-pipeline-test-"));
  write(
    root,
    "docs/docs.json",
    JSON.stringify({ navigation: { tabs: [{ tab: "Catalog", groups: [] }] } }),
  );
  mkdirSync(join(root, "docs/snippets"), { recursive: true });
  write(
    root,
    "registry/registry.json",
    JSON.stringify({ items: [], catalogArtifact: { revision: "keep" } }),
  );
  write(
    root,
    "registry/examples/authored/registry-item.json",
    '{"name":"authored","description":"Keep this prose"}\n',
  );
  write(
    root,
    "registry/blocks/chart/registry-item.json",
    JSON.stringify({
      name: "chart",
      type: "hyperframes:block",
      title: "Chart",
      description: "A chart.",
      tags: ["data"],
      dimensions: { width: 1920, height: 1080 },
      duration: 5,
      files: [{ path: "chart.html", target: "chart.html", type: "hyperframes:composition" }],
    }),
  );
  write(root, "registry/blocks/chart/chart.html", '<div data-composition-id="chart">Chart</div>\n');
  write(root, "docs/catalog/blocks/chart.mdx", "## Features\n\nKeep the authored section.\n");
  git(root, "init", "--quiet");
  return root;
}

const outputs = [
  "registry/registry.json",
  "docs/catalog/blocks/chart.mdx",
  "docs/public/catalog-index.json",
  "docs/snippets/catalog-gallery-data.mdx",
  "docs/docs.json",
];

function snapshot(root: string): Map<string, string> {
  return new Map(outputs.map((path) => [path, readFileSync(join(root, path), "utf8")]));
}

test("the complete pipeline is idempotent and preserves authored inputs", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const example = readFileSync(join(root, "registry/examples/authored/registry-item.json"), "utf8");
  generateCatalog(root);
  const first = snapshot(root);
  const index = JSON.parse(first.get("registry/registry.json")!);
  assert.deepEqual(index.items, [
    { name: "authored", type: "hyperframes:example" },
    { name: "chart", type: "hyperframes:block" },
  ]);
  assert.deepEqual(index.catalogArtifact, { revision: "keep" });
  assert.equal(
    readFileSync(join(root, "registry/examples/authored/registry-item.json"), "utf8"),
    example,
  );
  assert.match(first.get("docs/catalog/blocks/chart.mdx")!, /Keep the authored section\./);
  generateCatalog(root);
  assert.deepEqual(snapshot(root), first);
  commit(root);
  assert.deepEqual(generatedCatalogDifferences(root), []);
  assert.deepEqual(snapshot(root), first);
});

test("committed drift is reported even when the working tree has already been regenerated", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  generateCatalog(root);
  const clean = snapshot(root);
  for (const path of outputs) write(root, path, "stale committed output\n");
  commit(root);
  for (const [path, text] of clean) write(root, path, text);
  assert.deepEqual(
    generatedCatalogDifferences(root),
    outputs.map((path) => `stale: ${path}`).sort(),
  );
  assert.deepEqual(snapshot(root), clean);
});

test("an unreadable registry index is not overwritten by regeneration", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "registry/registry.json", "{invalid json");
  assert.throws(() => generateCatalog(root), SyntaxError);
  assert.equal(readFileSync(join(root, "registry/registry.json"), "utf8"), "{invalid json");
});

test("a registry scan failure leaves the index unchanged", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const before = readFileSync(join(root, "registry/registry.json"), "utf8");
  write(root, "registry/components", "not a directory");
  assert.throws(() => generateCatalog(root), { code: "ENOTDIR" });
  assert.equal(readFileSync(join(root, "registry/registry.json"), "utf8"), before);
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { catalogChanges, commitBatches } from "./publish-catalog.mjs";
import { committedCatalogOutputs } from "./check-catalog-source-pr.mjs";

test("catalog source edits reject generated commits while a publication alone is accepted", () => {
  assert.deepEqual(
    committedCatalogOutputs(["registry/components/new/index.html", "docs/docs.json"]),
    ["docs/docs.json"],
  );
  assert.deepEqual(committedCatalogOutputs(["docs/docs.json"]), []);
  assert.deepEqual(committedCatalogOutputs(["registry/components/new/registry-item.json"]), []);
});

test("publication includes changed, new and deleted generated files and excludes source changes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "catalog-publish-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root });
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  git("init", "-q");
  write("registry/registry.json", "old");
  write("docs/public/catalog/blocks/gone.json", "old");
  write("registry/blocks/source/index.html", "source");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture",
  );
  write("registry/registry.json", "new");
  write("registry/blocks/source/index.html", "changed source");
  write("docs/public/catalog/blocks/new.json", Buffer.from([0, 255, 4]));
  rmSync(join(root, "docs/public/catalog/blocks/gone.json"));
  assert.deepEqual(catalogChanges(root, "HEAD"), [
    { path: "docs/public/catalog/blocks/gone.json", kind: "delete" },
    { path: "docs/public/catalog/blocks/new.json", kind: "write", contents: "AP8E" },
    { path: "registry/registry.json", kind: "write", contents: "bmV3" },
  ]);
});

test("signed API batches preserve deletions and limit each request to 100 changes", () => {
  const changes = Array.from({ length: 101 }, (_, index) => ({
    kind: "delete",
    path: `docs/public/catalog/${index}.json`,
  }));
  const batches = commitBatches(changes);
  assert.deepEqual(
    batches.map((batch) => batch.deletions.length),
    [100, 1],
  );
  assert.deepEqual(batches[1], {
    additions: [],
    deletions: [{ path: "docs/public/catalog/100.json" }],
  });
});

test("oversized API files fail before any publication", () => {
  assert.throws(
    () =>
      commitBatches([
        {
          kind: "write",
          path: "docs/public/catalog/large.json",
          contents: "x".repeat(10 * 1024 * 1024),
        },
      ]),
    /exceeds API batch budget/,
  );
});

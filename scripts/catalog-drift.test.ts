import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { treeDifferences } from "./catalog-drift.ts";

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "catalog-drift-test-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

test("identical trees have no differences", () => {
  const generated = tree({ "blocks/a.json": "{}", "vendor/x.json": "1" });
  const committed = tree({ "blocks/a.json": "{}", "vendor/x.json": "1" });
  assert.deepEqual(treeDifferences(generated, committed), []);
  rmSync(generated, { recursive: true });
  rmSync(committed, { recursive: true });
});

test("a stale payload, a missing file and a leftover file each turn the check red", () => {
  const generated = tree({ "blocks/a.json": '{"v":2}', "blocks/new.json": "{}" });
  const committed = tree({ "blocks/a.json": '{"v":1}', "blocks/gone.json": "{}" });
  assert.deepEqual(treeDifferences(generated, committed), [
    "not committed: blocks/new.json",
    "no longer generated: blocks/gone.json",
    "stale: blocks/a.json",
  ]);
  rmSync(generated, { recursive: true });
  rmSync(committed, { recursive: true });
});

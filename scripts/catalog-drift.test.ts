import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { codeLinesDrift, treeDifferences } from "./catalog-drift.ts";

// orbit-card is a real registry item, chosen because its source is short and stable, so the
// fixture below pins a real line count rather than a value nobody will notice drift from.
const REAL_ITEM = "orbit-card";
const REAL_CODE_LINES = 102;

function catalogDir(codeLines: number): string {
  return tree({
    [`blocks/${REAL_ITEM}.mdx`]: `---\ntitle: "Orbit Card"\n---\n<CatalogDetail meta={{"codeLines":${codeLines}}} hasCode />\n`,
  });
}

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

test("codeLinesDrift is clean when the committed page matches its own source", () => {
  const committed = catalogDir(REAL_CODE_LINES);
  assert.deepEqual(codeLinesDrift(committed), []);
  rmSync(committed, { recursive: true });
});

test("a stale codeLines turns the check red, naming the page and both counts", () => {
  const committed = catalogDir(REAL_CODE_LINES + 50);
  const found = codeLinesDrift(committed);
  assert.equal(found.length, 1);
  assert.match(
    found[0]!,
    new RegExp(
      `blocks/${REAL_ITEM}\\.mdx says ${REAL_CODE_LINES + 50}, source is ${REAL_CODE_LINES} lines`,
    ),
  );
  rmSync(committed, { recursive: true });
});

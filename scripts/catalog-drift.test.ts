import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { treeDifferences } from "./catalog-drift.ts";

const meta = JSON.stringify({ dimensions: 4 });
const vectors = (rows: number[][]) => Buffer.from(new Float32Array(rows.flat()).buffer);

function tree(files: Record<string, string | Buffer>): string {
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

test("vectors that differ only by float noise between machines are not stale", () => {
  // Second row: cosine 0.995, just past the 0.9963 worst case measured between two machines.
  const generated = tree({
    "a/local-vectors.json": meta,
    "a/local-vectors.bin": vectors([
      [0.5, 0.5, 0.5, 0.5],
      [1, 0, 0, 0],
    ]),
  });
  const committed = tree({
    "a/local-vectors.json": meta,
    "a/local-vectors.bin": vectors([
      [0.5, 0.51, 0.49, 0.5],
      [1, 0.1, 0, 0],
    ]),
  });
  assert.deepEqual(treeDifferences(generated, committed), []);
  rmSync(generated, { recursive: true });
  rmSync(committed, { recursive: true });
});

test("vectors with a row that points elsewhere, or a different row count, are stale", () => {
  // a: cosine 0.984, below the closest two different catalog items (0.9897).
  const generated = tree({
    "a/local-vectors.json": meta,
    "a/local-vectors.bin": vectors([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ]),
    "b/local-vectors.json": meta,
    "b/local-vectors.bin": vectors([[1, 0, 0, 0]]),
  });
  const committed = tree({
    "a/local-vectors.json": meta,
    "a/local-vectors.bin": vectors([
      [1, 0, 0, 0],
      [0.18, 1, 0, 0],
    ]),
    "b/local-vectors.json": meta,
    "b/local-vectors.bin": vectors([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ]),
  });
  assert.deepEqual(treeDifferences(generated, committed), [
    "stale: a/local-vectors.bin",
    "stale: b/local-vectors.bin",
  ]);
  rmSync(generated, { recursive: true });
  rmSync(committed, { recursive: true });
});

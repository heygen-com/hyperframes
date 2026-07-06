import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tagUsage, partitionUsage } from "./usage.mjs";

function project(html) {
  const dir = mkdtempSync(join(tmpdir(), "mu-usage-"));
  writeFileSync(join(dir, "index.html"), html);
  return dir;
}

const records = [
  { id: "bgm_001", path: ".media/audio/bgm/bgm_001.wav", description: "used track" },
  { id: "bgm_002", path: ".media/audio/bgm/bgm_002.wav", description: "orphan track" },
];

test("an asset referenced by a composition is marked in-use", () => {
  const dir = project(`<audio src="assets/bgm_001.wav"></audio>`);
  try {
    const tagged = tagUsage(records, dir);
    assert.equal(tagged.find((r) => r.id === "bgm_001").inUse, true);
    assert.equal(tagged.find((r) => r.id === "bgm_002").inUse, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("partitionUsage splits used vs unused for the filter", () => {
  const dir = project(`<img src="bgm_001.wav">`);
  try {
    const { used, unused } = partitionUsage(records, dir);
    assert.deepEqual(
      used.map((r) => r.id),
      ["bgm_001"],
    );
    assert.deepEqual(
      unused.map((r) => r.id),
      ["bgm_002"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no compositions -> everything reads as unused (safe default)", () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-usage-"));
  try {
    assert.equal(partitionUsage(records, dir).used.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

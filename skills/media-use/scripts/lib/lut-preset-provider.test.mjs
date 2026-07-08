import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  CORE_PRESET_IDS,
  freezeLibraryLut,
  matchColorLook,
  readBundledLutIndex,
} from "./lut-preset-provider.mjs";
import { validateCubeFile } from "./cube-validate.mjs";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

function corePresetIdsFromSource() {
  const src = readFileSync(join(REPO_ROOT, "packages/core/src/colorGrading.ts"), "utf8");
  const match = src.match(/export type HfColorGradingPresetId =([\s\S]*?);/);
  assert.ok(match, "core preset union should be readable");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("warm daylight and warm natural light resolve to the core warm-daylight preset", () => {
  assert.deepEqual(matchColorLook("warm daylight"), {
    kind: "preset",
    preset: "warm-daylight",
    score: 2,
  });
  assert.equal(matchColorLook("warm natural light").preset, "warm-daylight");
});

test("high contrast punchy resolves to deep-contrast", () => {
  assert.equal(matchColorLook("high contrast punchy").preset, "deep-contrast");
});

test("library-only look freezes a validated cube under .media/luts", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "mu-lut-provider-"));
  try {
    const match = matchColorLook("teal orange blockbuster");
    assert.equal(match.kind, "library");
    const frozen = freezeLibraryLut(match, { projectDir, type: "grade" });
    assert.match(frozen.localPath, /^\.media\/luts\/grade_001\.cube$/);
    assert.ok(existsSync(join(projectDir, frozen.localPath)));
    assert.equal(validateCubeFile(join(projectDir, frozen.localPath)).ok, true);
    assert.equal(frozen.lut.src, frozen.localPath);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("preset IDs stay in sync with packages/core/src/colorGrading.ts", () => {
  assert.deepEqual(CORE_PRESET_IDS, corePresetIdsFromSource());
  for (const id of CORE_PRESET_IDS) {
    const match = matchColorLook(id);
    assert.equal(match.kind, "preset");
    assert.equal(match.preset, id);
  }
});

test("zero-overlap intent returns no preset or library match", () => {
  assert.equal(matchColorLook("zqxv imaginary neutron look"), null);
});

test("bundled LUT index points at valid committed cube files", () => {
  for (const entry of readBundledLutIndex()) {
    assert.ok(entry.id);
    assert.ok(entry.file.endsWith(".cube"));
    const path = join(REPO_ROOT, "skills/media-use/luts", entry.file);
    assert.ok(existsSync(path), `${entry.file} should exist`);
    assert.equal(validateCubeFile(path).ok, true, `${entry.file} should validate`);
  }
});

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  CORE_PRESET_IDS,
  LIBRARY_LUT_OFFLINE_CODE,
  freezeLibraryLut,
  matchColorLook,
  readBundledLutIndex,
} from "./lut-preset-provider.mjs";
import { buildCube } from "./cube-build.mjs";
import { validateCube, validateCubeFile } from "./cube-validate.mjs";

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

test("library look freezes a validated cube from params offline (--local-only)", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "mu-lut-provider-"));
  try {
    const match = matchColorLook("teal orange blockbuster");
    assert.equal(match.kind, "library");
    // localOnly forces the deterministic params path (no network); online, the
    // same look downloads its .cube from the CDN url (via "url").
    const frozen = await freezeLibraryLut(match, { projectDir, type: "grade", localOnly: true });
    assert.match(frozen.localPath, /^\.media\/luts\/grade_001\.cube$/);
    assert.ok(existsSync(join(projectDir, frozen.localPath)));
    assert.equal(validateCubeFile(join(projectDir, frozen.localPath)).ok, true);
    assert.equal(frozen.lut.src, frozen.localPath);
    assert.equal(frozen.metadata.provenance.via, "params-fallback");
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

test("bundled LUT index entries resolve from params or url", () => {
  for (const entry of readBundledLutIndex()) {
    assert.ok(entry.id);
    assert.ok(entry.description);
    assert.ok(entry.params || entry.url, `${entry.id} should define params or url`);
    if (entry.params) {
      assert.equal(typeof entry.params, "object");
      assert.equal(validateCube(buildCube(entry.params)).ok, true, `${entry.id} params validate`);
    }
    if (entry.url) assert.equal(typeof entry.url, "string");
  }
});

test("url library entries respect localOnly and freeze through fetch", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "mu-lut-url-provider-"));
  const match = {
    kind: "library",
    id: "cdn-look",
    description: "CDN-hosted look",
    tags: ["cdn"],
    intensity: 0.7,
    url: "https://example.invalid/look.cube",
  };
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  try {
    globalThis.fetch = async () => {
      fetchCalls++;
      throw new Error("network should be skipped under localOnly");
    };
    await assert.rejects(
      freezeLibraryLut(match, { projectDir, type: "lut", localOnly: true }),
      (err) => {
        assert.equal(err.code, LIBRARY_LUT_OFFLINE_CODE);
        assert.match(err.message, /--local-only/);
        return true;
      },
    );
    assert.equal(fetchCalls, 0);

    const cube = buildCube({ contrast: 0.1 });
    const body = Buffer.from(cube);
    globalThis.fetch = async (url) => {
      fetchCalls++;
      assert.equal(url, match.url);
      return {
        ok: true,
        headers: { get: () => String(body.length) },
        body: [body],
      };
    };

    const frozen = await freezeLibraryLut(match, { projectDir, type: "lut" });
    assert.equal(fetchCalls, 1);
    assert.match(frozen.localPath, /^\.media\/luts\/lut_001\.cube$/);
    assert.equal(validateCubeFile(join(projectDir, frozen.localPath)).ok, true);
    assert.equal(frozen.metadata.provenance.via, "url");
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(projectDir, { recursive: true, force: true });
  }
});

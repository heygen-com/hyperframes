import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  BUNDLED_SFX_RECOVERY_COMMAND,
  BundledSfxAssetsError,
  bundledSfxProvider,
  extensionForBundledSfxFile,
  inspectBundledSfxAssets,
} from "./bundled-sfx-provider.mjs";

test("derives bundled SFX extension from the manifest filename", () => {
  assert.equal(extensionForBundledSfxFile("impact.wav"), ".wav");
  assert.equal(extensionForBundledSfxFile("whoosh.ogg"), ".ogg");
  assert.equal(extensionForBundledSfxFile("extensionless"), ".mp3");
});

test("reports an agent-friendly recovery when the bundled SFX manifest is absent", () => {
  const libraryDir = mkdtempSync(join(tmpdir(), "media-use-sfx-missing-"));
  try {
    const health = inspectBundledSfxAssets(libraryDir);
    assert.equal(health.ok, false);
    assert.equal(health.code, "bundled_sfx_assets_missing");
    assert.match(health.detail, /manifest\.json/);
    assert.match(health.fix, /hyperframes skills update media-use/);
    assert.equal(health.fix, BUNDLED_SFX_RECOVERY_COMMAND);
  } finally {
    rmSync(libraryDir, { recursive: true, force: true });
  }
});

test("reports the exact missing file from an incomplete bundled SFX install", () => {
  const libraryDir = mkdtempSync(join(tmpdir(), "media-use-sfx-incomplete-"));
  try {
    writeFileSync(
      join(libraryDir, "manifest.json"),
      JSON.stringify({ whoosh: { file: "whoosh.mp3", description: "transition" } }),
    );
    const health = inspectBundledSfxAssets(libraryDir);
    assert.equal(health.ok, false);
    assert.equal(health.code, "bundled_sfx_assets_missing");
    assert.match(health.detail, /whoosh\.mp3/);
  } finally {
    rmSync(libraryDir, { recursive: true, force: true });
  }
});

test("bundled provider raises a typed install error instead of a generic catalog miss", async () => {
  const libraryDir = mkdtempSync(join(tmpdir(), "media-use-sfx-provider-"));
  try {
    await assert.rejects(
      () => bundledSfxProvider.search("whoosh", { libraryDir }),
      (error) => {
        assert.ok(error instanceof BundledSfxAssetsError);
        assert.equal(error.code, "bundled_sfx_assets_missing");
        assert.match(error.message, /hyperframes skills update media-use/);
        return true;
      },
    );
  } finally {
    rmSync(libraryDir, { recursive: true, force: true });
  }
});

test("accepts a complete bundled SFX library", () => {
  const libraryDir = mkdtempSync(join(tmpdir(), "media-use-sfx-complete-"));
  try {
    mkdirSync(libraryDir, { recursive: true });
    writeFileSync(
      join(libraryDir, "manifest.json"),
      JSON.stringify({ whoosh: { file: "whoosh.mp3", description: "transition" } }),
    );
    writeFileSync(join(libraryDir, "whoosh.mp3"), "audio");
    assert.deepEqual(inspectBundledSfxAssets(libraryDir), {
      ok: true,
      count: 1,
      detail: "1 bundled SFX asset available",
      fix: "",
    });
  } finally {
    rmSync(libraryDir, { recursive: true, force: true });
  }
});

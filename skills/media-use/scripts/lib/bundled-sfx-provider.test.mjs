import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { extensionForBundledSfxFile } from "./bundled-sfx-provider.mjs";

const SFX_DIR = join(import.meta.dirname, "..", "..", "audio", "assets", "sfx");
const HAS_FFPROBE = spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

function frozenDuration(filePath) {
  return Number(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
      { encoding: "utf8" },
    ).trim(),
  );
}

test("derives bundled SFX extension from the manifest filename", () => {
  assert.equal(extensionForBundledSfxFile("impact.wav"), ".wav");
  assert.equal(extensionForBundledSfxFile("whoosh.ogg"), ".ogg");
  assert.equal(extensionForBundledSfxFile("extensionless"), ".mp3");
});

test(
  "bundled SFX manifest covers every frozen asset with its exact duration",
  { skip: !HAS_FFPROBE },
  () => {
    const manifest = JSON.parse(readFileSync(join(SFX_DIR, "manifest.json"), "utf8"));
    const frozenFiles = readdirSync(SFX_DIR)
      .filter((file) => file.endsWith(".mp3"))
      .sort();
    const manifestFiles = Object.values(manifest)
      .map((entry) => entry.file)
      .sort();

    assert.deepEqual(manifestFiles, frozenFiles);
    for (const [key, entry] of Object.entries(manifest)) {
      const actual = frozenDuration(join(SFX_DIR, entry.file));
      assert.equal(entry.duration, actual, `${key} duration must match ${entry.file}`);
    }
  },
);

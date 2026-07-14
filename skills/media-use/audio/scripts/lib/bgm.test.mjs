import { test } from "node:test";
import assert from "node:assert/strict";
import { BGM_BED_VOLUME, BGM_SILENT_VOLUME, bgmDefaultVolume } from "./bgm.mjs";

// Regression: narrated pipelines used to ship BGM at 0.8 (≈ -2 dB), ~16 dB
// hotter than a music bed under a voice should be. The default under narration
// must be a proper bed (≈ -18 dB); a silent film keeps the louder default.

const dbfs = (linear) => 20 * Math.log10(linear);

test("BGM under narration is a bed near -18 dB", () => {
  assert.equal(bgmDefaultVolume(true), BGM_BED_VOLUME);
  assert.equal(BGM_BED_VOLUME, 0.12);
  const db = dbfs(BGM_BED_VOLUME);
  assert.ok(db < -17 && db > -19, `bed should be ≈ -18 dB, got ${db.toFixed(1)} dB`);
});

test("a silent film (no voice) keeps BGM forward", () => {
  assert.equal(bgmDefaultVolume(false), BGM_SILENT_VOLUME);
  assert.equal(BGM_SILENT_VOLUME, 0.9);
});

test("the narrated default is well below the voice (≈ 0 dBFS)", () => {
  // Voice sits at data-volume="1" (0 dBFS); the bed must be ~16+ dB under it.
  const separation = dbfs(1) - dbfs(bgmDefaultVolume(true));
  assert.ok(
    separation >= 16,
    `bed should sit ≥16 dB under the voice, got ${separation.toFixed(1)} dB`,
  );
});

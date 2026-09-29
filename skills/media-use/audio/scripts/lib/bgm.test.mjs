import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendRecord } from "../../../scripts/lib/manifest.mjs";
import {
  BGM_BED_VOLUME,
  BGM_SILENT_VOLUME,
  bgmDefaultVolume,
  generateBgmDetached,
} from "./bgm.mjs";

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

test(
  "generating music again clears the engine's old track, so waiting cannot mistake it for the new one",
  { skip: process.platform === "win32" && "the fake python is a shell script" },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-bgm-"));
    const path = process.env.PATH;
    t.after(() => {
      process.env.PATH = path;
      rmSync(dir, { recursive: true, force: true });
    });
    mkdirSync(join(dir, "bin"));
    for (const name of ["python3", "python"])
      writeFileSync(join(dir, "bin", name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    process.env.PATH = `${join(dir, "bin")}:${path}`;
    mkdirSync(join(dir, "assets/bgm"), { recursive: true });
    writeFileSync(join(dir, "assets/bgm/track.wav"), "last run's track");
    appendRecord(dir, {
      id: "bgm_001",
      type: "bgm",
      path: "assets/bgm/track.wav",
      source: "generated",
    });

    const gen = generateBgmDetached({
      prompt: "calm",
      durationS: 5,
      hyperframesDir: dir,
      anomalies: [],
    });

    assert.equal(gen.path, "assets/bgm/track.wav");
    assert.equal(existsSync(join(dir, "assets/bgm/track.wav")), false);
  },
);

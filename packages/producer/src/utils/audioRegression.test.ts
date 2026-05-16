import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildRmsEnvelope,
  compareAudioEnvelopes,
  computeAudioResidualRmsDb,
} from "./audioRegression.js";

describe("compareAudioEnvelopes", () => {
  it("treats silent-vs-silent audio as a perfect match", () => {
    const silentSamples = new Int16Array(4096);

    const rendered = buildRmsEnvelope(silentSamples);
    const snapshot = buildRmsEnvelope(silentSamples);

    expect(compareAudioEnvelopes(rendered, snapshot, 120)).toEqual({
      correlation: 1,
      lagWindows: 0,
    });
  });
});

// Skip the spawn-based tests entirely on hosts without ffmpeg. The
// regression harness only runs in environments where ffmpeg is present
// (`Dockerfile.test`, dev boxes with apt's ffmpeg), so an absent ffmpeg
// is a developer-laptop fact, not a producer regression.
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"], { encoding: "utf-8" }).status === 0;

describe.skipIf(!HAS_FFMPEG)("computeAudioResidualRmsDb", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "hf-audio-residual-test-"));
    // Two test wavs: identical 1-second 440 Hz sine, and a 880 Hz sine
    // that's audibly different from the 440 reference.
    for (const [name, freq] of [
      ["sine-440-a.wav", 440],
      ["sine-440-b.wav", 440],
      ["sine-880.wav", 880],
    ] as const) {
      const result = spawnSync(
        "ffmpeg",
        [
          "-nostdin",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          `sine=frequency=${freq}:duration=1:sample_rate=48000`,
          "-ac",
          "2",
          "-c:a",
          "pcm_s16le",
          join(tmp, name),
        ],
        { encoding: "utf-8" },
      );
      if (result.status !== 0) {
        throw new Error(`ffmpeg setup failed for ${name}: ${result.stderr}`);
      }
    }
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns -inf (or very low dBFS) for two identical streams", () => {
    const result = computeAudioResidualRmsDb(
      join(tmp, "sine-440-a.wav"),
      join(tmp, "sine-440-b.wav"),
    );
    expect(result.ok).toBe(true);
    // 440-vs-440 PCM cancels to silence; ffmpeg reports -inf which we
    // normalize to NEGATIVE_INFINITY, OR a value well below -90 if the
    // resampler introduces sub-bit-quantization noise.
    expect(result.overallDb).toBeLessThan(-80);
  });

  it("fails when streams are audibly different (440 Hz vs 880 Hz)", () => {
    const result = computeAudioResidualRmsDb(
      join(tmp, "sine-440-a.wav"),
      join(tmp, "sine-880.wav"),
    );
    expect(result.ok).toBe(false);
    // The residual of two uncorrelated unit-amplitude sines is roughly
    // the sum of both signals at near-full level — typically around
    // -3 dBFS in this resampled-stereo configuration.
    expect(result.overallDb).toBeGreaterThan(-30);
  });

  it("reports ok=false when an input has no audio stream", () => {
    // A bare empty file: ffmpeg can't probe it, so the function reports
    // a parse failure (ok=false, NaN). Callers decide whether to treat
    // that as a pass (no-audio fixture) or a fail (audio expected).
    const result = computeAudioResidualRmsDb("/dev/null", join(tmp, "sine-440-a.wav"));
    expect(result.ok).toBe(false);
    expect(Number.isNaN(result.overallDb)).toBe(true);
  });
});

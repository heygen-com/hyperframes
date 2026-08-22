import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { MIXED_AUDIO_FILENAME, processCompositionAudio } from "./audioMixer.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;
const tempDirs: string[] = [];

function meanVolumeDb(path: string): number {
  const result = spawnSync(
    getFfmpegBinary(),
    ["-nostdin", "-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf-8" },
  );
  const match = result.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
  if (result.status !== 0 || !match?.[1]) {
    throw new Error(`Could not measure mean volume: ${result.stderr}`);
  }
  return Number(match[1]);
}

/** Seconds until the first sample loud enough to be signal rather than codec noise. */
function firstAudibleSeconds(path: string): number {
  const sampleRate = 48_000;
  const result = spawnSync(
    getFfmpegBinary(),
    [
      "-nostdin",
      "-v",
      "error",
      "-i",
      path,
      "-map",
      "0:a",
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-f",
      "s16le",
      "-",
    ],
    { maxBuffer: 1 << 28 },
  );
  if (result.status !== 0) {
    throw new Error(`Could not decode ${path}: ${result.stderr?.toString()}`);
  }
  const pcm = result.stdout;
  for (let i = 0; i < pcm.length / 2; i += 1) {
    if (Math.abs(pcm.readInt16LE(i * 2)) > 512) return i / sampleRate;
  }
  throw new Error(`No audible sample found in ${path}`);
}

/**
 * These two tests drive real ffmpeg, and the file ran on vitest's 5s default:
 * `places a delayed track on its authored start` takes ~137ms locally and still
 * hit that cap on the windows runner, failing an unrelated PR. 60s is what the
 * rest of the ffmpeg-driven engine tests use. Applied to the suite rather than
 * each test so the budget has one home.
 *
 * Headroom alone would only delay an undiagnosable failure, so the ffmpeg
 * process timeout is capped well under it too. Its production default is 5
 * minutes — far above any test budget — so a stalled mix could only ever
 * surface as a bare "Test timed out", with no stderr and no failing stage.
 */
const FFMPEG_TEST_TIMEOUT_MS = 60_000;
const TEST_FFMPEG_TIMEOUT_MS = 20_000;

/** Assert the mix succeeded, reporting `failures` rather than a bare `false`. */
function expectMixed(result: { success: boolean; failures?: unknown }): void {
  if (!result.success) {
    throw new Error(`mix failed: ${JSON.stringify(result.failures ?? result, null, 2)}`);
  }
}

describe.skipIf(!HAS_FFMPEG)(
  "processCompositionAudio levels",
  () => {
    afterEach(() => {
      for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    it("preserves the level of a mono source in the stereo mix", async () => {
      const projectDir = mkdtempSync(join(tmpdir(), "hf-mono-level-"));
      const workDir = mkdtempSync(join(tmpdir(), "hf-mono-work-"));
      tempDirs.push(projectDir, workDir);
      const sourcePath = join(projectDir, "voice.wav");
      const outputPath = join(projectDir, "audio.aac");
      const setup = spawnSync(
        getFfmpegBinary(),
        [
          "-nostdin",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=1000:duration=1:sample_rate=48000",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          sourcePath,
        ],
        { encoding: "utf-8" },
      );
      expect(setup.status, setup.stderr).toBe(0);

      const result = await processCompositionAudio(
        [
          {
            id: "voice",
            src: "voice.wav",
            start: 0,
            end: 1,
            mediaStart: 0,
            layer: 0,
            volume: 1,
            type: "audio",
          },
        ],
        projectDir,
        workDir,
        outputPath,
        1,
        undefined,
        { ffmpegProcessTimeout: TEST_FFMPEG_TIMEOUT_MS },
      );

      expectMixed(result);
      expect(meanVolumeDb(outputPath) - meanVolumeDb(sourcePath)).toBeGreaterThan(-0.3);
    });

    it("places a delayed track on its authored start, not one AAC frame later", async () => {
      // The mix is AAC-encoded, and AAC encoders emit ~1024 priming samples. A
      // raw ADTS container has nowhere to record that delay, so it decodes as
      // real leading silence and drags the whole track 21.33 ms late against a
      // frame-accurate video. MIXED_AUDIO_FILENAME picks a container that stores
      // the delay as an edit list instead; this asserts the artifact we actually
      // ship lands on time.
      const projectDir = mkdtempSync(join(tmpdir(), "hf-onset-"));
      const workDir = mkdtempSync(join(tmpdir(), "hf-onset-work-"));
      tempDirs.push(projectDir, workDir);
      const sourcePath = join(projectDir, "tone.wav");
      const outputPath = join(projectDir, MIXED_AUDIO_FILENAME);
      const setup = spawnSync(
        getFfmpegBinary(),
        [
          "-nostdin",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=1000:duration=1:sample_rate=48000",
          "-c:a",
          "pcm_s16le",
          sourcePath,
        ],
        { encoding: "utf-8" },
      );
      expect(setup.status, setup.stderr).toBe(0);

      const result = await processCompositionAudio(
        [
          {
            id: "tone",
            src: "tone.wav",
            start: 2,
            end: 3,
            mediaStart: 0,
            layer: 0,
            volume: 1,
            type: "audio",
          },
        ],
        projectDir,
        workDir,
        outputPath,
        4,
        undefined,
        { ffmpegProcessTimeout: TEST_FFMPEG_TIMEOUT_MS },
      );

      expectMixed(result);
      expect(firstAudibleSeconds(outputPath)).toBeCloseTo(2, 2);
    });
  },
  FFMPEG_TEST_TIMEOUT_MS,
);

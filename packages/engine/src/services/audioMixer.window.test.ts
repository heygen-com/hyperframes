import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getFfmpegBinary, getFfprobeBinary } from "../utils/ffmpegBinaries.js";
import { MIXED_AUDIO_FILENAME, processCompositionAudio } from "./audioMixer.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;
const tempDirs: string[] = [];

function durationSeconds(path: string): number {
  const result = spawnSync(
    getFfprobeBinary(),
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "--", path],
    { encoding: "utf-8" },
  );
  return Number(result.stdout.trim());
}

function firstAudibleSeconds(path: string): number {
  const sampleRate = 48_000;
  const result = spawnSync(
    getFfmpegBinary(),
    ["-nostdin", "-v", "error", "-i", path, "-ac", "1", "-ar", "48000", "-f", "s16le", "-"],
    { maxBuffer: 1 << 28 },
  );
  const pcm = result.stdout;
  for (let i = 0; i < pcm.length / 2; i += 1) {
    if (Math.abs(pcm.readInt16LE(i * 2)) > 512) return i / sampleRate;
  }
  return Number.NaN;
}

function tone(dir: string): void {
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
      join(dir, "tone.wav"),
    ],
    { encoding: "utf-8" },
  );
  expect(setup.status, setup.stderr).toBe(0);
}

describe.skipIf(!HAS_FFMPEG)(
  "processCompositionAudio window",
  () => {
    afterEach(() => {
      for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    it("delivers only the window of the whole mix, shifted to start at 0", async () => {
      const projectDir = mkdtempSync(join(tmpdir(), "hf-window-"));
      const workDir = mkdtempSync(join(tmpdir(), "hf-window-work-"));
      tempDirs.push(projectDir, workDir);
      tone(projectDir);
      const outputPath = join(projectDir, MIXED_AUDIO_FILENAME);
      const pcmPath = join(projectDir, "delivery.wav");

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
        5,
        undefined,
        { keepEncoderInputAt: pcmPath, window: { startSeconds: 1.5, durationSeconds: 2 } },
      );

      expect(result.success).toBe(true);
      expect(durationSeconds(pcmPath)).toBeCloseTo(2, 3);
      expect(durationSeconds(outputPath)).toBeCloseTo(2, 1);
      // The tone starts 2 s into the film, so 0.5 s into a window that starts at 1.5 s.
      expect(firstAudibleSeconds(pcmPath)).toBeCloseTo(0.5, 2);
      expect(firstAudibleSeconds(outputPath)).toBeCloseTo(0.5, 1);
    });
  },
  30_000,
);

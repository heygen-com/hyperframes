import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { processCompositionAudio } from "./audioMixer.js";

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

describe.skipIf(!HAS_FFMPEG)("processCompositionAudio levels", () => {
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
    );

    expect(result.success).toBe(true);
    expect(meanVolumeDb(outputPath) - meanVolumeDb(sourcePath)).toBeGreaterThan(-0.3);
  });
});

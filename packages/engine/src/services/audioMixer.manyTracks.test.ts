import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { MAX_MIX_INPUTS, MIXED_AUDIO_FILENAME, processCompositionAudio } from "./audioMixer.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;
const tempDirs: string[] = [];

function meanVolumeDb(path: string): number {
  const result = spawnSync(
    getFfmpegBinary(),
    ["-nostdin", "-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf-8" },
  );
  const match = result.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
  if (result.status !== 0 || !match?.[1]) throw new Error(`Could not measure: ${result.stderr}`);
  return Number(match[1]);
}

function peakDb(path: string): number {
  const result = spawnSync(
    getFfmpegBinary(),
    ["-nostdin", "-hide_banner", "-i", path, "-af", "astats", "-f", "null", "-"],
    { encoding: "utf-8" },
  );
  const match = result.stderr.match(/Peak level dB:\s*(-?[\d.]+)/);
  if (result.status !== 0 || !match?.[1]) throw new Error(`Could not measure: ${result.stderr}`);
  return Number(match[1]);
}

function writeTone(path: string, seconds: number, gain: number): void {
  const result = spawnSync(
    getFfmpegBinary(),
    [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${seconds}:sample_rate=48000`,
      "-af",
      `volume=${gain}`,
      "-c:a",
      "pcm_s16le",
      path,
    ],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) throw new Error(`Could not write tone: ${result.stderr}`);
}

const clip = (i: number, start: number, end: number, groupId?: string) => ({
  id: `c${i}`,
  src: `a${i}.wav`,
  start,
  end,
  mediaStart: 0,
  layer: i,
  volume: 1,
  type: "audio" as const,
  ...(groupId ? { groupId } : {}),
});

describe.skipIf(!HAS_FFMPEG)("a mix with more clips than one ffmpeg graph can hold", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function mix(
    count: number,
    groupId: string | undefined,
    shape: { stackGain: number } | "sequence",
  ) {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-many-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-many-work-"));
    tempDirs.push(projectDir, workDir);
    const stacked = shape !== "sequence";
    writeTone(join(projectDir, "a.wav"), stacked ? 2 : 0.2, stacked ? shape.stackGain : 1);
    for (let i = 0; i < count; i++)
      copyFileSync(join(projectDir, "a.wav"), join(projectDir, `a${i}.wav`));
    const clips = Array.from({ length: count }, (_, i) =>
      stacked ? clip(i, 0, 2, groupId) : clip(i, i * 0.05, (i + 1) * 0.05, groupId),
    );
    const out = join(projectDir, MIXED_AUDIO_FILENAME);
    const sum = join(projectDir, "sum.wav");
    const result = await processCompositionAudio(
      clips,
      projectDir,
      workDir,
      out,
      stacked ? 2 : count * 0.05,
      undefined,
      { keepEncoderInputAt: sum },
    );
    return { result, out, sum };
  }

  it("mixes 200 clips in one group at the level of a short group", async () => {
    const small = await mix(8, "sfx", "sequence");
    const many = await mix(200, "sfx", "sequence");
    expect(many.result.failures ?? []).toEqual([]);
    expect(many.result.success).toBe(true);
    expect(Math.abs(meanVolumeDb(many.out) - meanVolumeDb(small.out))).toBeLessThan(1);
  }, 120_000);

  it("mixes 200 ungrouped clips at the level of a short mix", async () => {
    const small = await mix(8, undefined, "sequence");
    const many = await mix(200, undefined, "sequence");
    expect(many.result.failures ?? []).toEqual([]);
    expect(many.result.success).toBe(true);
    expect(Math.abs(meanVolumeDb(many.out) - meanVolumeDb(small.out))).toBeLessThan(1);
    expect(readdirSync(dirname(many.out)).filter((f) => f.startsWith(".mix-batches-"))).toEqual([]);
  }, 120_000);

  it.each([
    ["ungrouped", undefined],
    ["grouped", "sfx"],
  ])(
    "sums %s clips past the slice size at the gain the flat mix gives",
    async (_name, groupId) => {
      // Stacked coherent clips add, so 120 at gain g and 60 at gain 2g have the same sum.
      // 60 is one flat graph; 120 is staged. The float sums must peak alike.
      const flat = await mix(60, groupId, { stackGain: 0.1 });
      const staged = await mix(MAX_MIX_INPUTS + 24, groupId, { stackGain: 0.05 });
      expect(flat.result.success).toBe(true);
      expect(staged.result.success).toBe(true);
      expect(Math.abs(peakDb(staged.sum) - peakDb(flat.sum))).toBeLessThan(0.1);
    },
    120_000,
  );
});

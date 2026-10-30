import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";

const running = vi.hoisted(() => ({ now: 0, peak: 0 }));

vi.mock("../utils/runFfmpeg.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/runFfmpeg.js")>();
  return {
    ...actual,
    runFfmpeg: async (...args: Parameters<typeof actual.runFfmpeg>) => {
      running.peak = Math.max(running.peak, ++running.now);
      try {
        return await actual.runFfmpeg(...args);
      } finally {
        running.now--;
      }
    },
  };
});

const { MIXED_AUDIO_FILENAME, processCompositionAudio } = await import("./audioMixer.js");

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;
const tempDirs: string[] = [];

describe.skipIf(!HAS_FFMPEG)("preparing the clips of a long mix", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("runs no more ffmpeg at once than half the cores", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-prep-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-prep-work-"));
    tempDirs.push(projectDir, workDir);
    const tone = spawnSync(
      getFfmpegBinary(),
      [
        "-nostdin",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=duration=0.2",
        "-y",
        join(projectDir, "a.wav"),
      ],
      { encoding: "utf-8" },
    );
    expect(tone.status).toBe(0);
    const slots = Math.max(2, Math.floor(cpus().length / 2));
    const count = Math.max(40, slots * 3);
    const clips = Array.from({ length: count }, (_, i) => {
      copyFileSync(join(projectDir, "a.wav"), join(projectDir, `a${i}.wav`));
      return {
        id: `c${i}`,
        src: `a${i}.wav`,
        start: i * 0.1,
        end: i * 0.1 + 0.1,
        mediaStart: 0,
        layer: i,
        volume: 1,
        type: "audio" as const,
      };
    });

    const result = await processCompositionAudio(
      clips,
      projectDir,
      workDir,
      join(projectDir, MIXED_AUDIO_FILENAME),
      count * 0.1,
    );

    expect(result.success).toBe(true);
    expect(running.peak).toBeGreaterThan(0);
    expect(running.peak).toBeLessThanOrEqual(slots);
  }, 120_000);
});

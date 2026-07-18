import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { padOrTrimAudioToVideoFrameCount } from "./audioPadTrim.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)("audio pad real-media packet contract", () => {
  it("normalizes a tiny raw-ADTS pad without an oversized terminal packet", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-pad-"));
    dirs.push(dir);
    const input = join(dir, "input.aac");
    const output = join(dir, "normalized.m4a");
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=16.04",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-f",
      "adts",
      input,
    ]);
    const result = await padOrTrimAudioToVideoFrameCount({
      videoPath: join(dir, "video.mp4"),
      audioPath: input,
      outputPath: output,
      probeVideoFrameInfo: async () => ({ frameCount: 482, fpsNum: 30, fpsDen: 1 }),
      probeAudioInfo: async () => ({ durationSeconds: 16.04 }),
      runFfmpeg: async (args) => {
        const p = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]);
        return { success: p.status === 0, error: p.stderr?.toString() };
      },
    });
    expect(result.success).toBe(true);
    const probe: {
      streams?: Array<{ duration?: string }>;
      packets?: Array<{ duration_time?: string }>;
    } = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=duration",
          "-show_entries",
          "packet=duration_time",
          "-of",
          "json",
          output,
        ],
        { encoding: "utf8" },
      ),
    );
    const duration = Number(probe.streams?.[0]?.duration);
    const packets = probe.packets ?? [];
    expect(duration).toBeGreaterThan(16.0);
    expect(duration).toBeLessThan(16.1);
    expect(Number(packets.at(-1)?.duration_time)).toBeLessThan(0.1);
  });
});

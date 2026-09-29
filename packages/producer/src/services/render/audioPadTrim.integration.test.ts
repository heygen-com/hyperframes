import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getFfmpegBinary, muxVideoWithAudio } from "@hyperframes/engine";
import { padOrTrimAudioToVideoFrameCount } from "./audioPadTrim.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function measureLoudness(path: string): { integratedLufs: number; truePeakDbfs: number } {
  const result = spawnSync(
    getFfmpegBinary(),
    [
      "-nostdin",
      "-hide_banner",
      "-nostats",
      "-i",
      path,
      "-af",
      "ebur128=peak=true",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  const integrated = [...result.stderr.matchAll(/^\s*I:\s*([+-]?[\d.]+) LUFS$/gm)].at(-1)?.[1];
  const truePeak = [...result.stderr.matchAll(/^\s*Peak:\s*([+-]?[\d.]+) dBFS$/gm)].at(-1)?.[1];
  if (result.status !== 0 || integrated === undefined || truePeak === undefined) {
    throw new Error(`Could not measure loudness: ${result.stderr}`);
  }
  return { integratedLufs: Number(integrated), truePeakDbfs: Number(truePeak) };
}

const hasFfmpeg = (() => {
  try {
    execFileSync(getFfmpegBinary(), ["-version"], { stdio: "ignore" });
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
          "--",
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

  it("keeps the delivered AAC below its true-peak ceiling", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-aac-peak-"));
    dirs.push(dir);
    const source = join(dir, "source.wav");
    const mixed = join(dir, "mixed.m4a");
    const video = join(dir, "video.mp4");
    const normalized = join(dir, "normalized.m4a");
    const delivered = join(dir, "delivered.mp4");
    const ffmpeg = getFfmpegBinary();

    const sourceResult = spawnSync(ffmpeg, [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=if(gte(sin(2*PI*5000*t)\\,0)\\,0.60042\\,-0.60042)|if(gte(sin(2*PI*5000*t)\\,0)\\,0.60042\\,-0.60042):s=48000:d=3:c=stereo",
      "-c:a",
      "pcm_f32le",
      source,
    ]);
    expect(sourceResult.status, sourceResult.stderr?.toString()).toBe(0);
    const mixResult = spawnSync(ffmpeg, [
      "-nostdin",
      "-v",
      "error",
      "-i",
      source,
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      mixed,
    ]);
    expect(mixResult.status, mixResult.stderr?.toString()).toBe(0);
    const videoResult = spawnSync(ffmpeg, [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=black:size=16x16:rate=30:duration=3",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      video,
    ]);
    expect(videoResult.status, videoResult.stderr?.toString()).toBe(0);

    const normalizedResult = await padOrTrimAudioToVideoFrameCount({
      videoPath: video,
      audioPath: mixed,
      outputPath: normalized,
      probeVideoFrameInfo: async () => ({ frameCount: 90, fpsNum: 30, fpsDen: 1 }),
      probeAudioInfo: async () => ({ durationSeconds: 3.029333 }),
    });
    expect(normalizedResult.success, normalizedResult.error).toBe(true);
    expect(normalizedResult.operation).toBe("trim");

    const muxResult = await muxVideoWithAudio(video, normalized, delivered);
    expect(muxResult.success, muxResult.error).toBe(true);
    const sourceLevel = measureLoudness(source);
    const deliveredLevel = measureLoudness(delivered);
    expect(sourceLevel.truePeakDbfs).toBeCloseTo(-1.5, 1);
    expect(deliveredLevel.truePeakDbfs).toBeLessThanOrEqual(-1);
    expect(
      Math.abs(deliveredLevel.integratedLufs - sourceLevel.integratedLufs),
    ).toBeLessThanOrEqual(3);
  });
});

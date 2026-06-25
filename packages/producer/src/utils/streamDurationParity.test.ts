import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getFfmpegBinary } from "@hyperframes/engine";
import { checkStreamDurationParity, MAX_STREAM_DRIFT_SECONDS } from "../regression-harness.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function mktmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-parity-"));
  tempDirs.push(dir);
  return dir;
}

function ffmpeg(args: string[]): void {
  execFileSync(getFfmpegBinary(), ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    timeout: 30_000,
  });
}

function muxWithMatchingDurations(dir: string): string {
  const out = join(dir, "matched.mp4");
  const video = join(dir, "v.mp4");
  const audio = join(dir, "a.aac");
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=64x64:d=5:r=30",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    video,
  ]);
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=5",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    audio,
  ]);
  ffmpeg([
    "-i",
    video,
    "-i",
    audio,
    "-c:v",
    "copy",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    out,
  ]);
  return out;
}

function muxWithTruncatedVideo(dir: string): string {
  const out = join(dir, "truncated.mp4");
  const video = join(dir, "v-short.mp4");
  const audio = join(dir, "a-long.aac");
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=64x64:d=2:r=30",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    video,
  ]);
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=10",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    audio,
  ]);
  ffmpeg([
    "-i",
    video,
    "-i",
    audio,
    "-c:v",
    "copy",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    out,
  ]);
  return out;
}

describe("checkStreamDurationParity", () => {
  it("passes when video and audio durations match", async () => {
    const dir = mktmp();
    const video = muxWithMatchingDurations(dir);
    const result = await checkStreamDurationParity(video);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
    expect(result!.driftSeconds).toBeLessThanOrEqual(MAX_STREAM_DRIFT_SECONDS);
  });

  it("fails when video is truncated relative to audio (regression #1648)", async () => {
    const dir = mktmp();
    const video = muxWithTruncatedVideo(dir);
    const result = await checkStreamDurationParity(video);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.videoDurationSeconds).toBeLessThan(3);
    expect(result!.audioDurationSeconds).toBeGreaterThan(9);
    expect(result!.driftSeconds).toBeGreaterThan(MAX_STREAM_DRIFT_SECONDS);
  });

  it("returns null for video-only files (no audio stream)", async () => {
    const dir = mktmp();
    const video = join(dir, "silent.mp4");
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "color=c=green:s=64x64:d=3:r=30",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      video,
    ]);
    const result = await checkStreamDurationParity(video);
    expect(result).toBeNull();
  });
});

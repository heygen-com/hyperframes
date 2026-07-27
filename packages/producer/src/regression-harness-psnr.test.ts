// Equivalence tests for the regression harness's PSNR comparison.
//
// `psnrPerFrame()` replaced a loop that spawned one ffmpeg per checkpoint with
// `select='eq(n,N)'`. That filter has no index, so every spawn re-decoded from
// frame 0 and the comparison phase grew quadratically with checkpoint count.
// These tests pin the replacement to the behaviour of the method it replaced:
// the same frame must yield the same PSNR, within the two-decimal precision
// that ffmpeg's `stats_file` reports.
//
// Lives in the integration lane (see scripts/test-classification.mjs) because
// it shells out to a real ffmpeg.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frameIndexForCheckpoint, psnrAtCheckpoint, psnrAtFrames } from "./regression-harness.js";

const FPS = 30;
const TOTAL_FRAMES = 60;
const SAMPLE_FRAMES = [0, 1, 15, 30, 45, 59];

let workDir: string;
let referenceVideo: string;
let degradedVideo: string;
/** Same pixels as `degradedVideo`, but a timeline framesync cannot align. */
let rebasedVideo: string;
/** Half the frames of `referenceVideo`, for one-sided end-of-stream cases. */
let halfLengthVideo: string;

/**
 * The pre-existing per-checkpoint implementation, kept here as the oracle.
 * Any divergence between this and `psnrPerFrame()` is a behaviour change in
 * the regression suite's pass/fail decisions.
 */
function legacyPsnrAtFrame(videoA: string, videoB: string, frameIndex: number): number {
  const filter =
    `[0:v]select='eq(n\\,${frameIndex})',setpts=PTS-STARTPTS[rv];` +
    `[1:v]select='eq(n\\,${frameIndex})',setpts=PTS-STARTPTS[gv];[rv][gv]psnr`;
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "info",
      "-i",
      videoA,
      "-i",
      videoB,
      "-filter_complex",
      filter,
      "-frames:v",
      "1",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf-8" },
  );
  const match = result.stderr.match(/average:\s*(\S+)/i);
  if (!match) throw new Error(`legacy PSNR parse failed at frame ${frameIndex}`);
  const raw = (match[1] ?? "").trim().toLowerCase();
  return raw === "inf" || raw === "infinite" ? Number.POSITIVE_INFINITY : Number(raw);
}

function ffmpeg(args: string[]): void {
  const result = spawnSync("ffmpeg", args, { encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`ffmpeg fixture setup failed: ${result.stderr}`);
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "hf-psnr-test-"));
  referenceVideo = join(workDir, "reference.mp4");
  degradedVideo = join(workDir, "degraded.mp4");

  // testsrc2 is deterministic, so these fixtures are reproducible across hosts.
  ffmpeg([
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=320x240:rate=${FPS}:duration=${TOTAL_FRAMES / FPS}`,
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-y",
    referenceVideo,
  ]);
  // Re-encode hard enough to land well inside the PSNR range fixtures use.
  ffmpeg([
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    referenceVideo,
    "-c:v",
    "libx264",
    "-crf",
    "40",
    "-pix_fmt",
    "yuv420p",
    "-y",
    degradedVideo,
  ]);

  // Identical frames to degradedVideo, re-timed to a different rate. Rendered
  // output does not carry its baseline's timestamps, and comparing the two
  // streams directly lets framesync pair frames by PTS instead of by index —
  // the bug that made style-3-prod fail 10 checkpoints. Frame N here must
  // still compare against frame N of the reference.
  rebasedVideo = join(workDir, "rebased.mp4");
  ffmpeg([
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    degradedVideo,
    "-vf",
    "setpts=N/25/TB",
    "-r",
    "25",
    "-c:v",
    "libx264",
    "-crf",
    "40",
    "-pix_fmt",
    "yuv420p",
    "-y",
    rebasedVideo,
  ]);

  // Exactly half the frames, same rate. Used for one-sided EOF: requesting an
  // index this video does not have must fail rather than silently pair against
  // its repeated last frame.
  halfLengthVideo = join(workDir, "half.mp4");
  ffmpeg([
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=320x240:rate=${FPS}:duration=${TOTAL_FRAMES / 2 / FPS}`,
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-y",
    halfLengthVideo,
  ]);
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("psnrAtFrames()", () => {
  it("returns exactly the frames asked for", () => {
    const byFrame = psnrAtFrames(referenceVideo, degradedVideo, SAMPLE_FRAMES);
    expect([...byFrame.keys()].sort((a, b) => a - b)).toEqual(SAMPLE_FRAMES);
  });

  it("matches the per-checkpoint ffmpeg method it replaced", () => {
    const byFrame = psnrAtFrames(referenceVideo, degradedVideo, SAMPLE_FRAMES);
    // Sample across the whole range: the old method's cost grew with frame
    // index, so late frames are exactly where a regression would hide.
    for (const frameIndex of SAMPLE_FRAMES) {
      const actual = byFrame.get(frameIndex);
      const expected = legacyPsnrAtFrame(referenceVideo, degradedVideo, frameIndex);
      expect(actual).toBeDefined();
      // stats_file reports two decimals; the legacy stderr parse was full float.
      expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(0.01);
    }
  });

  it("pairs by frame index even when the two videos carry different timelines", () => {
    // The regression this guards: a rendered output whose PTS cadence differs
    // from the baseline's must still be compared frame-for-frame. Letting
    // framesync align by timestamp silently compares unrelated frames.
    const byFrame = psnrAtFrames(referenceVideo, rebasedVideo, SAMPLE_FRAMES);
    expect([...byFrame.keys()].sort((a, b) => a - b)).toEqual(SAMPLE_FRAMES);
    for (const frameIndex of SAMPLE_FRAMES) {
      const expected = legacyPsnrAtFrame(referenceVideo, rebasedVideo, frameIndex);
      expect(Math.abs((byFrame.get(frameIndex) as number) - expected)).toBeLessThanOrEqual(0.01);
    }
  });

  it("deduplicates repeated frame indices without losing alignment", () => {
    // Fixtures shorter than 100 frames map several checkpoints onto one frame.
    // `select` emits that frame once, so the row-to-frame mapping has to
    // account for it or every later value shifts.
    const withRepeats = [0, 0, 15, 15, 15, 59];
    const byFrame = psnrAtFrames(referenceVideo, degradedVideo, withRepeats);
    expect([...byFrame.keys()].sort((a, b) => a - b)).toEqual([0, 15, 59]);
    for (const frameIndex of [0, 15, 59]) {
      const expected = legacyPsnrAtFrame(referenceVideo, degradedVideo, frameIndex);
      expect(Math.abs((byFrame.get(frameIndex) as number) - expected)).toBeLessThanOrEqual(0.01);
    }
  });

  it("is insensitive to the order frame indices are supplied in", () => {
    const ascending = psnrAtFrames(referenceVideo, degradedVideo, [1, 30, 59]);
    const shuffled = psnrAtFrames(referenceVideo, degradedVideo, [59, 1, 30]);
    expect([...shuffled.entries()].sort()).toEqual([...ascending.entries()].sort());
  });

  it("reports identical video as infinite PSNR, as the legacy method did", () => {
    const byFrame = psnrAtFrames(referenceVideo, referenceVideo, SAMPLE_FRAMES);
    expect([...byFrame.values()].every((value) => value === Number.POSITIVE_INFINITY)).toBe(true);
    expect(legacyPsnrAtFrame(referenceVideo, referenceVideo, 10)).toBe(Number.POSITIVE_INFINITY);
  });

  it("throws rather than mis-pairing when a frame is past the end of both videos", () => {
    expect(() => psnrAtFrames(referenceVideo, degradedVideo, [0, TOTAL_FRAMES + 50])).toThrow(
      /differ in frame count|Expected PSNR/,
    );
  });

  it("throws when only one input runs out of frames", () => {
    // The asymmetric case, and the one the test above cannot reach: there both
    // inputs end together, so framesync ends too. With only one side short,
    // framesync's repeatlast default holds that side's last selected frame and
    // pads the pairing to full length — ffmpeg then writes one row per
    // requested frame and the count guard sees nothing wrong, while the tail
    // rows silently compare against a stale frame.
    expect(() => psnrAtFrames(referenceVideo, halfLengthVideo, [0, 15, 45])).toThrow(
      /differ in frame count|Expected PSNR/,
    );
  });

  it("still compares every requested frame when one input is merely shorter than the last index", () => {
    // Guard against over-correcting: truncation must fail, but a shorter input
    // that still covers every requested index has to keep working.
    const byFrame = psnrAtFrames(referenceVideo, halfLengthVideo, [0, 10, 29]);
    expect([...byFrame.keys()].sort((a, b) => a - b)).toEqual([0, 10, 29]);
  });

  it("returns an empty map when asked for nothing", () => {
    expect(psnrAtFrames(referenceVideo, degradedVideo, []).size).toBe(0);
  });
});

describe("psnrAtCheckpoint()", () => {
  it("maps a checkpoint time to the same frame index the legacy code used", () => {
    const times = [0, 0.5, 1, 1.9];
    const byFrame = psnrAtFrames(
      referenceVideo,
      degradedVideo,
      times.map((time) => frameIndexForCheckpoint(time, FPS)),
    );
    for (const time of times) {
      // Math.round(time * fps) is the mapping the per-checkpoint code used.
      expect(frameIndexForCheckpoint(time, FPS)).toBe(Math.round(time * FPS));
      expect(psnrAtCheckpoint(byFrame, time, FPS)).toBe(
        byFrame.get(Math.round(time * FPS)) as number,
      );
    }
  });

  it("throws when the requested frame was not among those compared", () => {
    const byFrame = psnrAtFrames(referenceVideo, degradedVideo, [0, 15]);
    expect(() => psnrAtCheckpoint(byFrame, 1.5, FPS)).toThrow(/Unable to parse PSNR output/);
  });
});

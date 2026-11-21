import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runFfmpeg } from "../utils/runFfmpeg.js";
import { extractVideoFramesRange, type ExtractedFrames } from "./videoFrameExtractor.js";

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;
const WIDTH = 32;
const HEIGHT = 16;

// B-frames at a 1/600 timescale (what Apple devices write) store each frame one tick long.
describe.skipIf(!HAS_FFMPEG)("a window that ends at the source's end", () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "hf-final-frame-"));
  const source = join(fixtureDir, "index-30fps-bframes-ts600.mov");

  beforeAll(async () => {
    // Frame k carries luma 16 + 2k, so each extracted frame names its source index.
    const synth = await runFfmpeg([
      ...["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i"],
      `nullsrc=s=${WIDTH}x${HEIGHT}:r=30:d=1.5,geq=lum='16+2*N':cb=128:cr=128`,
      ...["-c:v", "libx264", "-qp", "1", "-bf", "2", "-pix_fmt", "yuv420p"],
      ...["-video_track_timescale", "600", source],
    ]);
    if (!synth.success) throw new Error(`b-frame fixture synthesis failed: ${synth.stderr}`);
  }, 30_000);

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  function sourceIndexes(extracted: ExtractedFrames): number[] {
    const decoded = spawnSync("ffmpeg", [
      ...["-v", "error", "-i", join(extracted.outputDir, extracted.framePattern)],
      ...["-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"],
    ]);
    if (decoded.status !== 0) throw new Error(decoded.stderr.toString());
    const indexes: number[] = [];
    for (let offset = 0; offset < decoded.stdout.length; offset += WIDTH * HEIGHT) {
      indexes.push(Math.round(((decoded.stdout[offset] ?? 0) * 219) / 255 / 2));
    }
    return indexes;
  }

  it("keeps the last frame of a window that ends at the source's end", async () => {
    const extracted = await extractVideoFramesRange(source, "bframes-tail", 37 / 30, 8 / 30, {
      fps: 30,
      outputDir: fixtureDir,
      format: "png",
    });
    expect(sourceIndexes(extracted)).toEqual([37, 38, 39, 40, 41, 42, 43, 44]);
  }, 30_000);
});

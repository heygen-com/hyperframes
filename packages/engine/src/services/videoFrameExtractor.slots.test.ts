import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runFfmpeg } from "../utils/runFfmpeg.js";
import { extractAllVideoFrames, type ExtractedFrames } from "./videoFrameExtractor.js";

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;
const WIDTH = 32;
const HEIGHT = 16;

describe.skipIf(!HAS_FFMPEG)("a clip's frames match the output frames it is on screen", () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "hf-clip-slots-"));
  const source = join(fixtureDir, "index-30fps.mp4");

  beforeAll(async () => {
    // Frame k carries luma 16 + 2k, so each extracted frame names its source index.
    const synth = await runFfmpeg([
      ...["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i"],
      `nullsrc=s=${WIDTH}x${HEIGHT}:r=30:d=1.5,geq=lum='16+2*N':cb=128:cr=128`,
      ...["-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv420p", source],
    ]);
    if (!synth.success) throw new Error(`index fixture synthesis failed: ${synth.stderr}`);
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

  it.each([
    // On screen at output frames 1..8: 0.01 <= f/30 < 0.28.
    { label: "0.01-0.28 s", start: 0.01, end: 0.28, onScreen: [0, 1, 2, 3, 4, 5, 6, 7] },
    // On screen at output frames 0..8: f/30 < 0.27.
    { label: "0-0.27 s", start: 0, end: 0.27, onScreen: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
  ])(
    "gives a $label clip a new source frame on every output frame it is on screen",
    async (c) => {
      const id = `slots-${c.start}-${c.end}`;
      const result = await extractAllVideoFrames(
        [
          {
            id,
            src: source,
            start: c.start,
            end: c.end,
            mediaStart: 0,
            loop: false,
            hasAudio: false,
          },
        ],
        fixtureDir,
        { fps: 30, outputDir: join(fixtureDir, id), format: "png" },
      );
      expect(result.errors).toEqual([]);
      expect(sourceIndexes(result.extracted[0]!)).toEqual(c.onScreen);
    },
    30_000,
  );
});

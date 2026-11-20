import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runFfmpeg } from "../utils/runFfmpeg.js";
import { extractVideoFramesRange, type ExtractedFrames } from "./videoFrameExtractor.js";

const rebuildCopies = vi.hoisted(() => [] as number[]);
const failingCopy = vi.hoisted(() => ({ throws: false, dirs: [] as string[] }));

// Pass-through that records how many bytes each seek-index copy wrote before it is removed.
vi.mock("../utils/runFfmpeg.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../utils/runFfmpeg.js")>();
  return {
    ...real,
    runFfmpeg: async (...call: Parameters<typeof real.runFfmpeg>) => {
      const output = call[0].at(-1) ?? "";
      if (failingCopy.throws && output.endsWith("source.mov")) {
        failingCopy.dirs.push(dirname(output));
        throw new Error("ffmpeg could not start");
      }
      const result = await real.runFfmpeg(...call);
      if (output.endsWith("source.mov")) {
        rebuildCopies.push(existsSync(output) ? statSync(output).size : 0);
      }
      return result;
    },
  };
});

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;
const WIDTH = 32;
const HEIGHT = 16;

/**
 * Drops the first entry of the MP4's sync-sample table (`stss`), as VLC's muxer does: the
 * IDR at the start is still in the bitstream, but the index no longer lists it.
 */
function dropFirstSyncSample(source: string, target: string): void {
  const bytes = readFileSync(source);
  const at = bytes.indexOf("stss");
  if (at < 0) throw new Error("fixture has no stss box");
  const count = bytes.readUInt32BE(at + 8);
  if (count < 2 || bytes.readUInt32BE(at + 12) !== 1) {
    throw new Error(`fixture needs a keyframe at sample 1 and another later (stss has ${count})`);
  }
  for (let entry = 1; entry < count; entry++) {
    bytes.writeUInt32BE(bytes.readUInt32BE(at + 12 + 4 * entry), at + 12 + 4 * (entry - 1));
  }
  bytes.writeUInt32BE(count - 1, at + 8);
  writeFileSync(target, bytes);
}

/** Box offset of `type` in an MP4 whose boxes up to it are each found once. */
function boxAt(bytes: Buffer, type: string): number {
  const at = bytes.indexOf(type);
  if (at < 4) throw new Error(`fixture has no ${type} box`);
  return at - 4;
}

/**
 * Repeats the first edit-list entry so the demuxer plays the same samples `repeats` times. The
 * file stays a few kilobytes while a stream copy of it writes every repeat. Needs `moov` after
 * `mdat`, so growing it moves no chunk offsets.
 */
function repeatEditList(source: string, target: string, repeats: number): void {
  const bytes = readFileSync(source);
  const elst = boxAt(bytes, "elst");
  if (bytes[elst + 8] !== 0 || bytes.readUInt32BE(elst + 12) !== 1) {
    throw new Error("fixture needs a single version-0 edit-list entry");
  }
  if (boxAt(bytes, "moov") < boxAt(bytes, "mdat")) throw new Error("fixture needs moov last");
  const entry = bytes.subarray(elst + 16, elst + 28);
  const extra = Buffer.concat(Array.from({ length: repeats - 1 }, () => entry));
  const grown = Buffer.concat([bytes.subarray(0, elst + 28), extra, bytes.subarray(elst + 28)]);
  grown.writeUInt32BE(repeats, elst + 12);
  for (const type of ["elst", "edts", "trak", "moov"]) {
    const at = boxAt(grown, type);
    grown.writeUInt32BE(grown.readUInt32BE(at) + extra.length, at);
  }
  writeFileSync(target, grown);
}

describe.skipIf(!HAS_FFMPEG)("an MP4 whose sync-sample index leaves out the first keyframe", () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "hf-seek-index-fixture-"));
  const indexed = join(fixtureDir, "indexed.mp4");
  const source = join(fixtureDir, "first-idr-unindexed.mp4");

  beforeAll(async () => {
    // 4s at 10fps, keyframes at 0s and 2s only. Each frame has its own luma.
    const synth = await runFfmpeg([
      ...["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i"],
      `nullsrc=s=${WIDTH}x${HEIGHT}:r=10:d=4,geq=lum='16+2*N':cb=128:cr=128`,
      ...["-c:v", "libx264", "-qp", "1", "-pix_fmt", "yuv420p"],
      ...["-x264-params", "keyint=20:min-keyint=20:scenecut=0", indexed],
    ]);
    if (!synth.success) throw new Error(`fixture synthesis failed: ${synth.stderr}`);
    dropFirstSyncSample(indexed, source);
    // The fixture must reproduce the bug: an input seek before 2s finds no index entry.
    const seek = await runFfmpeg([
      "-noaccurate_seek",
      "-ss",
      "0.5",
      "-i",
      source,
      "-f",
      "null",
      "-",
    ]);
    if (!/Cannot find an index entry before timestamp|could not seek/.test(seek.stderr)) {
      throw new Error(`fixture seeks normally; it no longer reproduces the bug: ${seek.stderr}`);
    }
  }, 30_000);

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    rebuildCopies.length = 0;
    failingCopy.throws = false;
  });

  /** Every frame the extraction wrote, decoded to gray pixels, in frame order. */
  function decodedFrames(extracted: ExtractedFrames): Buffer[] {
    return [...extracted.framePaths.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, path]) => {
        const decoded = spawnSync("ffmpeg", [
          ...["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"],
        ]);
        if (decoded.status !== 0) throw new Error(decoded.stderr.toString());
        return decoded.stdout;
      });
  }

  it("extracts a window before the first indexed keyframe", async () => {
    const outputDir = mkdtempSync(join(fixtureDir, "window-"));
    const options = { fps: 10, format: "png" as const };
    const extracted = await extractVideoFramesRange(source, "broll", 0.5, 1, {
      ...options,
      outputDir,
    });
    const reference = await extractVideoFramesRange(indexed, "broll", 0.5, 1, {
      ...options,
      outputDir: mkdtempSync(join(fixtureDir, "reference-")),
    });
    expect(extracted.totalFrames).toBe(10);
    expect(decodedFrames(extracted)).toEqual(decodedFrames(reference));
    expect(extracted.srcPath).toBe(source);
  }, 30_000);

  it("extracts a distributed chunk's frame range before the first indexed keyframe", async () => {
    const outputDir = mkdtempSync(join(fixtureDir, "range-"));
    const extracted = await extractVideoFramesRange(source, "broll", 0.2, 2, {
      fps: 10,
      outputDir,
      format: "png",
      frameRanges: [{ firstFrame: 3, frames: 4 }],
    });
    const reference = await extractVideoFramesRange(indexed, "broll", 0.2, 2, {
      fps: 10,
      outputDir: mkdtempSync(join(fixtureDir, "range-reference-")),
      format: "png",
      frameRanges: [{ firstFrame: 3, frames: 4 }],
    });
    expect([...extracted.framePaths.keys()].sort((a, b) => a - b)).toEqual([3, 4, 5, 6]);
    expect(decodedFrames(extracted)).toEqual(decodedFrames(reference));
  }, 30_000);

  it("never copies a playlist that names the clip many times", async () => {
    // ffmpeg prints the input's name, so this name alone matches the seek-failure message.
    const playlist = join(fixtureDir, "could not seek to position 0.ffconcat");
    writeFileSync(
      playlist,
      `ffconcat version 1.0\n${"file indexed.mp4\nduration 4\n".repeat(200)}`,
    );
    const extracted = await extractVideoFramesRange(playlist, "broll", 0.5, 1, {
      fps: 10,
      format: "png",
      outputDir: mkdtempSync(join(fixtureDir, "playlist-")),
    });
    expect(rebuildCopies).toEqual([]);
    expect(extracted.totalFrames).toBe(10);
  }, 30_000);

  it("stops a copy that outgrows its source at a ceiling and extracts without it", async () => {
    const looped = join(fixtureDir, "looped.mp4");
    repeatEditList(source, looped, 3000);
    const ceiling = 2 * statSync(looped).size + 1024 * 1024;
    const extracted = await extractVideoFramesRange(looped, "broll", 0.5, 1, {
      fps: 10,
      format: "png",
      outputDir: mkdtempSync(join(fixtureDir, "looped-")),
    });
    expect(rebuildCopies).toHaveLength(1);
    // ffmpeg stops past the limit and still writes the sample index, so the copy ends above it.
    expect(rebuildCopies[0]).toBeGreaterThanOrEqual(ceiling);
    expect(rebuildCopies[0]).toBeLessThan(2 * ceiling);
    expect(extracted.totalFrames).toBe(10);
  }, 60_000);

  it("removes the copy's folder when the copy throws", async () => {
    failingCopy.throws = true;
    const extraction = extractVideoFramesRange(source, "broll", 0.5, 1, {
      fps: 10,
      format: "png",
      outputDir: mkdtempSync(join(fixtureDir, "throws-")),
    });
    await expect(extraction).rejects.toThrow("ffmpeg could not start");
    expect(failingCopy.dirs).toHaveLength(1);
    expect(existsSync(failingCopy.dirs[0]!)).toBe(false);
  }, 30_000);
});

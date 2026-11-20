import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runFfmpeg } from "../utils/runFfmpeg.js";
import {
  extractVideoFramesRange,
  seekIndexCopyCeilingBytes,
  singleIsoBmffFileSize,
  type ExtractedFrames,
} from "./videoFrameExtractor.js";

// The real runFfmpeg, watched: the tests below count the stream copies the seek-index rebuild starts.
vi.mock("../utils/runFfmpeg.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/runFfmpeg.js")>();
  return { ...actual, runFfmpeg: vi.fn(actual.runFfmpeg) };
});

/** The rebuild's stream copies among the ffmpeg runs so far: the only runs whose output is `source.mov`. */
function seekIndexCopies(): string[][] {
  return vi
    .mocked(runFfmpeg)
    .mock.calls.map(([args]) => args)
    .filter((args) => args.at(-1)?.endsWith("source.mov"));
}

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

  describe("the rebuild stays bounded (SECOPS-3170)", () => {
    beforeEach(() => {
      vi.mocked(runFfmpeg).mockClear();
    });

    it("copies a single MP4 once, as MOV, under a ceiling tied to its size", async () => {
      await extractVideoFramesRange(source, "broll", 0.5, 1, {
        fps: 10,
        format: "png",
        outputDir: mkdtempSync(join(fixtureDir, "bounded-")),
      });
      const copies = seekIndexCopies();
      expect(copies).toHaveLength(1);
      const copy = copies[0]!;
      expect(copy[copy.indexOf("-i") - 1]).toBe("mov");
      expect(Number(copy[copy.indexOf("-fs") + 1])).toBe(
        seekIndexCopyCeilingBytes(statSync(source).size),
      );
    }, 30_000);

    it("shares one copy between extractions of the same source that run at once", async () => {
      const extract = (videoId: string) =>
        extractVideoFramesRange(source, videoId, 0.5, 1, {
          fps: 10,
          format: "png",
          outputDir: mkdtempSync(join(fixtureDir, `shared-${videoId}-`)),
        });
      const [a, b, c] = await Promise.all([extract("a"), extract("b"), extract("c")]);
      expect([a.totalFrames, b.totalFrames, c.totalFrames]).toEqual([10, 10, 10]);
      expect(seekIndexCopies()).toHaveLength(1);
    }, 30_000);

    it("never copies a playlist that repeats the MP4, whatever ffmpeg reports", async () => {
      const entries = Array.from({ length: 200 }, () => "file first-idr-unindexed.mp4").join("\n");
      const concat = join(fixtureDir, "repeat.ffconcat");
      writeFileSync(concat, `ffconcat version 1.0\n${entries}\n`);
      const hls = join(fixtureDir, "repeat.m3u8");
      const segments = Array.from(
        { length: 200 },
        () => "#EXTINF:4.0,\nfirst-idr-unindexed.mp4",
      ).join("\n");
      writeFileSync(hls, `#EXTM3U\n#EXT-X-TARGETDURATION:4\n${segments}\n#EXT-X-ENDLIST\n`);
      for (const playlist of [concat, hls]) {
        await extractVideoFramesRange(playlist, "playlist", 0.5, 1, {
          fps: 10,
          format: "png",
          outputDir: mkdtempSync(join(fixtureDir, "playlist-")),
        }).catch(() => undefined);
      }
      expect(seekIndexCopies()).toEqual([]);
    }, 60_000);

    it("counts only a single local MOV/MP4 file as rebuildable", () => {
      expect(singleIsoBmffFileSize(source)).toBe(statSync(source).size);
      const notMp4 = join(fixtureDir, "list.txt");
      writeFileSync(notMp4, "ffconcat version 1.0\nfile first-idr-unindexed.mp4\n");
      expect(singleIsoBmffFileSize(notMp4)).toBeUndefined();
      expect(singleIsoBmffFileSize(fixtureDir)).toBeUndefined();
      expect(singleIsoBmffFileSize(join(fixtureDir, "missing.mp4"))).toBeUndefined();
      expect(singleIsoBmffFileSize(`https://example.com/clip.mp4`)).toBeUndefined();
      expect(singleIsoBmffFileSize(`${source}\n`)).toBeUndefined();
    });
  });
});

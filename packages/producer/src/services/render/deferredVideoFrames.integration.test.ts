import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  extractAllVideoFrames,
  type ExtractedFrames,
  type VideoElement,
} from "@hyperframes/engine";
import { extractAllDeferredFrames, extractDeferredFrames } from "./deferredVideoFrames.js";

const metadata = {
  durationSeconds: 4,
  videoStreamDurationSeconds: 4,
  videoStreamStartSeconds: 0,
  width: 64,
  height: 36,
  fps: 30,
  videoCodec: "h264",
  hasAudio: false,
  isVFR: false,
  hasAlpha: false,
  colorSpace: null,
};

const deferredVideo = (videoId: string, totalFrames: number): ExtractedFrames => ({
  videoId,
  srcPath: `/planner/${videoId}.mp4`,
  outputDir: "",
  framePattern: "frame_%05d.jpg",
  fps: 30,
  totalFrames,
  metadata,
  framePaths: new Map(),
  deferredRange: { startTime: 1.5, durationSeconds: totalFrames / 30, format: "jpg" },
});

const fullyExtracted = (videoId: string): ExtractedFrames => {
  const { deferredRange: _deferred, ...rest } = deferredVideo(videoId, 90);
  return rest;
};

const element = (id: string, start: number, end: number): VideoElement => ({
  id,
  src: `${id}.mp4`,
  start,
  end,
  mediaStart: 1.5,
  loop: false,
  hasAudio: false,
});

const fps = { num: 30, den: 1 };
const span = (start: number, end: number) =>
  Array.from({ length: end - start }, (_, i) => start + i);

describe("extractDeferredFrames", () => {
  const root = mkdtempSync(join(tmpdir(), "hf-deferred-frames-"));
  const sourcePath = join(root, "short.mp4");

  beforeAll(() => {
    mkdirSync(root, { recursive: true });
    const synth = spawnSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=64x36:r=30:d=3",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      sourcePath,
    ]);
    if (synth.status !== 0) throw new Error(synth.stderr.toString());
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("calls onMissingFrame when the extractor returns fewer frames than the plan expected", async () => {
    const planned = deferredVideo("clip", 75);
    const missingError = new Error("plan expected more frames");
    const reported: Array<{ videoId: string; index: number }> = [];

    const extraction = extractDeferredFrames({
      videos: [element("clip", 0, 4)],
      extracted: [planned],
      frames: span(40, 62),
      fps,
      outputRoot: join(root, "out"),
      cfg: {},
      sourceOf: () => sourcePath,
      onMissingFrame: (video, index) => {
        reported.push({ videoId: video.videoId, index });
        return missingError;
      },
    });

    await expect(extraction).rejects.toBe(missingError);
    expect(reported).toEqual([{ videoId: "clip", index: 45 }]);
  });
  describe("extractAllDeferredFrames", () => {
    const framesOf = (dir: string) =>
      new Map(readdirSync(dir).map((name) => [name, readFileSync(join(dir, name))] as const));

    it("fills a deferred video in place with the frames a full extraction writes, byte for byte", async () => {
      const outputDir = join(root, "all", "clip");
      mkdirSync(outputDir, { recursive: true });
      const video: ExtractedFrames = {
        ...deferredVideo("clip", 90),
        srcPath: sourcePath,
        outputDir,
        deferredRange: { startTime: 0, durationSeconds: 3, format: "jpg" },
      };
      const untouched = fullyExtracted("whole");
      untouched.framePaths.set(0, "/kept/frame_00001.jpg");
      const entries = [video, untouched];

      const progress: Array<[number, number]> = [];
      await extractAllDeferredFrames(entries, {
        fps,
        cfg: {},
        onProgress: (done, total) => progress.push([done, total]),
      });
      expect(progress).toEqual([[90, 90]]);

      expect(entries[0]).toBe(video);
      expect(video.deferredRange).toBeUndefined();
      expect(video.outputDir).toBe(outputDir);
      expect(video.framePaths.size).toBe(90);
      expect([...video.framePaths.values()].every((path) => existsSync(path))).toBe(true);
      expect(untouched.framePaths.get(0)).toBe("/kept/frame_00001.jpg");

      const reference = await extractAllVideoFrames(
        [{ ...element("ref", 0, 3), src: sourcePath, mediaStart: 0 }],
        root,
        { fps, outputDir: join(root, "all-reference") },
      );
      const expected = framesOf(reference.extracted[0]!.outputDir);
      const actual = framesOf(outputDir);
      expect([...actual.keys()]).toEqual([...expected.keys()]);
      for (const [name, bytes] of expected)
        expect(actual.get(name)?.equals(bytes), name).toBe(true);
    }, 60_000);
  });
});

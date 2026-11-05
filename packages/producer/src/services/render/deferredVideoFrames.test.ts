import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { ExtractedFrames, VideoElement } from "@hyperframes/engine";
import { extractDeferredFrames, shownDeferredFrameIndexes } from "./deferredVideoFrames.js";

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

describe("shownDeferredFrameIndexes", () => {
  it("names the frames each deferred video shows across a frame range, and none for a video off screen", () => {
    const shown = shownDeferredFrameIndexes(
      {
        videos: [element("clip", 0, 4), element("later", 10, 12)],
        extracted: [deferredVideo("clip", 75), deferredVideo("later", 75)],
      },
      span(30, 45),
      fps,
    );

    expect([...shown.get("clip")!].sort((a, b) => a - b)).toEqual(span(30, 45));
    expect(shown.has("later")).toBe(false);
  });
});

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
});

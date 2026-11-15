import { describe, expect, it } from "bun:test";
import type { ExtractedFrames, VideoElement } from "@hyperframes/engine";
import { extractAllDeferredFrames, shownDeferredFrameIndexes } from "./deferredVideoFrames.js";

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

describe("extractAllDeferredFrames", () => {
  it("reads nothing when no video is deferred", async () => {
    const whole = fullyExtracted("whole");
    await extractAllDeferredFrames([whole], {
      fps,
      cfg: {},
      sourceOf: () => {
        throw new Error("a fully extracted video must not be read again");
      },
    });
    expect(whole.framePaths.size).toBe(0);
  });
});

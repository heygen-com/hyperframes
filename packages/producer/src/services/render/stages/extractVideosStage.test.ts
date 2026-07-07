import { describe, expect, it } from "vitest";
import { appendAutoDetectedVideoAudio, shouldCopyExtractedFrames } from "./extractVideosStage.js";
import type { ExtractedFrames, VideoElement } from "@hyperframes/engine";

function makeVideo(overrides: Partial<VideoElement> = {}): VideoElement {
  return {
    id: "v1",
    src: "clip.mp4",
    start: 0,
    end: 5,
    mediaStart: 0,
    loop: false,
    hasAudio: true,
    ...overrides,
  };
}

function makeExtracted(videoId: string, fileHasAudio: boolean): ExtractedFrames {
  return {
    videoId,
    srcPath: "/tmp/clip.mp4",
    outputDir: "/tmp/frames",
    framePattern: "frame_%05d.jpg",
    fps: 30,
    totalFrames: 150,
    framePaths: new Map(),
    metadata: {
      durationSeconds: 5,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "h264",
      hasAudio: fileHasAudio,
    },
  } as ExtractedFrames;
}

describe("appendAutoDetectedVideoAudio", () => {
  it("adds audio for an audible video whose file has an audio track", () => {
    const composition = { videos: [makeVideo()], audios: [] as never[] };
    appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", true)]);
    expect(composition.audios).toHaveLength(1);
    expect(composition.audios[0]).toMatchObject({
      id: "v1-audio",
      src: "clip.mp4",
    });
  });

  it("skips a muted video even when the source file has audio", () => {
    const composition = {
      videos: [makeVideo({ hasAudio: false })],
      audios: [] as never[],
    };
    appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", true)]);
    expect(composition.audios).toHaveLength(0);
  });

  it("skips when the source file has no audio track", () => {
    const composition = { videos: [makeVideo()], audios: [] as never[] };
    appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", false)]);
    expect(composition.audios).toHaveLength(0);
  });

  it("does not duplicate audio for a src already in the mix", () => {
    const composition = {
      videos: [makeVideo()],
      audios: [
        {
          id: "existing",
          src: "clip.mp4",
          start: 0,
          end: 5,
          mediaStart: 0,
          layer: 0,
          volume: 1,
          type: "video" as const,
        },
      ],
    };
    appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", true)]);
    expect(composition.audios).toHaveLength(1);
  });
});

describe("shouldCopyExtractedFrames", () => {
  it("copies frames on Windows (symlinkSync throws EPERM without Developer Mode)", () => {
    expect(shouldCopyExtractedFrames("win32")).toBe(true);
  });

  it("symlinks on macOS and Linux (cheaper, symlinks allowed)", () => {
    expect(shouldCopyExtractedFrames("darwin")).toBe(false);
    expect(shouldCopyExtractedFrames("linux")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  appendAutoDetectedVideoAudio,
  extractStandaloneEntryFromIndex,
} from "./renderOrchestrator.js";
import type { AudioElement, ExtractedFrames, VideoElement } from "@hyperframes/engine";

function makeVideo(overrides: Partial<VideoElement> = {}): VideoElement {
  return {
    id: "v1",
    src: "clip.mp4",
    start: 0,
    end: 5,
    mediaStart: 0,
    hasAudio: true,
    ...overrides,
  };
}

function makeExtracted(videoId: string, fileHasAudio: boolean): ExtractedFrames {
  return {
    videoId,
    srcPath: "/tmp/clip.mp4",
    outputDir: "/tmp/frames",
    framePattern: "frame_%04d.jpg",
    fps: 30,
    totalFrames: 150,
    framePaths: new Map(),
    metadata: {
      durationSeconds: 5,
      width: 1080,
      height: 1920,
      fps: 30,
      videoCodec: "h264",
      hasAudio: fileHasAudio,
      isVFR: false,
    },
  };
}

describe("appendAutoDetectedVideoAudio", () => {
  it("adds the audio of a video that declares data-has-audio", () => {
    const composition = { videos: [makeVideo()], audios: [] as AudioElement[] };

    appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", true)]);

    expect(composition.audios).toHaveLength(1);
    expect(composition.audios[0]).toMatchObject({ id: "v1-audio", src: "clip.mp4" });
  });

  it("skips a muted video even when the source file ships an audio track", () => {
    const composition = {
      videos: [makeVideo({ hasAudio: false })],
      audios: [] as AudioElement[],
    };

    appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", true)]);

    expect(composition.audios).toHaveLength(0);
  });

  it("skips files without an audio track", () => {
    const composition = { videos: [makeVideo()], audios: [] as AudioElement[] };

    appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", false)]);

    expect(composition.audios).toHaveLength(0);
  });

  it("does not duplicate audio for a src already in the mix", () => {
    const composition = {
      videos: [makeVideo()],
      audios: [
        {
          id: "music",
          src: "clip.mp4",
          start: 0,
          end: 5,
          mediaStart: 0,
          layer: 0,
          volume: 1,
          type: "audio",
        },
      ] as AudioElement[],
    };

    appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", true)]);

    expect(composition.audios).toHaveLength(1);
  });
});

describe("extractStandaloneEntryFromIndex", () => {
  it("reuses the index wrapper and keeps only the requested composition host", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>body { background: #111; }</style>
</head>
<body>
  <div id="main" data-composition-id="root" data-width="1920" data-height="1080">
    <div id="intro" data-composition-id="intro" data-composition-src="compositions/intro.html" data-start="5"></div>
    <div id="outro" data-composition-id="outro" data-composition-src="compositions/outro.html" data-start="12"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/outro.html");

    expect(extracted).toContain('data-composition-id="root"');
    expect(extracted).toContain('id="outro"');
    expect(extracted).toContain('data-composition-src="compositions/outro.html"');
    expect(extracted).toContain('data-start="0"');
    expect(extracted).not.toContain('id="intro"');
    expect(extracted).toContain("<style>body { background: #111; }</style>");
  });

  it("matches normalized data-composition-src paths", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <div id="intro" data-composition-id="intro" data-composition-src="./compositions/intro.html" data-start="3"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/intro.html");

    expect(extracted).not.toBeNull();
    expect(extracted).toContain('data-start="0"');
    expect(extracted).toContain('data-composition-src="./compositions/intro.html"');
  });

  it("returns null when index.html does not mount the requested entry file", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <div id="intro" data-composition-id="intro" data-composition-src="compositions/intro.html"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/outro.html");

    expect(extracted).toBeNull();
  });
});

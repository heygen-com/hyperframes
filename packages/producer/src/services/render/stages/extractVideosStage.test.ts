import { describe, expect, it } from "vitest";
import type {
  ExtractedFrames,
  ExtractionResult,
  VideoElement,
  VideoExtractionFailure,
} from "@hyperframes/engine";
import {
  appendAutoDetectedVideoAudio,
  assertVideoExtractionSucceeded,
  buildHdrProbeStageError,
  resolveVideoExtractionPolicy,
  shouldCopyExtractedFrames,
  VideoExtractionStageError,
} from "./extractVideosStage.js";

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

function extractionResult(errors: VideoExtractionFailure[]): ExtractionResult {
  return {
    success: errors.length === 0,
    errors,
    extracted: [],
    totalFramesExtracted: 0,
    durationMs: 1,
    phaseBreakdown: {
      resolveMs: 0,
      cachePublishFailures: 0,
      cacheGcEvictions: 0,
      cacheGcBytesFreed: 0,
      cacheAgedPartialsCleared: 0,
      hdrProbeMs: 0,
      hdrPreflightMs: 0,
      hdrPreflightCount: 0,
      vfrProbeMs: 0,
      vfrPreflightMs: 0,
      vfrPreflightCount: 0,
      extractMs: 0,
      cacheHits: 0,
      cacheMisses: 0,
      transientRetries: 0,
    },
  };
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

describe("resolveVideoExtractionPolicy", () => {
  it("preserves stable behavior by default", () => {
    expect(resolveVideoExtractionPolicy({})).toEqual({
      failureMode: "off",
      maxTransientRetries: 0,
    });
  });

  it("allows only the bounded candidate rollout values", () => {
    expect(
      resolveVideoExtractionPolicy({
        HF_VIDEO_EXTRACTION_FAILURE_MODE: "observe",
        HF_VIDEO_EXTRACTION_MAX_RETRIES: "1",
      }),
    ).toEqual({ failureMode: "observe", maxTransientRetries: 1 });
    expect(
      resolveVideoExtractionPolicy({
        HF_VIDEO_EXTRACTION_FAILURE_MODE: "unexpected",
        HF_VIDEO_EXTRACTION_MAX_RETRIES: "1",
      }),
    ).toEqual({ failureMode: "off", maxTransientRetries: 0 });
  });
});

describe("assertVideoExtractionSucceeded", () => {
  it("accepts a complete extraction", () => {
    expect(() => assertVideoExtractionSucceeded(extractionResult([]))).not.toThrow();
  });

  it("fails deterministic media errors without forwarding paths or signed URLs", () => {
    const result = extractionResult([
      {
        videoId: "narrator",
        kind: "zero_output",
        retryable: false,
        error:
          "FFmpeg failed for /tmp/render/secret.mp4 from https://cdn.example/x?Signature=secret",
      },
      {
        videoId: "missing",
        kind: "source_missing",
        retryable: false,
        error: "Video file not found: /tmp/private/input.mp4",
      },
    ]);

    let caught: unknown;
    try {
      assertVideoExtractionSucceeded(result);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(VideoExtractionStageError);
    expect(caught).toMatchObject({
      code: "VIDEO_SOURCE_UNRENDERABLE",
      retryable: false,
      failures: [
        { kind: "source_missing", count: 1 },
        { kind: "zero_output", count: 1 },
      ],
    });
    if (!(caught instanceof Error)) {
      throw new Error("expected VideoExtractionStageError");
    }
    expect(caught.message).not.toContain("/tmp/");
    expect(caught.message).not.toContain("Signature");
  });

  it("keeps exhausted transient failures retryable and collapses duplicate kinds", () => {
    const result = extractionResult([
      {
        videoId: "a",
        kind: "download_transient",
        retryable: true,
        error: "HTTP 503",
      },
      {
        videoId: "b",
        kind: "download_transient",
        retryable: true,
        error: "HTTP 503",
      },
    ]);

    expect(() => assertVideoExtractionSucceeded(result)).toThrow(
      expect.objectContaining({
        code: "VIDEO_EXTRACTION_FAILED",
        retryable: true,
        failures: [{ kind: "download_transient", count: 2 }],
      }),
    );
  });

  it("fails closed for legacy failures without a kind or retryability", () => {
    expect(() =>
      assertVideoExtractionSucceeded(
        extractionResult([
          {
            videoId: "legacy",
            error: "legacy extraction error",
          },
        ]),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "VIDEO_SOURCE_UNRENDERABLE",
        retryable: false,
        failures: [{ kind: "internal", count: 1 }],
      }),
    );
  });
});

describe("buildHdrProbeStageError", () => {
  it.each([
    [
      { kind: "download_transient" as const, retryable: true },
      { kind: "source_missing" as const, retryable: false },
    ],
    [
      { kind: "source_missing" as const, retryable: false },
      { kind: "download_transient" as const, retryable: true },
    ],
  ])("fails closed for mixed probe outcomes regardless of completion order", (...failures) => {
    expect(buildHdrProbeStageError(failures)).toMatchObject({
      code: "VIDEO_SOURCE_UNRENDERABLE",
      retryable: false,
      failures: [
        { kind: "download_transient", count: 1 },
        { kind: "source_missing", count: 1 },
      ],
    });
  });
});

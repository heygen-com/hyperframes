import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtractedFrames,
  ExtractionResult,
  VideoElement,
  VideoExtractionFailure,
} from "@hyperframes/engine";
import { resolveProjectRelativeSrc } from "@hyperframes/engine";
import {
  appendAutoDetectedVideoAudio,
  assertVideoExtractionSucceeded,
  buildHdrProbeStageError,
  resolveVideoExtractionPolicy,
  shouldCopyExtractedFrames,
  VideoExtractionStageError,
} from "./extractVideosStage.js";
import { EncoderInterruptedError } from "../encoderInterruption.js";

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

describe("encoder interruption classification", () => {
  it("preserves an external ffmpeg interruption as the structured retry signal", () => {
    const result = extractionResult([
      {
        videoId: "v1",
        kind: "external_interruption",
        retryable: true,
        error: "ffmpeg handled signal 15",
      },
    ]);

    expect(() => assertVideoExtractionSucceeded(result)).toThrow(EncoderInterruptedError);
  });
});

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

// The HDR probes in this stage resolve `<video>`/`<img>` srcs with
// resolveProjectRelativeSrc and NO isAbsolute() pre-check. These pin the src
// shapes that a pre-check would silently break — an earlier revision of the
// PRINFRA-349 fix short-circuited on isAbsolute and left root-relative srcs
// percent-encoded, so the HDR image never resolved and the render shipped SDR.
describe("HDR probe src resolution (PRINFRA-349)", () => {
  it("decodes a percent-encoded CJK src to the real on-disk path", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-probe-cjk-"));
    const compiledDir = mkdtempSync(join(tmpdir(), "hf-probe-compiled-"));
    try {
      const realName = "图1.png";
      writeFileSync(join(projectDir, realName), "x");
      // The compiled DOM carries the URL-encoded attribute value.
      const encoded = encodeURIComponent(realName); // %E5%9B%BE1.png
      expect(resolveProjectRelativeSrc(encoded, projectDir, compiledDir)).toBe(
        join(projectDir, realName),
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(compiledDir, { recursive: true, force: true });
    }
  });

  it("decodes a percent-encoded CJK src served from a browser origin-root URL", () => {
    // Regression guard: `isAbsolute("/assets/%E5%9B%BE1.png")` is true on POSIX,
    // so a pre-check would return it verbatim, existsSync would fail, and the
    // image would never enter nativeHdrImageIds — a silent SDR render.
    const projectDir = mkdtempSync(join(tmpdir(), "hf-probe-root-"));
    try {
      mkdirSync(join(projectDir, "assets"));
      const realName = "图1.png";
      writeFileSync(join(projectDir, "assets", realName), "x");
      const rootRelative = `/assets/${encodeURIComponent(realName)}`;
      expect(resolveProjectRelativeSrc(rootRelative, projectDir, projectDir)).toBe(
        join(projectDir, "assets", realName),
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("prefers compiledDir over projectDir when both hold the asset", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-probe-proj-"));
    const compiledDir = mkdtempSync(join(tmpdir(), "hf-probe-comp-"));
    try {
      writeFileSync(join(projectDir, "clip.mp4"), "x");
      writeFileSync(join(compiledDir, "clip.mp4"), "x");
      expect(resolveProjectRelativeSrc("clip.mp4", projectDir, compiledDir)).toBe(
        join(compiledDir, "clip.mp4"),
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(compiledDir, { recursive: true, force: true });
    }
  });

  it("returns an existing absolute path unchanged", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-probe-abs-"));
    try {
      const abs = join(projectDir, "clip.mp4");
      writeFileSync(abs, "x");
      expect(resolveProjectRelativeSrc(abs, projectDir, projectDir)).toBe(abs);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
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
  it("enforces extraction failures by default (#3372)", () => {
    expect(resolveVideoExtractionPolicy({})).toEqual({
      failureMode: "enforce",
      maxTransientRetries: 0,
    });
  });

  it("allows explicit opt-out or observe mode", () => {
    expect(
      resolveVideoExtractionPolicy({
        HF_VIDEO_EXTRACTION_FAILURE_MODE: "observe",
        HF_VIDEO_EXTRACTION_MAX_RETRIES: "1",
      }),
    ).toEqual({ failureMode: "observe", maxTransientRetries: 1 });
    expect(
      resolveVideoExtractionPolicy({
        HF_VIDEO_EXTRACTION_FAILURE_MODE: "off",
      }),
    ).toEqual({ failureMode: "off", maxTransientRetries: 0 });
    expect(
      resolveVideoExtractionPolicy({
        HF_VIDEO_EXTRACTION_FAILURE_MODE: "enforce",
        HF_VIDEO_EXTRACTION_MAX_RETRIES: "1",
      }),
    ).toEqual({ failureMode: "enforce", maxTransientRetries: 1 });
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

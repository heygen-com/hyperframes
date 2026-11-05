import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtractedFrames,
  ExtractionResult,
  VideoElement,
  VideoExtractionFailure,
} from "@hyperframes/engine";
import { resolveConfig, resolveProjectRelativeSrc } from "@hyperframes/engine";
import {
  appendAutoDetectedVideoAudio,
  assertVideoExtractionSucceeded,
  buildHdrProbeStageError,
  resolveVideoExtractionPolicy,
  runExtractVideosStage,
  safeVideoExtractionSourceLogMetadata,
  VideoExtractionStageError,
} from "./extractVideosStage.js";
import { EncoderInterruptedError } from "../encoderInterruption.js";
import { createRenderJob } from "../../renderOrchestrator.js";

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

  it("reports a disk that filled up during extraction as ENOSPC, not as unrenderable sources", () => {
    const full = (n: number) => ({
      videoId: `v${n}`,
      kind: "disk_full" as const,
      retryable: false,
      error: "Error submitting a packet to the muxer: No space left on device",
      source: `assets/clip-${n}.mp4`,
    });
    const result = extractionResult([
      full(1),
      full(2),
      { videoId: "v3", kind: "zero_output", retryable: false, error: "no frames" },
    ]);

    expect(() => assertVideoExtractionSucceeded(result)).toThrow(
      expect.objectContaining({
        code: "ENOSPC",
        message: "ENOSPC: no space left on device, extracting the frames of 2 video source(s)",
      }),
    );
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

  it.each([
    1.5,
    {
      target: "rate",
      points: [
        { t: 0, v: 1 },
        { t: 3, v: 2 },
      ],
    },
  ] satisfies NonNullable<VideoElement["playbackRate"]>[])(
    "keeps the video's rate and trim in its detected audio (%j)",
    (playbackRate) => {
      const composition: Parameters<typeof appendAutoDetectedVideoAudio>[0] = {
        videos: [makeVideo({ start: 2, end: 5, mediaStart: 0.5, playbackRate })],
        audios: [],
      };

      appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", true)]);

      expect(composition.audios[0]).toMatchObject({
        start: 2,
        end: 5,
        mediaStart: 0.5,
        playbackRate,
      });
    },
  );

  it("skips a muted video even when the source file has audio", () => {
    const composition = {
      videos: [makeVideo({ hasAudio: false })],
      audios: [] as never[],
    };
    appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", true)]);
    expect(composition.audios).toHaveLength(0);
  });

  it("keeps the loop and speed of auto-detected video audio", () => {
    const composition = {
      videos: [makeVideo({ loop: true, playbackRate: 2, mediaStart: 1 })],
      audios: [] as never[],
    };
    appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", true)]);
    expect(composition.audios).toEqual([
      expect.objectContaining({ loop: true, playbackRate: 2, mediaStart: 1 }),
    ]);
  });

  it("skips a hidden video so a track hidden in Studio stays silent in the render", () => {
    const composition = {
      videos: [makeVideo({ hidden: true })],
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

describe("safeVideoExtractionSourceLogMetadata", () => {
  it("logs only a query-free fingerprint and normalized host for a signed remote source", () => {
    const source =
      "https://MEDIA.CUSTOMER-CDN.EXAMPLE/private/clip.mp4?X-Amz-Signature=super-secret#fragment";
    const metadata = safeVideoExtractionSourceLogMetadata(source);

    expect(metadata).toMatchObject({
      sourceType: "remote",
      sourceFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      host: "media.customer-cdn.example",
    });
    expect(JSON.stringify(metadata)).not.toContain("super-secret");
    expect(JSON.stringify(metadata)).not.toContain("/private/clip.mp4");
  });

  it("uses a non-sensitive marker for local sources", () => {
    expect(safeVideoExtractionSourceLogMetadata("/private/render/clip.mp4")).toEqual({
      sourceType: "local",
    });
  });
});

describe("assertVideoExtractionSucceeded", () => {
  it("accepts a complete extraction", () => {
    expect(() => assertVideoExtractionSucceeded(extractionResult([]))).not.toThrow();
  });

  it("names the failed clips, at most five, in the message and nowhere else", () => {
    const failed = (n: number) => ({
      videoId: `v${n}`,
      kind: "zero_output" as const,
      retryable: false,
      error: "FFmpeg failed for /tmp/render/secret.mp4",
      source: `assets/clip-${n}.mp4`,
    });
    let caught: unknown;
    try {
      assertVideoExtractionSucceeded(extractionResult([1, 2, 3, 4, 5, 6, 7].map(failed)));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VideoExtractionStageError);
    const error = caught as VideoExtractionStageError;
    expect(error.message).toBe(
      "Video extraction failed for 7 source(s) [VIDEO_SOURCE_UNRENDERABLE; zero_output=7] (assets/clip-1.mp4, assets/clip-2.mp4, assets/clip-3.mp4, assets/clip-4.mp4, assets/clip-5.mp4 and 2 more)",
    );
    expect(error.code).toBe("VIDEO_SOURCE_UNRENDERABLE");
    expect(JSON.stringify(error.publicMetadata)).not.toContain("clip-");
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

  it("attaches bounded, deterministic v1 groups while keeping kind counts exhaustive", () => {
    const errors: VideoExtractionFailure[] = Array.from({ length: 9 }, (_, index) => ({
      videoId: `private-${index}`,
      kind: "download_transient",
      retryable: true,
      group: {
        sourceFingerprint: `sha256:${index.toString(16).padStart(64, "0")}`,
        host: index % 2 === 0 ? "media.customer-cdn.example" : "other",
        statusClass: "http_5xx",
        retry: { phase: "download", used: 1, budget: 1 },
      },
      error: `https://media.customer-cdn.example/private/${index}.mp4?signature=secret`,
    }));
    errors.push(
      {
        videoId: "bad-a",
        kind: "invalid_media",
        retryable: false,
        error: "/tmp/private-a.mp4",
      },
      {
        videoId: "bad-b",
        kind: "invalid_media",
        retryable: false,
        error: "/tmp/private-b.mp4",
      },
    );

    let caught: unknown;
    try {
      assertVideoExtractionSucceeded(extractionResult(errors));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VideoExtractionStageError);
    if (!(caught instanceof VideoExtractionStageError)) return;

    expect(caught.extractionFailure.schemaVersion).toBe(1);
    expect(caught.extractionFailure.kindCounts).toEqual([
      { kind: "download_transient", affectedElementCount: 9 },
      { kind: "invalid_media", affectedElementCount: 2 },
    ]);
    expect(caught.extractionFailure.groups).toHaveLength(8);
    expect(caught.extractionFailure.omittedGroupCount).toBe(2);
    expect(caught.extractionFailure.groups.map((group) => group.sourceFingerprint)).toEqual(
      Array.from({ length: 8 }, (_, index) => `sha256:${index.toString(16).padStart(64, "0")}`),
    );
    expect(JSON.stringify(caught.extractionFailure)).not.toContain("signature=secret");
    expect(JSON.stringify(caught.extractionFailure)).not.toContain("private-");
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

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!HAS_FFMPEG)(
  "deferring range extraction beside a variable-frame-rate source",
  () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-defer-vfr-"));
    const synthesize = (name: string, input: string, filters: string[] = []) => {
      const result = spawnSync("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        input,
        ...filters,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        join(projectDir, name),
      ]);
      if (result.status !== 0) throw new Error(result.stderr.toString());
    };

    beforeAll(() => {
      synthesize("cfr.mp4", "testsrc2=s=64x36:r=30:d=6");
      synthesize("vfr.mp4", "testsrc2=s=64x36:d=10:rate=1/2", [
        "-vf",
        "select='eq(n,0)+eq(n,2)'",
        "-fps_mode",
        "vfr",
      ]);
    }, 30_000);
    afterAll(() => rmSync(projectDir, { recursive: true, force: true }));

    const clip = (id: string): VideoElement => ({
      id,
      src: `${id}.mp4`,
      start: 0,
      end: 3,
      mediaStart: 0,
      loop: false,
      hasAudio: false,
    });

    const extract = (deferRangeExtraction: boolean | undefined) => {
      const compiledDir = join(projectDir, `compiled-${String(deferRangeExtraction)}`);
      mkdirSync(compiledDir, { recursive: true });
      return runExtractVideosStage({
        projectDir,
        compiledDir,
        job: createRenderJob({ fps: 30, quality: "standard", hdrMode: "force-sdr" }),
        cfg: resolveConfig({}),
        composition: {
          duration: 3,
          width: 64,
          height: 36,
          videos: [clip("cfr"), clip("vfr")],
          audios: [],
          images: [],
        },
        abortSignal: undefined,
        assertNotAborted: () => {},
        deferRangeExtraction,
      });
    };

    it("a VFR source beside a CFR one: the CFR source defers and the VFR source extracts in full", async () => {
      const { extractionResult } = await extract(true);
      const byId = new Map(extractionResult!.extracted.map((video) => [video.videoId, video]));

      const cfr = byId.get("cfr")!;
      expect(cfr.deferredRange).toBeDefined();
      expect(cfr.framePaths.size).toBe(0);
      expect(cfr.totalFrames).toBe(90);

      const vfr = byId.get("vfr")!;
      expect(vfr.metadata.isVFR).toBe(true);
      expect(vfr.deferredRange).toBeUndefined();
      expect(vfr.framePaths.size).toBeGreaterThan(0);
    }, 60_000);

    it("extracts every source in full when range extraction is not deferred", async () => {
      const { extractionResult } = await extract(undefined);
      expect(extractionResult!.extracted.some((video) => video.deferredRange)).toBe(false);
      const cfr = extractionResult!.extracted.find((video) => video.videoId === "cfr")!;
      expect(cfr.framePaths.size).toBe(90);
    }, 60_000);
  },
);

import {
  closeSync,
  constants,
  existsSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  extractMediaMetadata,
  resolveFinalFrameExtractionWindow,
  runFfmpeg,
  type RunFfmpegResult,
  type VideoElement,
  type VideoMetadata,
} from "@hyperframes/engine";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRenderJob } from "../../renderOrchestrator.js";
import { resolveHdrVideoFrameIndex } from "../../hdrCompositor.js";
import {
  cleanupHdrVideoFrameSource,
  estimateHdrExtractionBytes,
  extractHdrVideoFrames,
  getHdrExtractionReservedBytes,
  planHdrResources,
  reserveHdrExtractionBytes,
  resolveHdrExtractionActiveBudgetBytes,
  resolveHdrExtractionBudgetBytes,
  resolveHdrExtractionWindow,
} from "./captureHdrResources.js";
import type { CompositionMetadata } from "../shared.js";
import { EncoderInterruptedError } from "../encoderInterruption.js";

afterEach(() => {
  vi.unstubAllEnvs();
  expect(getHdrExtractionReservedBytes()).toBe(0);
});

function ffmpegResult(success: boolean): RunFfmpegResult {
  return {
    success,
    exitCode: success ? 0 : 1,
    stderr: success ? "" : "mock extraction failure",
    durationMs: 1,
    terminationReason: "exit",
  };
}

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;

function hdrVideo(id: string, overrides: Partial<VideoElement> = {}): VideoElement {
  return {
    id,
    src: `${id}.mov`,
    start: 0,
    end: Number.POSITIVE_INFINITY,
    mediaStart: 0,
    loop: false,
    hasAudio: false,
    ...overrides,
  };
}

function videoMetadata(
  durationSeconds: number,
  videoStreamDurationSeconds = durationSeconds,
): VideoMetadata {
  return {
    durationSeconds,
    videoStreamDurationSeconds,
    width: 1,
    height: 1,
    fps: 2,
    videoCodec: "hevc",
    hasAudio: false,
    isVFR: false,
    hasAlpha: false,
    colorSpace: null,
  };
}

function hdrExtractionFixture(videos: VideoElement[], framesDir: string) {
  return {
    job: createRenderJob({ fps: { num: 2, den: 1 }, quality: "standard" }),
    log: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    },
    framesDir,
    composition: {
      duration: 2,
      videos,
      audios: [],
      images: [],
      width: 1,
      height: 1,
    },
    prep: {
      hdrVideoIds: videos.map((video) => video.id),
      hdrVideoSrcPaths: new Map(videos.map((video) => [video.id, video.src])),
      hdrVideoStartTimes: new Map(videos.map((video) => [video.id, video.start])),
      hdrImageStartTimes: new Map(),
      hdrExtractionDims: new Map(videos.map((video) => [video.id, { width: 1, height: 1 }])),
      hdrImageFitInfo: new Map(),
    },
    width: 1,
    height: 1,
    abortSignal: undefined,
    hdrDiagnostics: { videoExtractionFailures: 0, imageDecodeFailures: 0 },
    extractMediaMetadataImpl: async () => videoMetadata(120),
    resolveFinalFrameExtractionWindowImpl: async (_srcPath, _video, _metadata, window) => window,
  };
}

function videoComposition(src: string): CompositionMetadata {
  return {
    duration: 5,
    width: 1920,
    height: 1080,
    audios: [],
    images: [],
    videos: [{ id: "a-roll", src, start: 0, end: 5, mediaStart: 0, loop: false, hasAudio: false }],
  };
}

describe("planHdrResources non-ASCII src resolution (PRINFRA-349)", () => {
  it("decodes a percent-encoded CJK <video src> back to the real on-disk path", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-hdr-cjk-"));
    try {
      const realName = "视频1.mp4";
      writeFileSync(join(projectDir, realName), "x");
      // The compiled DOM carries the URL-encoded attribute value.
      const encoded = encodeURIComponent(realName); // %E8%A7%86%E9%A2%911.mp4
      const prep = planHdrResources({
        composition: videoComposition(encoded),
        nativeHdrVideoIds: new Set(["a-roll"]),
        nativeHdrImageIds: new Set(),
        projectDir,
        compiledDir: projectDir,
      });
      // Must be the decoded filesystem path ffmpeg can open, not the %-encoded string.
      expect(prep.hdrVideoSrcPaths.get("a-roll")).toBe(join(projectDir, realName));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("leaves an ASCII src untouched", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-hdr-ascii-"));
    try {
      writeFileSync(join(projectDir, "clip.mp4"), "x");
      const prep = planHdrResources({
        composition: videoComposition("clip.mp4"),
        nativeHdrVideoIds: new Set(["a-roll"]),
        nativeHdrImageIds: new Set(),
        projectDir,
        compiledDir: projectDir,
      });
      expect(prep.hdrVideoSrcPaths.get("a-roll")).toBe(join(projectDir, "clip.mp4"));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe("estimateHdrExtractionBytes", () => {
  it("sums 6 bytes per pixel per frame across videos", () => {
    // 10s @ 30fps of 1920x1080 = 300 frames * 1920*1080*6
    expect(
      estimateHdrExtractionBytes([{ durationSeconds: 10, width: 1920, height: 1080 }], 30),
    ).toBe(300 * 1920 * 1080 * 6);
  });

  it("accumulates multiple videos and rounds frame counts up", () => {
    const bytes = estimateHdrExtractionBytes(
      [
        { durationSeconds: 1.5, width: 100, height: 100 },
        { durationSeconds: 0.05, width: 100, height: 100 },
      ],
      30,
    );
    expect(bytes).toBe((45 + 2) * 100 * 100 * 6);
  });

  it("treats negative durations as empty", () => {
    expect(estimateHdrExtractionBytes([{ durationSeconds: -3, width: 100, height: 100 }], 30)).toBe(
      0,
    );
  });
});

describe("resolveHdrExtractionWindow", () => {
  it("bounds a two-second composition backed by an unbounded HDR source to 60 raw frames", () => {
    const window = resolveHdrExtractionWindow(hdrVideo("long-hdr"), 2, videoMetadata(120));
    if (!window) throw new Error("expected a visible HDR extraction window");
    const { durationSeconds } = window;
    expect(durationSeconds).toBe(2);
    expect(estimateHdrExtractionBytes([{ durationSeconds, width: 3840, height: 2160 }], 30)).toBe(
      60 * 3840 * 2160 * 6,
    );
  });

  it("independently caps a stale finite media end at the composition duration", () => {
    expect(resolveHdrExtractionWindow(hdrVideo("hdr", { end: 60 }), 2, videoMetadata(60))).toEqual({
      compositionStart: 0,
      mediaStart: 0,
      durationSeconds: 2,
    });
  });

  it("trims materially negative preroll and advances the source offset", () => {
    expect(
      resolveHdrExtractionWindow(hdrVideo("hdr", { start: -60, end: 120 }), 2, videoMetadata(120)),
    ).toEqual({ compositionStart: 0, mediaStart: 60, durationSeconds: 2 });
  });

  it("preserves a short loop cycle when negative preroll crosses EOF", () => {
    expect(
      resolveHdrExtractionWindow(
        hdrVideo("loop", { start: -5, end: 10, loop: true }),
        2,
        videoMetadata(3),
      ),
    ).toEqual({
      compositionStart: -5,
      mediaStart: 0,
      durationSeconds: 3,
      preserveTimelinePhase: true,
    });
  });

  it("marks an entirely held interval for exact final-frame resolution", () => {
    expect(
      resolveHdrExtractionWindow(hdrVideo("held", { start: -5, end: 10 }), 2, videoMetadata(3)),
    ).toEqual({
      compositionStart: -2.000001,
      mediaStart: 2.999999,
      durationSeconds: 0.000001,
      preserveTimelineEnd: true,
      ensureFinalFrame: true,
    });
  });

  it.each([
    { start: -5, compositionDuration: 2, expected: null, label: "already ended" },
    {
      start: -2,
      compositionDuration: 15,
      expected: { compositionStart: 0, mediaStart: 2, durationSeconds: 1 },
      label: "partially visible",
    },
  ])(
    "keeps an open-ended HDR clip source-bounded when $label",
    ({ start, compositionDuration, expected }) => {
      expect(
        resolveHdrExtractionWindow(
          hdrVideo("open-held", { start, end: Number.POSITIVE_INFINITY, loop: false }),
          compositionDuration,
          videoMetadata(3),
        ),
      ).toEqual(expected);
    },
  );

  it.each([
    { loop: true, preservation: { preserveTimelinePhase: true }, label: "loop" },
    {
      loop: false,
      preservation: { preserveTimelineEnd: true, ensureFinalFrame: true },
      label: "held tail",
    },
  ])(
    "caps a finite 60-second $label slot to one 3-second source range",
    ({ loop, preservation }) => {
      expect(
        resolveHdrExtractionWindow(hdrVideo("short", { end: 60, loop }), 60, videoMetadata(3)),
      ).toEqual({
        compositionStart: 0,
        mediaStart: 0,
        durationSeconds: 3,
        ...preservation,
      });
    },
  );

  it("bounds an entirely held 120-second source to an exact one-frame plan", () => {
    expect(
      resolveHdrExtractionWindow(
        hdrVideo("long-held", { start: -600, end: 10 }),
        2,
        videoMetadata(120),
      ),
    ).toEqual({
      compositionStart: -480.000001,
      mediaStart: 119.999999,
      durationSeconds: 0.000001,
      preserveTimelineEnd: true,
      ensureFinalFrame: true,
    });
  });

  it("rejects mediaStart at source EOF before HDR budgeting", () => {
    expect(() =>
      resolveHdrExtractionWindow(hdrVideo("past-eof", { mediaStart: 3 }), 60, videoMetadata(3)),
    ).toThrowError(expect.objectContaining({ kind: "media_start_out_of_range", retryable: false }));
  });

  it("skips HDR media with no interval inside the composition", () => {
    expect(
      resolveHdrExtractionWindow(hdrVideo("hdr", { start: 3 }), 2, videoMetadata(60)),
    ).toBeNull();
  });
});

describe.skipIf(!HAS_FFMPEG)("raw HDR held tails on sparse-timestamp sources", () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "hf-hdr-sparse-held-tail-"));
  const cfrFixture = join(fixtureDir, "sub-1fps-cfr.mp4");
  const vfrFixture = join(fixtureDir, "sparse-vfr.mp4");
  const nonZeroStartFixture = join(fixtureDir, "nonzero-start.mp4");
  const negativeStartTransportFixture = join(fixtureDir, "negative-start.ts");

  beforeAll(async () => {
    const fixtures = [
      {
        path: cfrFixture,
        input: "testsrc2=s=64x64:d=10:rate=1/5",
        filters: [] as string[],
      },
      {
        path: vfrFixture,
        input: "testsrc2=s=64x64:d=10:rate=1/2",
        filters: ["-vf", "select='eq(n,0)+eq(n,2)'", "-vsync", "vfr"],
      },
      {
        path: nonZeroStartFixture,
        input: "testsrc2=s=64x64:d=3:rate=1",
        filters: ["-output_ts_offset", "5"],
      },
      {
        path: negativeStartTransportFixture,
        input: "testsrc2=s=64x64:d=3:rate=1",
        filters: [
          "-mpegts_copyts",
          "1",
          "-muxdelay",
          "0",
          "-avoid_negative_ts",
          "disabled",
          "-output_ts_offset",
          "-2",
        ],
      },
    ];
    for (const fixture of fixtures) {
      const result = await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        fixture.input,
        ...fixture.filters,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-y",
        fixture.path,
      ]);
      if (!result.success) {
        throw new Error(`sparse HDR fixture synthesis failed: ${result.stderr.slice(-400)}`);
      }
    }
  }, 30_000);

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it.each([
    { label: "sub-1fps CFR", src: cfrFixture, expectedVfr: false, streamStart: 0 },
    { label: "sparse VFR", src: vfrFixture, expectedVfr: true, streamStart: 0 },
    {
      label: "non-zero stream start",
      src: nonZeroStartFixture,
      expectedVfr: false,
      streamStart: 5,
    },
    {
      label: "unindexed negative-base MPEG-TS",
      src: negativeStartTransportFixture,
      expectedVfr: false,
      streamStart: -2,
    },
  ])(
    "writes exactly one raw HDR frame for $label",
    async ({ src, expectedVfr, streamStart }) => {
      const metadata = await extractMediaMetadata(src);
      expect(metadata.fps).toBeLessThanOrEqual(1);
      expect(metadata.isVFR).toBe(expectedVfr);
      expect(metadata.videoStreamStartSeconds).toBeCloseTo(streamStart, 6);
      const framesDir = mkdtempSync(join(fixtureDir, "raw-out-"));
      const video = hdrVideo(`real-${String(expectedVfr)}`, {
        src,
        start: -15,
        end: 5,
      });
      const fixture = hdrExtractionFixture([video], framesDir);
      fixture.prep.hdrExtractionDims.set(video.id, { width: 64, height: 64 });

      const extracted = await extractHdrVideoFrames({
        ...fixture,
        width: 64,
        height: 64,
        runFfmpegImpl: runFfmpeg,
        extractMediaMetadataImpl: extractMediaMetadata,
        resolveFinalFrameExtractionWindowImpl: resolveFinalFrameExtractionWindow,
      });
      try {
        expect(extracted.sources.get(video.id)?.frameCount).toBe(1);
        expect(extracted.estimatedBytes).toBe(64 * 64 * 6);
        expect(fixture.prep.hdrVideoStartTimes.get(video.id)).toBe(0);
      } finally {
        for (const source of extracted.sources.values()) cleanupHdrVideoFrameSource(source);
        extracted.releaseReservation();
        rmSync(framesDir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

describe("resolveHdrExtractionBudgetBytes", () => {
  it("uses half an actual cgroup limit when no env budget is configured", () => {
    expect(resolveHdrExtractionBudgetBytes(undefined, 24 * 1024)).toBe(12 * 1024 ** 3);
    expect(resolveHdrExtractionBudgetBytes(undefined, null)).toBeUndefined();
  });

  it("uses the stricter of the environment and cgroup budgets", () => {
    expect(resolveHdrExtractionBudgetBytes(String(8 * 1024 ** 3), 24 * 1024)).toBe(8 * 1024 ** 3);
    expect(resolveHdrExtractionBudgetBytes(String(20 * 1024 ** 3), 24 * 1024)).toBe(12 * 1024 ** 3);
    expect(resolveHdrExtractionBudgetBytes("1234.9", null)).toBe(1234);
  });

  it("rejects invalid budgets", () => {
    expect(() => resolveHdrExtractionBudgetBytes("0", null)).toThrow("must be a positive finite");
    expect(() => resolveHdrExtractionBudgetBytes("Infinity", null)).toThrow(
      "must be a positive finite",
    );
  });
});

describe("reserveHdrExtractionBytes", () => {
  it("prevents concurrent aggregate overcommit and releases idempotently", () => {
    const releaseFirst = reserveHdrExtractionBytes(60, 100);
    try {
      expect(getHdrExtractionReservedBytes()).toBe(60);
      expect(() => reserveHdrExtractionBytes(50, 100)).toThrow("Concurrent HDR pre-extractions");
    } finally {
      releaseFirst();
      releaseFirst();
    }

    const releaseAfter = reserveHdrExtractionBytes(100, 100);
    expect(getHdrExtractionReservedBytes()).toBe(100);
    releaseAfter();
  });

  it("prevents two concurrent jobs from overcommitting a disk-only budget", () => {
    const diskOnlyBudget = resolveHdrExtractionActiveBudgetBytes(undefined, 100);
    expect(diskOnlyBudget).toBe(90);

    const releaseFirstJob = reserveHdrExtractionBytes(60, diskOnlyBudget);
    try {
      expect(() => reserveHdrExtractionBytes(40, diskOnlyBudget)).toThrow(
        "Concurrent HDR pre-extractions",
      );
    } finally {
      releaseFirstJob();
    }
  });
});

describe("extractHdrVideoFrames", () => {
  it("preserves an external FFmpeg interruption as the structured retry signal", async () => {
    const framesDir = mkdtempSync(join(tmpdir(), "hf-hdr-interrupted-"));
    const fixture = hdrExtractionFixture([hdrVideo("interrupted")], framesDir);

    try {
      await expect(
        extractHdrVideoFrames({
          ...fixture,
          runFfmpegImpl: async () => ({
            ...ffmpegResult(false),
            exitCode: 255,
            failureReason: "external_interruption",
          }),
        }),
      ).rejects.toBeInstanceOf(EncoderInterruptedError);
    } finally {
      rmSync(framesDir, { recursive: true, force: true });
    }
  });

  it("pins FFmpeg seek/duration, raw frame count, and reservation lifetime", async () => {
    const framesDir = mkdtempSync(join(tmpdir(), "hf-hdr-extract-"));
    const video = hdrVideo("preroll", { start: -60, end: 120, mediaStart: 0 });
    const fixture = hdrExtractionFixture([video], framesDir);
    const calls: string[][] = [];

    try {
      const extracted = await extractHdrVideoFrames({
        ...fixture,
        runFfmpegImpl: async (args) => {
          calls.push(args);
          const rawPath = args.at(-1);
          if (!rawPath) throw new Error("mock FFmpeg output path missing");
          // The visible [0, 2] interval is two seconds at 2fps = 4 rgb48le 1x1 frames.
          writeFileSync(rawPath, Buffer.alloc(4 * 6));
          return ffmpegResult(true);
        },
      });
      try {
        expect(calls).toHaveLength(1);
        const args = calls[0] ?? [];
        expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2)).toEqual(["-ss", "60"]);
        expect(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2)).toEqual(["-t", "2"]);
        expect(fixture.prep.hdrVideoStartTimes.get("preroll")).toBe(0);
        expect(extracted.sources.get("preroll")?.frameCount).toBe(4);
        expect(extracted.estimatedBytes).toBe(24);
        expect(getHdrExtractionReservedBytes()).toBe(24);
      } finally {
        for (const source of extracted.sources.values()) cleanupHdrVideoFrameSource(source);
        extracted.releaseReservation();
      }
    } finally {
      rmSync(framesDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      loop: true,
      expectedFrameIndex: 4,
      expectedFrameCount: 6,
      expectedStart: -5,
      expectedSeek: "0",
      expectedDuration: "3",
      label: "loop phase",
    },
    {
      loop: false,
      expectedFrameIndex: 0,
      expectedFrameCount: 1,
      expectedStart: 0,
      expectedSeek: "2",
      expectedDuration: undefined,
      label: "held final frame",
    },
  ])("preserves $label after materially negative preroll", async (testCase) => {
    const {
      loop,
      expectedFrameIndex,
      expectedFrameCount,
      expectedStart,
      expectedSeek,
      expectedDuration,
    } = testCase;
    const framesDir = mkdtempSync(join(tmpdir(), "hf-hdr-negative-source-"));
    const video = hdrVideo(`negative-${String(loop)}`, { start: -5, end: 10, loop });
    const fixture = hdrExtractionFixture([video], framesDir);
    const calls: string[][] = [];

    try {
      const extracted = await extractHdrVideoFrames({
        ...fixture,
        extractMediaMetadataImpl: async () => videoMetadata(3),
        resolveFinalFrameExtractionWindowImpl: async (_srcPath, _video, _metadata, window) =>
          window.ensureFinalFrame
            ? {
                compositionStart: 0,
                mediaStart: 2.999999,
                extractionMediaStart: 2,
                durationSeconds: 0.000001,
                preserveTimelineEnd: true,
                finalFrameOnly: true,
              }
            : window,
        runFfmpegImpl: async (args) => {
          calls.push(args);
          const rawPath = args.at(-1);
          if (!rawPath) throw new Error("mock FFmpeg output path missing");
          writeFileSync(rawPath, Buffer.alloc(expectedFrameCount * 6));
          return ffmpegResult(true);
        },
      });
      try {
        const args = calls[0] ?? [];
        expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2)).toEqual([
          "-ss",
          expectedSeek,
        ]);
        if (expectedDuration === undefined) {
          expect(args).not.toContain("-t");
          expect(args.slice(args.indexOf("-frames:v"), args.indexOf("-frames:v") + 2)).toEqual([
            "-frames:v",
            "1",
          ]);
        } else {
          expect(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2)).toEqual([
            "-t",
            expectedDuration,
          ]);
        }
        expect(fixture.prep.hdrVideoStartTimes.get(video.id)).toBe(expectedStart);
        const source = extracted.sources.get(video.id);
        expect(source?.loop).toBe(loop);
        expect(
          resolveHdrVideoFrameIndex(0, expectedStart, 2, source?.frameCount ?? 0, source?.loop),
        ).toBe(expectedFrameIndex);
      } finally {
        for (const source of extracted.sources.values()) cleanupHdrVideoFrameSource(source);
        extracted.releaseReservation();
      }
    } finally {
      rmSync(framesDir, { recursive: true, force: true });
    }
  });

  it.each([
    { loop: true, expectedFrameIndex: 4, label: "loop" },
    { loop: false, expectedFrameIndex: 5, label: "held tail" },
  ])(
    "reserves one playable video-stream range for a finite 60-second $label slot with longer audio",
    async ({ loop, expectedFrameIndex }) => {
      const framesDir = mkdtempSync(join(tmpdir(), "hf-hdr-finite-short-source-"));
      const video = hdrVideo(`finite-${String(loop)}`, { end: 60, loop });
      const fixture = hdrExtractionFixture([video], framesDir);
      fixture.composition.duration = 60;
      const calls: string[][] = [];

      try {
        const extracted = await extractHdrVideoFrames({
          ...fixture,
          // A valid mux can have a short video stream and a much longer audio
          // stream/container. Scratch planning must follow video EOF.
          extractMediaMetadataImpl: async () => videoMetadata(60, 3),
          runFfmpegImpl: async (args) => {
            calls.push(args);
            const rawPath = args.at(-1);
            if (!rawPath) throw new Error("mock FFmpeg output path missing");
            writeFileSync(rawPath, Buffer.alloc(6 * 6));
            return ffmpegResult(true);
          },
        });
        try {
          const args = calls[0] ?? [];
          expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2)).toEqual(["-ss", "0"]);
          expect(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2)).toEqual(["-t", "3"]);
          expect(extracted.estimatedBytes).toBe(36);
          expect(getHdrExtractionReservedBytes()).toBe(36);
          expect(fixture.prep.hdrVideoStartTimes.get(video.id)).toBe(0);
          const source = extracted.sources.get(video.id);
          expect(source?.loop).toBe(loop);
          expect(resolveHdrVideoFrameIndex(59, 0, 2, source?.frameCount ?? 0, source?.loop)).toBe(
            expectedFrameIndex,
          );
        } finally {
          for (const source of extracted.sources.values()) cleanupHdrVideoFrameSource(source);
          extracted.releaseReservation();
        }
      } finally {
        rmSync(framesDir, { recursive: true, force: true });
      }
    },
  );

  it("closes/removes completed and partial sources and releases reservation on failure", async () => {
    const framesDir = mkdtempSync(join(tmpdir(), "hf-hdr-partial-"));
    const fixture = hdrExtractionFixture([hdrVideo("first"), hdrVideo("second")], framesDir);
    const createdRawPaths: string[] = [];
    let call = 0;

    try {
      await expect(
        extractHdrVideoFrames({
          ...fixture,
          runFfmpegImpl: async (args) => {
            call += 1;
            const rawPath = args.at(-1);
            if (!rawPath) throw new Error("mock FFmpeg output path missing");
            createdRawPaths.push(rawPath);
            if (call === 2) return ffmpegResult(false);
            writeFileSync(rawPath, Buffer.alloc(4 * 6));
            return ffmpegResult(true);
          },
        }),
      ).rejects.toThrow('HDR frame extraction failed for video "second"');

      expect(fixture.hdrDiagnostics.videoExtractionFailures).toBe(1);
      expect(createdRawPaths).toHaveLength(2);
      for (const rawPath of createdRawPaths) expect(existsSync(dirname(rawPath))).toBe(false);
      expect(getHdrExtractionReservedBytes()).toBe(0);
    } finally {
      rmSync(framesDir, { recursive: true, force: true });
    }
  });
});

describe("cleanupHdrVideoFrameSource", () => {
  it("closes the raw descriptor and immediately removes its directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-hdr-cleanup-"));
    const rawPath = join(dir, "frames.rgb48le");
    writeFileSync(rawPath, Buffer.alloc(12));
    const fd = openSync(rawPath, constants.O_RDONLY);

    cleanupHdrVideoFrameSource({
      dir,
      rawPath,
      fd,
      width: 1,
      height: 2,
      frameSize: 12,
      frameCount: 1,
      scratch: Buffer.alloc(12),
    });

    expect(existsSync(dir)).toBe(false);
    expect(() => closeSync(fd)).toThrow();
  });

  it("closes the descriptor but retains raw files with KEEP_TEMP=1", () => {
    vi.stubEnv("KEEP_TEMP", "1");
    const dir = mkdtempSync(join(tmpdir(), "hf-hdr-keep-temp-"));
    const rawPath = join(dir, "frames.rgb48le");
    writeFileSync(rawPath, Buffer.alloc(12));
    const fd = openSync(rawPath, constants.O_RDONLY);

    try {
      cleanupHdrVideoFrameSource({
        dir,
        rawPath,
        fd,
        width: 1,
        height: 2,
        frameSize: 12,
        frameCount: 1,
        scratch: Buffer.alloc(12),
      });

      expect(existsSync(rawPath)).toBe(true);
      expect(() => closeSync(fd)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

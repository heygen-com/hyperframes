import { existsSync, mkdtempSync, readSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * A mock FFmpeg: answers the first-frame probe and fills each extraction's output with its frames,
 * stopping where the source's `realFrames` (at the fixture's 2 fps) run out.
 */
function windowWriter(calls: string[][], realFrames = Infinity) {
  return async (args: string[]): Promise<RunFfmpegResult> => {
    if (args.at(-1) === "-") return { ...ffmpegResult(true), stderr: "pts_time:0.000000" };
    calls.push(args);
    const out = args.at(-1);
    if (!out) throw new Error("mock FFmpeg output path missing");
    const filter = args[args.indexOf("-vf") + 1] ?? "";
    const lead = Number(/trim=start_frame=(\d+)/.exec(filter)?.[1] ?? 0);
    const first = Math.round(Number(args[args.indexOf("-ss") + 1]) * 2) + lead;
    const wanted = Number(args[args.indexOf("-frames:v") + 1]);
    writeFileSync(out, Buffer.alloc(Math.max(0, Math.min(wanted, realFrames - first)) * 6));
    return ffmpegResult(true);
  };
}

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
    videos: [
      {
        id: "a-roll",
        src,
        start: 0,
        end: 5,
        mediaStart: 0,
        loop: false,
        hasAudio: false,
      },
    ],
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

describe("resolveHdrExtractionWindow", () => {
  it("bounds a two-second composition backed by an unbounded HDR source to 60 raw frames", () => {
    const window = resolveHdrExtractionWindow(hdrVideo("long-hdr"), 2, videoMetadata(120));
    if (!window) throw new Error("expected a visible HDR extraction window");
    expect(window.durationSeconds).toBe(2);
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
    {
      start: -5,
      compositionDuration: 2,
      expected: null,
      label: "already ended",
    },
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
          hdrVideo("open-held", {
            start,
            end: Number.POSITIVE_INFINITY,
            loop: false,
          }),
          compositionDuration,
          videoMetadata(3),
        ),
      ).toEqual(expected);
    },
  );

  it.each([
    {
      loop: true,
      preservation: { preserveTimelinePhase: true },
      label: "loop",
    },
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
    ).toThrowError(
      expect.objectContaining({
        kind: "media_start_out_of_range",
        retryable: false,
      }),
    );
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
        filters: ["-vf", "select='eq(n,0)+eq(n,2)'", "-fps_mode", "vfr"],
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
    {
      label: "sub-1fps CFR",
      src: cfrFixture,
      expectedVfr: false,
      streamStart: 0,
    },
    {
      label: "sparse VFR",
      src: vfrFixture,
      expectedVfr: true,
      streamStart: 0,
    },
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
        // The visible [0, 2] interval is two seconds at 2fps = 4 rgb48le 1x1 frames.
        runFfmpegImpl: windowWriter(calls),
      });
      try {
        expect(calls).toHaveLength(1);
        const args = calls[0] ?? [];
        expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2)).toEqual([
          "-ss",
          "60.000000",
        ]);
        expect(args.slice(args.indexOf("-frames:v"), args.indexOf("-frames:v") + 2)).toEqual([
          "-frames:v",
          "4",
        ]);
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
      expectedStart: -5,
      expectedSeek: "0.000000",
      expectedFrames: "7",
      label: "loop phase",
    },
    {
      loop: false,
      expectedFrameIndex: 0,
      expectedStart: 0,
      expectedSeek: "2",
      expectedFrames: "1",
      label: "held final frame",
    },
  ])("preserves $label after materially negative preroll", async (testCase) => {
    const { loop, expectedFrameIndex, expectedStart, expectedSeek, expectedFrames } = testCase;
    const framesDir = mkdtempSync(join(tmpdir(), "hf-hdr-negative-source-"));
    const video = hdrVideo(`negative-${String(loop)}`, {
      start: -5,
      end: 10,
      loop,
    });
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
        runFfmpegImpl: windowWriter(calls, 6),
      });
      try {
        const args = calls[0] ?? [];
        expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2)).toEqual([
          "-ss",
          expectedSeek,
        ]);
        expect(args.slice(args.indexOf("-frames:v"), args.indexOf("-frames:v") + 2)).toEqual([
          "-frames:v",
          expectedFrames,
        ]);
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
          runFfmpegImpl: windowWriter(calls, 6),
        });
        try {
          const args = calls[0] ?? [];
          expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2)).toEqual([
            "-ss",
            "0.000000",
          ]);
          expect(args.slice(args.indexOf("-frames:v"), args.indexOf("-frames:v") + 2)).toEqual([
            "-frames:v",
            loop ? "7" : "6",
          ]);
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
            if (args.at(-1) === "-") return ffmpegResult(true);
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
  const sourceIn = (dir: string, close: () => void) => ({
    dir,
    windows: { totalFrames: 1, lease: async () => null, close },
    width: 1,
    height: 2,
    frameSize: 12,
    frameCount: 1,
    scratch: Buffer.alloc(12),
  });

  it("closes the windows and immediately removes their directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-hdr-cleanup-"));
    writeFileSync(join(dir, "window-0.rgb48le"), Buffer.alloc(12));
    const close = vi.fn();

    cleanupHdrVideoFrameSource(sourceIn(dir, close));

    expect(existsSync(dir)).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the windows but retains raw files with KEEP_TEMP=1", () => {
    vi.stubEnv("KEEP_TEMP", "1");
    const dir = mkdtempSync(join(tmpdir(), "hf-hdr-keep-temp-"));
    const rawPath = join(dir, "window-0.rgb48le");
    writeFileSync(rawPath, Buffer.alloc(12));
    const close = vi.fn();

    try {
      cleanupHdrVideoFrameSource(sourceIn(dir, close));

      expect(existsSync(rawPath)).toBe(true);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("extractHdrVideoFrames scratch bound", () => {
  it("holds a long clip in a few windows instead of the whole clip", async () => {
    const framesDir = mkdtempSync(join(tmpdir(), "hf-hdr-bounded-"));
    const video = hdrVideo("long", { start: 0, end: 20, mediaStart: 0 });
    const fixture = hdrExtractionFixture([video], framesDir);
    fixture.composition.duration = 20;
    const calls: string[][] = [];

    try {
      const extracted = await extractHdrVideoFrames({
        ...fixture,
        maxResidentWindows: 2,
        windowBytes: 8 * 6,
        extractMediaMetadataImpl: async () => videoMetadata(20),
        runFfmpegImpl: windowWriter(calls),
      });
      try {
        const source = extracted.sources.get("long");
        // 20 s at 2 fps is 40 one-pixel frames, held 8 per window.
        expect(source?.frameCount).toBe(40);
        expect(extracted.estimatedBytes).toBe(2 * 8 * 6);
        let mostFiles = 0;
        for (let i = 0; i < 40; i++) {
          const lease = await source?.windows.lease(i);
          lease?.release();
          mostFiles = Math.max(mostFiles, readdirSync(source?.dir ?? "").length);
        }
        expect(mostFiles).toBeLessThanOrEqual(2);
        expect(calls.length).toBe(5);
        // The second window starts at frame 8 (4 s): seek a whole second before it, trim the lead-in.
        const second = calls[1] ?? [];
        expect(second[second.indexOf("-ss") + 1]).toBe("3.000000");
        expect(second[second.indexOf("-vf") + 1]).toContain("fps=2:start_time=0.000000");
        expect(second[second.indexOf("-vf") + 1]).toContain("trim=start_frame=2");
      } finally {
        for (const source of extracted.sources.values()) cleanupHdrVideoFrameSource(source);
        extracted.releaseReservation();
      }
    } finally {
      rmSync(framesDir, { recursive: true, force: true });
    }
  });
});

describe("extractHdrVideoFrames loop frame count", () => {
  it("knows a looped source's real frame count before capture starts", async () => {
    const framesDir = mkdtempSync(join(tmpdir(), "hf-hdr-loop-count-"));
    const video = hdrVideo("loop", { start: 0, end: 20, mediaStart: 0, loop: true });
    const fixture = hdrExtractionFixture([video], framesDir);
    fixture.composition.duration = 20;
    const realFrames = 37;

    try {
      const extracted = await extractHdrVideoFrames({
        ...fixture,
        windowBytes: 8 * 6,
        extractMediaMetadataImpl: async () => videoMetadata(20),
        runFfmpegImpl: windowWriter([], realFrames),
      });
      try {
        // 40 planned frames plus one so the real end is observable; the source really has 37.
        expect(extracted.sources.get("loop")?.frameCount).toBe(realFrames);
      } finally {
        for (const source of extracted.sources.values()) cleanupHdrVideoFrameSource(source);
        extracted.releaseReservation();
      }
    } finally {
      rmSync(framesDir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!HAS_FFMPEG)("raw HDR windows past the first (#6556)", () => {
  async function leaseAll(src: string, end: number, dir: string) {
    const video = hdrVideo("counter", { src, start: 0, end });
    const fixture = hdrExtractionFixture([video], join(dir, "frames"));
    fixture.job = createRenderJob({ fps: { num: 30, den: 1 }, quality: "standard" });
    fixture.composition.duration = end;
    fixture.prep.hdrExtractionDims.set(video.id, { width: 64, height: 64 });
    const frameSize = 64 * 64 * 6;
    const extracted = await extractHdrVideoFrames({
      ...fixture,
      width: 64,
      height: 64,
      // 8-frame windows: frames 8 and up all come from seeked + trimmed passes.
      windowBytes: 8 * frameSize,
      runFfmpegImpl: runFfmpeg,
      extractMediaMetadataImpl: extractMediaMetadata,
      resolveFinalFrameExtractionWindowImpl: resolveFinalFrameExtractionWindow,
    });
    try {
      const source = extracted.sources.get(video.id)!;
      const frames: string[] = [];
      const buf = Buffer.alloc(frameSize);
      for (let i = 0; i < source.frameCount; i++) {
        const lease = await source.windows.lease(i);
        expect(lease).not.toBeNull();
        readSync(lease!.fd, buf, 0, frameSize, lease!.offset);
        lease!.release();
        frames.push(buf.toString("base64"));
      }
      return frames;
    } finally {
      for (const s of extracted.sources.values()) cleanupHdrVideoFrameSource(s);
      extracted.releaseReservation();
    }
  }

  it("gives every composition frame its own source frame across window boundaries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-hdr-window-dupes-"));
    const src = join(dir, "counter.mp4");
    try {
      const synth = await runFfmpeg([
        ...["-hide_banner", "-loglevel", "error", "-f", "lavfi"],
        ...["-i", "testsrc2=s=64x64:d=4:rate=30", "-f", "lavfi", "-i", "sine=d=4"],
        // The audio track matters: with one in the input, FFmpeg's default CFR sync pads a
        // timestamp-less raw output from pts 0 (camera/phone clips always carry audio).
        ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "30", "-c:a", "aac", "-y", src],
      ]);
      expect(synth.success).toBe(true);
      const frames = await leaseAll(src, 4, dir);
      expect(frames).toHaveLength(120);
      expect(new Set(frames).size).toBe(120);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("holds the first frame until a video that starts after its audio begins, like Chrome", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-hdr-window-delayed-"));
    const counter = join(dir, "counter.mp4");
    const src = join(dir, "delayed.mp4");
    try {
      const synth = await runFfmpeg([
        ...["-hide_banner", "-loglevel", "error", "-f", "lavfi"],
        ...["-i", "testsrc2=s=64x64:d=4:rate=30", "-f", "lavfi", "-i", "sine=d=4.5"],
        ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "30", "-c:a", "aac", "-y", counter],
      ]);
      expect(synth.success).toBe(true);
      const delay = await runFfmpeg([
        ...[
          "-hide_banner",
          "-loglevel",
          "error",
          "-itsoffset",
          "0.5",
          "-i",
          counter,
          "-i",
          counter,
        ],
        ...["-map", "0:v", "-map", "1:a", "-c", "copy", "-y", src],
      ]);
      expect(delay.success).toBe(true);
      const frames = await leaseAll(src, 4.5, dir);
      // The picture starts at 0.5 s = frame 15; until then the first frame shows.
      expect(frames).toHaveLength(135);
      expect(new Set(frames.slice(0, 16)).size).toBe(1);
      expect(frames.slice(15)).toEqual(await leaseAll(counter, 4, dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

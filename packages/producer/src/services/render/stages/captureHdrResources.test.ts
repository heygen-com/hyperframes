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
import type { RunFfmpegResult, VideoElement } from "@hyperframes/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRenderJob } from "../../renderOrchestrator.js";
import {
  cleanupHdrVideoFrameSource,
  estimateHdrExtractionBytes,
  extractHdrVideoFrames,
  getHdrExtractionReservedBytes,
  reserveHdrExtractionBytes,
  resolveHdrExtractionActiveBudgetBytes,
  resolveHdrExtractionBudgetBytes,
  resolveHdrExtractionWindow,
} from "./captureHdrResources.js";

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
  };
}

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
    const { durationSeconds } = resolveHdrExtractionWindow(
      { id: "long-hdr", start: 0, end: Number.POSITIVE_INFINITY, mediaStart: 0 },
      2,
    );
    expect(durationSeconds).toBe(2);
    expect(estimateHdrExtractionBytes([{ durationSeconds, width: 3840, height: 2160 }], 30)).toBe(
      60 * 3840 * 2160 * 6,
    );
  });

  it("independently caps a stale finite media end at the composition duration", () => {
    expect(resolveHdrExtractionWindow({ id: "hdr", start: 0, end: 60, mediaStart: 0 }, 2)).toEqual({
      compositionStart: 0,
      mediaStart: 0,
      durationSeconds: 2,
    });
  });

  it("preserves negative starts and source offsets while bounding the timeline end", () => {
    expect(resolveHdrExtractionWindow({ id: "hdr", start: -3, end: 60, mediaStart: 5 }, 2)).toEqual(
      { compositionStart: -3, mediaStart: 5, durationSeconds: 5 },
    );
  });

  it("rejects HDR media with no interval inside the composition", () => {
    expect(() =>
      resolveHdrExtractionWindow({ id: "hdr", start: 3, end: Infinity, mediaStart: 0 }, 2),
    ).toThrow('HDR video "hdr" has no finite interval inside the 2s composition');
  });
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
  it("pins FFmpeg seek/duration, raw frame count, and reservation lifetime", async () => {
    const framesDir = mkdtempSync(join(tmpdir(), "hf-hdr-extract-"));
    const video = hdrVideo("preroll", { start: -1, end: 60, mediaStart: 7 });
    const fixture = hdrExtractionFixture([video], framesDir);
    const calls: string[][] = [];

    try {
      const extracted = await extractHdrVideoFrames({
        ...fixture,
        runFfmpegImpl: async (args) => {
          calls.push(args);
          const rawPath = args.at(-1);
          if (!rawPath) throw new Error("mock FFmpeg output path missing");
          // start=-1 through composition end=2 => 3s * 2fps = 6 rgb48le 1x1 frames.
          writeFileSync(rawPath, Buffer.alloc(6 * 6));
          return ffmpegResult(true);
        },
      });
      try {
        expect(calls).toHaveLength(1);
        const args = calls[0] ?? [];
        expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2)).toEqual(["-ss", "7"]);
        expect(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2)).toEqual(["-t", "3"]);
        expect(extracted.sources.get("preroll")?.frameCount).toBe(6);
        expect(extracted.estimatedBytes).toBe(36);
        expect(getHdrExtractionReservedBytes()).toBe(36);
      } finally {
        for (const source of extracted.sources.values()) cleanupHdrVideoFrameSource(source);
        extracted.releaseReservation();
      }
    } finally {
      rmSync(framesDir, { recursive: true, force: true });
    }
  });

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

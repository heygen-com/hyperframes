import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaptureFailure, DEFAULT_CONFIG, classifyCaptureFailure } from "@hyperframes/engine";
import { createRenderJob, isTransientCaptureRetryEligible } from "../../renderOrchestrator.js";
import { formatCaptureFrameName } from "../../../utils/paths.js";
import { CaptureStageError, getCaptureStageBrowserConsole } from "../captureStageError.js";
import { summarizeBrowserDiagnostics } from "../observability.js";

// Mock only the engine session primitives; `classifyCaptureFailure` stays
// real so the retry decision is exercised.
const createCaptureSession = vi.fn();
const initializeSession = vi.fn(async () => {});
const captureFrame = vi.fn();
const closeCaptureSession = vi.fn(async () => {});
const verifyDiskDrawElementSamples = vi.fn(async () => {});
const getCapturePerfSummary = vi.fn(() => ({}));
const executeParallelCapture = vi.fn();

vi.mock("@hyperframes/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/engine")>();
  return {
    ...actual,
    createCaptureSession: (...args: unknown[]) => createCaptureSession(...args),
    initializeSession: (...args: unknown[]) => initializeSession(...args),
    captureFrame: (...args: unknown[]) => captureFrame(...args),
    closeCaptureSession: (...args: unknown[]) => closeCaptureSession(...args),
    verifyDiskDrawElementSamples: (...args: unknown[]) => verifyDiskDrawElementSamples(...args),
    getCapturePerfSummary: (...args: unknown[]) => getCapturePerfSummary(...args),
    executeParallelCapture: (...args: unknown[]) => executeParallelCapture(...args),
    mergeWorkerFrames: async () => {},
  };
});

const freeBytes = vi.fn<(path: string) => { bavail: number; bsize: number }>();
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    statfsSync: (path: string) => freeBytes(path) ?? actual.statfsSync(path),
  };
});

import {
  createDiskCaptureProjection,
  diskCaptureRemedy,
  diskCaptureShortfallError,
  measureCaptureFrameBytes,
  estimateDiskCaptureBytes,
  inspectDiskCaptureHeadroom,
  runCaptureStage,
  shouldAllowAdaptiveCaptureRetry,
} from "./captureStage.js";

describe("shouldAllowAdaptiveCaptureRetry", () => {
  it("keeps timeout recovery enabled when the initial worker count was explicit", () => {
    expect(shouldAllowAdaptiveCaptureRetry(6, true)).toBe(true);
  });

  it("does not retry an already sequential capture", () => {
    expect(shouldAllowAdaptiveCaptureRetry(1, true)).toBe(false);
  });
});

describe("disk capture capacity", () => {
  const captureOptions = {
    width: 100,
    height: 50,
    fps: { num: 30, den: 1 },
    deviceScaleFactor: 2,
    format: "jpeg" as const,
  };

  const pngOptions = { ...captureOptions, format: "png" as const };

  it("estimates output-resolution frame storage conservatively", () => {
    expect(estimateDiskCaptureBytes(10, pngOptions)).toBe(800_000);
  });

  it("estimates jpeg frames well below the raw RGBA model", () => {
    expect(estimateDiskCaptureBytes(10, captureOptions)).toBe(100_000);
  });

  it("allows for the larger frames of jpeg above draft quality", () => {
    expect(estimateDiskCaptureBytes(10, { ...captureOptions, quality: 80 })).toBe(100_000);
    expect(estimateDiskCaptureBytes(10, { ...captureOptions, quality: 95 })).toBe(200_000);
    expect(estimateDiskCaptureBytes(10, { ...captureOptions, quality: 100 })).toBe(200_000);
  });

  it("exposes the same 90% headroom decision to fallback planning", () => {
    const estimatedBytes = estimateDiskCaptureBytes(10, pngOptions);

    expect(
      inspectDiskCaptureHeadroom(
        "/render/captured-frames",
        10,
        pngOptions,
        () => estimatedBytes / 0.9 - 1,
      ),
    ).toEqual({ available: false, estimatedBytes, freeBytes: estimatedBytes / 0.9 - 1 });
    expect(
      inspectDiskCaptureHeadroom("/render/captured-frames", 10, pngOptions, () => null).available,
    ).toBe(true);
  });

  it("rejects the reported 5318-frame landscape png disk route with 45 GiB free", () => {
    const landscape = {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      format: "png" as const,
    };
    const headroom = inspectDiskCaptureHeadroom(
      "/render/captured-frames",
      5318,
      landscape,
      () => 45 * 1024 ** 3,
    );

    expect(headroom.estimatedBytes).toBe(5318 * 1920 * 1080 * 4);
    expect(headroom.available).toBe(false);
  });

  it("lets the same 5318-frame landscape route through as jpeg", () => {
    const landscape = { ...captureOptions, width: 1920, height: 1080, deviceScaleFactor: 1 };
    expect(
      inspectDiskCaptureHeadroom("/render/captured-frames", 5318, landscape, () => 45 * 1024 ** 3)
        .available,
    ).toBe(true);
  });
});

describe("diskCaptureRemedy", () => {
  it("offers --workers 1 when one worker would stream this render", () => {
    const remedy = diskCaptureRemedy(DEFAULT_CONFIG, "mp4", 60, 4);
    expect(remedy).toContain("captures with 4 workers");
    expect(remedy).toContain("re-run this render with --workers 1");
  });

  it("never offers --workers 1 where one worker would still store every frame", () => {
    const capped = { ...DEFAULT_CONFIG, streamingEncodeDurationCapEnabled: true };
    const cases = [
      [DEFAULT_CONFIG, "mp4", 60, 1, "Free up disk space."],
      [DEFAULT_CONFIG, "png-sequence", 60, 4, "png-sequence output stores every frame"],
      [DEFAULT_CONFIG, "gif", 60, 1, "gif output stores every frame"],
      [
        { ...DEFAULT_CONFIG, enableStreamingEncode: false },
        "mp4",
        60,
        4,
        "PRODUCER_ENABLE_STREAMING_ENCODE=false",
      ],
      [capped, "mp4", 600, 4, "--low-memory-mode, which streams past it"],
    ] as const;
    for (const [cfg, format, duration, workers, condition] of cases) {
      const remedy = diskCaptureRemedy(cfg, format, duration, workers);
      expect(remedy).toContain(condition);
      expect(remedy).not.toContain("--workers 1");
    }
  });
});

describe("createDiskCaptureProjection", () => {
  it("throws a measured shortfall once ten frames show the remainder cannot fit", () => {
    const measure = vi.fn(() => 10e6);
    const check = createDiskCaptureProjection({
      framesDir: "/frames",
      totalFrames: 1010,
      measureBytes: measure,
      remedy: "Free up disk space.",
      freeDiskBytes: () => 500e6,
    });
    check(9);
    expect(measure).not.toHaveBeenCalled();
    expect(() => check(10)).toThrow(
      /~1000\.0 MB.*measured from the first 10 frames.*500\.0 MB is free at \/frames/s,
    );
    expect(() => check(11)).not.toThrow();
  });

  it("does not spend its one check on an empty measurement", () => {
    let bytes = 0;
    const check = createDiskCaptureProjection({
      framesDir: "/frames",
      totalFrames: 1010,
      measureBytes: () => bytes,
      remedy: "Free up disk space.",
      freeDiskBytes: () => 500e6,
    });
    expect(() => check(10)).not.toThrow();
    bytes = 10e6;
    expect(() => check(11)).toThrow(/measured from the first/);
  });

  it("measures frames in retry-batch worker dirs as well as capture-attempt dirs", () => {
    const workDir = mkdtempSync(join(tmpdir(), "hf-measure-"));
    try {
      const framesDir = join(workDir, "captured-frames");
      for (const dir of [
        framesDir,
        join(workDir, "capture-attempt-0", "worker-0"),
        join(workDir, "retry-1-batch-0-worker-0"),
      ]) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "frame_000001.jpg"), Buffer.alloc(1000));
      }
      expect(measureCaptureFrameBytes(workDir, framesDir)).toBe(3000);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("stays quiet when the projected remainder fits", () => {
    const check = createDiskCaptureProjection({
      framesDir: "/frames",
      totalFrames: 1010,
      measureBytes: () => 10e6,
      remedy: "Free up disk space.",
      freeDiskBytes: () => 5000e6,
    });
    expect(() => check(10)).not.toThrow();
  });
});

describe("runCaptureStage measured disk projection (both branches)", () => {
  const roots: string[] = [];
  const oneMb = Buffer.alloc(1_000_000);
  const makeInput = (workerCount: number, workDir: string, framesDir: string) => ({
    fileServer: { url: "http://localhost:0" } as never,
    workDir,
    framesDir,
    job: { ...createRenderJob({ fps: { num: 30, den: 1 }, quality: "draft" }), duration: 20 / 30 },
    totalFrames: 20,
    cfg: DEFAULT_CONFIG,
    plan: { workerCount, forceScreenshot: false },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never,
    probeSession: null,
    captureAttempts: [],
    dedupPerfs: [],
    buildCaptureOptions: () => ({
      width: 64,
      height: 64,
      fps: { num: 30, den: 1 },
      format: "jpeg" as const,
    }),
    createRenderVideoFrameInjector: () => null,
    abortSignal: undefined,
    assertNotAborted: () => {},
  });
  const makeDirs = () => {
    const workDir = mkdtempSync(join(tmpdir(), "hf-disk-projection-"));
    const framesDir = join(workDir, "captured-frames");
    mkdirSync(framesDir);
    roots.push(workDir);
    return { workDir, framesDir };
  };

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    createCaptureSession.mockReset();
    captureFrame.mockReset();
    executeParallelCapture.mockReset();
    freeBytes.mockReset();
    closeCaptureSession.mockReset().mockResolvedValue(undefined);
  });

  it("sequential: stops after ten frames when the measured remainder cannot fit", async () => {
    const { workDir, framesDir } = makeDirs();
    // 8 MB free: passes the static jpeg estimate, fails the 10 MB measured remainder.
    freeBytes.mockReturnValue({ bavail: 8_000_000, bsize: 1 });
    createCaptureSession.mockResolvedValue({
      isInitialized: false,
      browserConsoleBuffer: [],
      options: { captureBeyondViewport: false, format: "jpeg" },
      workerEncodeEnabled: false,
      outputDir: framesDir,
    });
    captureFrame.mockImplementation(async (_s: unknown, index: number) => {
      writeFileSync(join(framesDir, formatCaptureFrameName(index, "jpg")), oneMb);
    });

    const error = await runCaptureStage(makeInput(1, workDir, framesDir)).catch((e: Error) => e);
    expect(String(error)).toMatch(/measured from the first 10 frames.*Free up disk space\./s);
    expect(String(error)).not.toContain("--workers 1");
    expect(captureFrame).toHaveBeenCalledTimes(10);
    expect(createCaptureSession).toHaveBeenCalledTimes(1);
  });

  it("sequential: a png render whose raw estimate exceeds free space still captures when frames are small", async () => {
    const { workDir, framesDir } = makeDirs();
    // 64x64 png estimates 20 * 16 KB = 327 KB raw; 100 KB free, but the real frames are 100 bytes.
    freeBytes.mockReturnValue({ bavail: 100_000, bsize: 1 });
    createCaptureSession.mockResolvedValue({
      isInitialized: false,
      browserConsoleBuffer: [],
      options: { captureBeyondViewport: false, format: "png" },
      workerEncodeEnabled: false,
      outputDir: framesDir,
    });
    captureFrame.mockImplementation(async (_s: unknown, index: number) => {
      writeFileSync(join(framesDir, formatCaptureFrameName(index, "png")), Buffer.alloc(100));
    });
    const input = makeInput(1, workDir, framesDir);

    await runCaptureStage({
      ...input,
      buildCaptureOptions: () => ({ ...input.buildCaptureOptions(), format: "png" as const }),
    });
    expect(captureFrame).toHaveBeenCalledTimes(20);
  });

  it("a measured shortfall is never classified as a retryable browser death", () => {
    const shortfall = diskCaptureShortfallError(10e9, 1e9, "/frames", "measured", "");
    const kind = classifyCaptureFailure(shortfall);
    expect(kind).not.toBe("transient_browser");
    expect(isTransientCaptureRetryEligible(kind, [{ startFrame: 10, endFrame: 20 }], 0)).toBe(
      false,
    );
  });

  it("parallel: page errors seen only by worker sessions reach the diagnostics count", async () => {
    const { workDir, framesDir } = makeDirs();
    freeBytes.mockReturnValue({ bavail: 10_000_000_000, bsize: 1 });
    executeParallelCapture.mockImplementation(async () => {
      for (let i = 0; i < 20; i++) {
        writeFileSync(join(framesDir, formatCaptureFrameName(i, "jpg")), oneMb);
      }
      return [
        { pageErrorLines: ["[Browser:PAGEERROR] Identifier 'dup' has already been declared"] },
        { pageErrorLines: ["[Browser:PAGEERROR] Identifier 'dup' has already been declared"] },
      ];
    });

    const result = await runCaptureStage(makeInput(2, workDir, framesDir));

    expect(summarizeBrowserDiagnostics(result.lastBrowserConsole).pageErrors).toBe(1);
  });

  it("parallel: a failed capture still reports the page errors its workers saw", async () => {
    const { workDir, framesDir } = makeDirs();
    freeBytes.mockReturnValue({ bavail: 10_000_000_000, bsize: 1 });
    executeParallelCapture.mockRejectedValue(
      new CaptureFailure({
        kind: "authoring",
        message: "Composition has zero duration.",
        pageErrorLines: ["[Browser:PAGEERROR] ReferenceError: gsap is not defined"],
      }),
    );

    const probeSession = {
      browserConsoleBuffer: ["[FrameCapture:ERROR] page.goto failed"],
      options: { captureBeyondViewport: false },
    } as never;

    const error = await runCaptureStage({
      ...makeInput(2, workDir, framesDir),
      probeSession,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CaptureStageError);
    expect(getCaptureStageBrowserConsole(error)).toEqual([
      "[FrameCapture:ERROR] page.goto failed",
      "[Browser:PAGEERROR] ReferenceError: gsap is not defined",
    ]);
  });

  it("parallel: the progress callback raises the same shortfall from worker dirs", async () => {
    const { workDir, framesDir } = makeDirs();
    freeBytes.mockReturnValue({ bavail: 8_000_000, bsize: 1 });
    executeParallelCapture.mockImplementation(
      async (
        _url: string,
        attemptWorkDir: string,
        _tasks: unknown,
        _opts: unknown,
        _hook: unknown,
        _signal: unknown,
        onProgress: (p: {
          capturedFrames: number;
          totalFrames: number;
          activeWorkers: number;
        }) => void,
      ) => {
        const workerDir = join(attemptWorkDir, "worker-0");
        mkdirSync(workerDir, { recursive: true });
        for (let i = 0; i < 10; i++) {
          writeFileSync(join(workerDir, formatCaptureFrameName(i, "jpg")), oneMb);
        }
        onProgress({ capturedFrames: 10, totalFrames: 20, activeWorkers: 2 });
        return [];
      },
    );

    await expect(runCaptureStage(makeInput(2, workDir, framesDir))).rejects.toThrow(
      /measured from the first 10 frames.*re-run this render with --workers 1/s,
    );
  });
});

describe("runCaptureStage — sequential path transient Target-closed single retry (integration)", () => {
  afterEach(() => {
    createCaptureSession.mockReset();
    initializeSession.mockReset().mockResolvedValue(undefined);
    captureFrame.mockReset();
    closeCaptureSession.mockReset().mockResolvedValue(undefined);
    verifyDiskDrawElementSamples.mockReset().mockResolvedValue(undefined);
    getCapturePerfSummary.mockReset().mockReturnValue({});
  });

  it("retries once with a fresh session on a Target-closed and renders the remaining frames", async () => {
    const framesDir = mkdtempSync(join(tmpdir(), "hf-seq-transient-frames-"));
    const totalFrames = 4;
    let sessionCount = 0;
    createCaptureSession.mockImplementation(async () => {
      sessionCount++;
      return {
        isInitialized: false,
        browserConsoleBuffer: [],
        options: { captureBeyondViewport: false, format: "jpeg" },
        workerEncodeEnabled: false,
        outputDir: framesDir,
      };
    });
    captureFrame.mockImplementation(async (_session: unknown, frameIndex: number) => {
      // First session dies on frame 0 (zero forward progress).
      if (sessionCount === 1) {
        throw new Error("Protocol error (Page.captureScreenshot): Target closed");
      }
      writeFileSync(join(framesDir, formatCaptureFrameName(frameIndex, "jpg")), "captured-frame");
    });
    const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };

    try {
      const job = createRenderJob({ fps: { num: 30, den: 1 }, quality: "draft" });
      const result = await runCaptureStage({
        fileServer: { url: "http://localhost:0" } as never,
        workDir: framesDir,
        framesDir,
        job,
        totalFrames,
        cfg: DEFAULT_CONFIG,
        plan: { workerCount: 1, forceScreenshot: false },
        log: log as never,
        probeSession: null,
        captureAttempts: [],
        dedupPerfs: [],
        buildCaptureOptions: () => ({
          width: 64,
          height: 64,
          fps: { num: 30, den: 1 },
          format: "jpeg",
        }),
        createRenderVideoFrameInjector: () => null,
        abortSignal: undefined,
        assertNotAborted: () => {},
      });

      expect(createCaptureSession).toHaveBeenCalledTimes(2);
      expect(captureFrame).toHaveBeenCalledTimes(1 + totalFrames);
      expect(closeCaptureSession).toHaveBeenCalledTimes(2);
      expect(result.workerCount).toBe(1);
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining("Transient browser failure during sequential capture"),
        expect.objectContaining({ transientRetriesUsed: 1, resumeFrom: 0 }),
      );
    } finally {
      rmSync(framesDir, { recursive: true, force: true });
    }
  });

  it("resumes from the first missing frame inside a frameRange and fails on a second death", async () => {
    const framesDir = mkdtempSync(join(tmpdir(), "hf-seq-transient-range-"));
    let sessionCount = 0;
    createCaptureSession.mockImplementation(async () => {
      sessionCount++;
      return {
        isInitialized: false,
        browserConsoleBuffer: [],
        options: { captureBeyondViewport: false, format: "jpeg" },
        workerEncodeEnabled: false,
        outputDir: framesDir,
      };
    });
    const times: number[] = [];
    captureFrame.mockImplementation(async (_s: unknown, frameIndex: number, time: number) => {
      times.push(time);
      if (sessionCount === 1 && frameIndex === 2) {
        throw new Error("Protocol error (Runtime.callFunctionOn): Target closed");
      }
      if (sessionCount === 2 && frameIndex === 3) {
        throw new Error("Protocol error (Runtime.callFunctionOn): Target closed");
      }
      writeFileSync(join(framesDir, formatCaptureFrameName(frameIndex, "jpg")), "captured-frame");
    });
    const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const job = createRenderJob({ fps: { num: 10, den: 1 }, quality: "draft" });

    try {
      await expect(
        runCaptureStage({
          fileServer: { url: "http://localhost:0" } as never,
          workDir: framesDir,
          framesDir,
          job,
          totalFrames: 4,
          cfg: DEFAULT_CONFIG,
          plan: { workerCount: 1, forceScreenshot: false },
          log: log as never,
          probeSession: null,
          captureAttempts: [],
          dedupPerfs: [],
          buildCaptureOptions: () => ({
            width: 64,
            height: 64,
            fps: { num: 10, den: 1 },
            format: "jpeg",
          }),
          createRenderVideoFrameInjector: () => null,
          abortSignal: undefined,
          assertNotAborted: () => {},
          frameRange: { startFrame: 10, endFrame: 14 },
        }),
      ).rejects.toThrow(/Target closed/);

      // Session 1: frames 0,1 ok, 2 dies. Session 2 resumes at 2 (absolute 12 -> 1.2s),
      // frame 2 ok, 3 dies; no third session.
      expect(createCaptureSession).toHaveBeenCalledTimes(2);
      expect(times).toEqual([1.0, 1.1, 1.2, 1.2, 1.3]);
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(closeCaptureSession).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(framesDir, { recursive: true, force: true });
    }
  });
});

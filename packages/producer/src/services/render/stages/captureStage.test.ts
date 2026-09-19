import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "@hyperframes/engine";
import { createRenderJob } from "../../renderOrchestrator.js";
import { formatCaptureFrameName } from "../../../utils/paths.js";

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
  assertDiskCaptureHeadroom,
  createDiskCaptureProjection,
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

  it("fails before capture when estimated frames exceed available headroom", () => {
    expect(() =>
      assertDiskCaptureHeadroom("/render/captured-frames", 10, pngOptions, () => 800_000),
    ).toThrow(/may need ~0\.8 MB.*0\.8 MB is free.*--low-memory-mode/s);
  });

  it("tells the user which routes still use disk capture, not a dead env var", () => {
    const landscape = {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      format: "png" as const,
    };
    let message = "";
    try {
      assertDiskCaptureHeadroom("/tmp/frames", 9000, landscape, () => 10 * 1e9);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("Disk capture may need");
    expect(message).toContain("--workers 1");
    expect(message).toContain("--low-memory-mode");
    // Every override that can land an otherwise-streaming render here, so the
    // message explains the case the reader is actually in. The duration cap
    // matters because it sends even a --workers 1 render to disk, which the
    // pre-Phase-1 wording told them to "fix" with --workers 1.
    expect(message).toContain("HF_CAPTURE_PARALLEL_STREAM=true");
    expect(message).toContain("PRODUCER_STREAMING_ENCODE_DURATION_CAP_ENABLED=true");
    expect(message).toContain("png-sequence");
    expect(message).not.toContain("PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS if streaming");
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

describe("createDiskCaptureProjection", () => {
  it("throws a measured shortfall once ten frames show the remainder cannot fit", () => {
    const measure = vi.fn(() => 10e6);
    const check = createDiskCaptureProjection({
      framesDir: "/frames",
      totalFrames: 1010,
      measureBytes: measure,
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
    job: createRenderJob({ fps: { num: 30, den: 1 }, quality: "draft" }),
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

    await expect(runCaptureStage(makeInput(1, workDir, framesDir))).rejects.toThrow(
      /measured from the first 10 frames/,
    );
    expect(captureFrame).toHaveBeenCalledTimes(10);
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
      /measured from the first 10 frames/,
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  };
});

import {
  assertDiskCaptureHeadroom,
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

  it("estimates output-resolution frame storage conservatively", () => {
    expect(estimateDiskCaptureBytes(10, captureOptions)).toBe(800_000);
  });

  it("fails before capture when estimated frames exceed available headroom", () => {
    expect(() =>
      assertDiskCaptureHeadroom("/render/captured-frames", 10, captureOptions, () => 800_000),
    ).toThrow(/may need ~0\.8 MB.*0\.8 MB is free.*--low-memory-mode/s);
  });

  it("tells the user which routes still use disk capture, not a dead env var", () => {
    const landscape = {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      format: "jpeg" as const,
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
    const estimatedBytes = estimateDiskCaptureBytes(10, captureOptions);

    expect(
      inspectDiskCaptureHeadroom(
        "/render/captured-frames",
        10,
        captureOptions,
        () => estimatedBytes / 0.9 - 1,
      ),
    ).toEqual({ available: false, estimatedBytes, freeBytes: estimatedBytes / 0.9 - 1 });
    expect(
      inspectDiskCaptureHeadroom("/render/captured-frames", 10, captureOptions, () => null)
        .available,
    ).toBe(true);
  });

  it("rejects the reported 5318-frame landscape disk route with 45 GiB free", () => {
    const landscape = {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      format: "jpeg" as const,
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

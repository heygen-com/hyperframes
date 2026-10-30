// fallow-ignore-file code-duplication
import { afterAll, describe, expect, it, mock, setSystemTime } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixtureRoot = mkdtempSync(join(tmpdir(), "hf-stage-test-"));
const framesDir = join(fixtureRoot, "frames");
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));
import { CaptureStageError, getCaptureStageBrowserConsole } from "../captureStageError.js";
import { createCapturePlan } from "../capturePlan.js";
import type { CaptureHdrStageInput } from "./captureHdrStage.js";

type MinimalEngineConfig = {
  forceScreenshot: boolean;
  ffmpegStreamingTimeout: number;
  beginFrameFirstFrameDeadlineMs?: number;
  lowMemoryMode?: boolean;
};

const writeFrame = mock((_buffer: Buffer) => true);
const closeEncoder = mock(async () => ({ success: true, durationMs: 123, fileSize: 42 }));
const spawnStreamingEncoder = mock(async () => ({
  writeFrame,
  close: closeEncoder,
  getExitStatus: () => "success",
  getExitError: () => undefined,
}));
let failCaptureFrameToBuffer = false;
let failInitializeSession = false;
let hangParallelUntilAbort = false;
// Parallel capture that writes this many frames, then wedges until aborted: on its first attempt,
// or on every attempt when stallEveryParallelAttempt is set.
let stallParallelAfterFrames: number | null = null;
let stallEveryParallelAttempt = false;
let parallelAttempts = 0;
const distributeCalls: Array<{ frames: number; rangeStart: number }> = [];
const reorderStarts: number[] = [];
// Which phase the wedged worker reports. frame_capture = past init, wedged in
// a capture call (the watchdog's job); session_init = still booting (not).
let hangParallelPhase: "session_init" | "frame_capture" = "frame_capture";
let failWorkerTransient = false;
let workerFailurePageErrors: string[] = [];
// Parallel capture that reports this many frames, advancing the clock by parallelFrameMs each.
let parallelFrames = 0;
let parallelFrameMs = 0;
// Slow parallel capture on a virtual clock: one frame per 2 s, `slowTotal` frames, stops on abort.
let slowParallel = false;
let slowTotal = 0;
let virtualNow = 0;
let injectedWorkerFailure: Error | null = null;
const reorderAbortCalls: unknown[] = [];
let hangSequentialUntilStall = false;
let sessionWorkerEncodeEnabled = false;
let captureSessionMode: "drawelement" | "screenshot" | "beginframe" = "drawelement";
// Frames the drawElement session hands to a screenshot session, and the batches it was asked for.
let sessionRiskFrames: Set<number> | undefined;
let batchesRequested: number[][] | null = null;
// A session with a before-capture hook (video frames) captures one frame at a time.
let sessionHasBeforeCapture = false;
const deFrame = (index: number) =>
  Buffer.concat([Buffer.from(`de${index}:`), Buffer.alloc(30_000)]);
let failPrepareCaptureSessionForReuse = false;
let initializeSessionErrorMessage = "initialize failed";
const browserConsoleBuffer = ["[FrameCapture:ERROR] page.goto failed"];
const closeCaptureSession = mock(async () => {});
class DrawElementVerificationError extends Error {}

async function replaySlowCapture(
  signal: AbortSignal | undefined,
  onProgress: ((progress: unknown) => void) | undefined,
): Promise<never[]> {
  for (let frame = 1; frame <= slowTotal; frame++) {
    if (signal?.aborted) throw new Error("[Parallel] Capture failed: aborted");
    virtualNow += 2_000;
    onProgress?.({
      totalFrames: slowTotal,
      capturedFrames: frame,
      activeWorkers: 2,
      workerProgress: new Map(),
    });
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return [];
}

// Writes frames to the ordered writer from the range the stage last asked for, then wedges until
// aborted on the first attempt (every attempt with stallEveryParallelAttempt).
async function replayStalledCapture(
  signal: AbortSignal | undefined,
  onProgress: ((progress: unknown) => void) | undefined,
  onFrameBuffer: ((frame: number, buffer: Buffer, session: unknown) => Promise<void>) | undefined,
): Promise<never[]> {
  const { frames, rangeStart } = distributeCalls[distributeCalls.length - 1]!;
  const wedges = ++parallelAttempts === 1 || stallEveryParallelAttempt;
  const end = rangeStart + (wedges ? stallParallelAfterFrames! : frames);
  const progress = (capturedFrames: number, extra = {}) =>
    onProgress?.({
      totalFrames: frames,
      capturedFrames,
      activeWorkers: 1,
      workerProgress: new Map(),
      ...extra,
    });
  progress(0, {
    latestWorkerPhase: {
      workerId: 0,
      phase: "frame_capture",
      browserExecutable: "chrome",
      browserVersion: "Chrome/152.0.7977.30",
      canvasDrawElement: false,
      gpuBackend: "swiftshader",
    },
  });
  for (let frame = rangeStart; frame < end; frame++) {
    await onFrameBuffer?.(frame, Buffer.from(`f${frame}`), { captureMode: "beginframe" });
    progress(frame - rangeStart + 1);
  }
  if (wedges) await rejectWhenAborted(signal);
  return [];
}

// Simulates a wedged worker: no further progress, then the pool's generic rejection once aborted.
function rejectWhenAborted(signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((_resolve, reject) => {
    const fail = () => reject(new Error("[Parallel] Capture failed: aborted"));
    if (signal?.aborted) return fail();
    signal?.addEventListener("abort", fail, { once: true });
  });
}

mock.module("@hyperframes/engine", () => ({
  calculateOptimalWorkers: () => 1,
  convertTransfer: () => {},
  captureFrame: async () => {},
  captureFrameToBufferPipelined: async (_session: unknown, frameIndex: number) => {
    if (hangSequentialUntilStall) {
      return new Promise(() => {});
    }
    if (batchesRequested) batchesRequested.push([frameIndex]);
    return {
      encodeResult: Promise.resolve(batchesRequested ? deFrame(frameIndex) : Buffer.from("frame")),
    };
  },
  captureFramesBatchPipelined: async (_session: unknown, indices: number[]) => {
    if (hangSequentialUntilStall) {
      return new Promise(() => {});
    }
    if (!batchesRequested) return [];
    batchesRequested.push(indices);
    return indices.map((frameIndex) => ({
      frameIndex,
      encodeResult: Promise.resolve(deFrame(frameIndex)),
    }));
  },
  captureFrameToBuffer: async (
    session: { captureStep?: string; isScreenshotFallback?: boolean },
    frameIndex: number,
  ) => {
    if (session.isScreenshotFallback) {
      return { buffer: Buffer.from(`screenshot${frameIndex}`), captureTimeMs: 1 };
    }
    if (failCaptureFrameToBuffer) {
      throw new Error("captureFrameToBuffer failed");
    }
    if (hangSequentialUntilStall) {
      session.captureStep = "capturing the frame";
      return new Promise(() => {});
    }
    return { buffer: Buffer.from("frame"), captureTimeMs: 1 };
  },
  closeCaptureSession,
  cloneCaptureWarnings: () => [],
  completeDeferredDrawElementInit: async () => {},
  createCaptureSession: async (
    _url: string,
    _dir: string,
    _options: unknown,
    _injector: unknown,
    config?: { useDrawElement?: boolean },
  ) => ({
    isScreenshotFallback: config?.useDrawElement === false,
    onBeforeCapture: sessionHasBeforeCapture ? async () => {} : undefined,
    deRiskFrames: config?.useDrawElement === false ? undefined : sessionRiskFrames,
    isInitialized: false,
    browserConsoleBuffer,
    options: { captureBeyondViewport: false },
    workerEncodeEnabled: sessionWorkerEncodeEnabled,
    captureMode: captureSessionMode,
    page: {
      evaluate: mock(async (): Promise<unknown> => [])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({}),
    },
    warnings: [],
  }),
  createFrameReorderBuffer: (startFrame: number) => ({
    ...(reorderStarts.push(startFrame) && {}),
    waitForFrame: async () => {},
    advanceTo: () => {},
    abort: (reason: unknown) => {
      reorderAbortCalls.push(reason);
    },
  }),
  distributeFrames: () => [],
  distributeFramesInterleaved: (frames: number, _workers: number, _dir: string, rangeStart = 0) => {
    distributeCalls.push({ frames, rangeStart });
    return [{ workerId: 0, startFrame: rangeStart, endFrame: rangeStart + frames }];
  },
  DrawElementVerificationError,
  executeParallelCapture: async (
    _url: string,
    _workDir: string,
    _tasks: unknown,
    _opts: unknown,
    _hook: unknown,
    signal?: AbortSignal,
    onProgress?: (progress: unknown) => void,
    onFrameBuffer?: (frame: number, buffer: Buffer, session: unknown) => Promise<void>,
    _config?: unknown,
    hooks?: { onWorkerFailure?: (failure: Error) => void },
  ) => {
    if (stallParallelAfterFrames !== null) {
      return replayStalledCapture(signal, onProgress, onFrameBuffer);
    }
    if (failWorkerTransient) {
      // One worker's Chrome died. The engine reports the ORIGINAL failure
      // through the hook, then the pool rejects with its flattened summary.
      // That ordering is the engine's contract, pinned without a browser by
      // parallelCoordinator.test.ts "createPoolFailureHandler"; this mock
      // only replays it.
      const { CaptureFailure } = await import("@hyperframes/engine");
      injectedWorkerFailure = new CaptureFailure({
        kind: "transient_browser",
        message: "Protocol error (Page.captureScreenshot): Target closed",
        pageErrorLines: workerFailurePageErrors,
      });
      hooks?.onWorkerFailure?.(injectedWorkerFailure);
      throw new Error(
        "[Parallel] Capture failed: Worker 1: Protocol error (Page.captureScreenshot): Target closed",
      );
    }
    if (hangParallelUntilAbort) {
      onProgress?.({
        totalFrames: 100,
        capturedFrames: 0,
        activeWorkers: 2,
        workerProgress: new Map([
          [0, 0],
          [1, 0],
        ]),
        latestWorkerPhase: {
          workerId: 0,
          phase: hangParallelPhase,
          browserExecutable: "C:/Chrome/chrome.exe",
          browserVersion: "Chrome/152.0.7977.30",
          canvasDrawElement: true,
          gpuBackend: "d3d11/nvidia",
        },
      });
      await rejectWhenAborted(signal);
    }
    if (slowParallel) return replaySlowCapture(signal, onProgress);
    if (parallelFrames > 0) {
      const report = (capturedFrames: number, phase?: string) =>
        onProgress?.({
          totalFrames: parallelFrames,
          capturedFrames,
          activeWorkers: 2,
          workerProgress: new Map(),
          latestWorkerPhase: phase && {
            workerId: 0,
            phase,
            browserExecutable: "chrome",
            browserVersion: "Chrome/152.0.7977.30",
            canvasDrawElement: true,
            gpuBackend: "swiftshader",
          },
        });
      report(0, "browser_launch");
      report(0, "frame_capture");
      let now = Date.now();
      for (let frame = 1; frame <= parallelFrames; frame++) {
        now += parallelFrameMs;
        setSystemTime(now);
        report(frame);
      }
      setSystemTime();
    }
    return [];
  },
  getCapturePerfSummary: () => ({}),
  getFfmpegBinary: () => "ffmpeg",
  initializeSession: async (session: { isInitialized: boolean }) => {
    if (failInitializeSession) {
      throw new Error(initializeSessionErrorMessage);
    }
    session.isInitialized = true;
  },
  getEncoderPreset: () => ({
    preset: "ultrafast",
    quality: 28,
    codec: "h264",
    pixelFormat: "yuv420p",
  }),
  initTransparentBackground: async () => {},
  prepareCaptureSessionForReuse: () => {
    if (failPrepareCaptureSessionForReuse) {
      throw new Error("prepare reuse failed: ENOSPC");
    }
  },
  recaptureDrawElementFrameForVerify: async () => Buffer.from("frame"),
  spawnStreamingEncoder,
  writeCapturedFrame: async () => {},
}));

mock.module("@hyperframes/core", () => ({
  CANVAS_DIMENSIONS: {},
  checkOutputResolutionCompatibility: () => ({ ok: true }),
  fpsToNumber: () => 30,
  redactTelemetryString: (value: string) => value,
}));

mock.module("../../renderOrchestrator.js", () => ({
  closeHdrVideoFrameSource: () => {},
  createHdrPerfCollector: () => ({}),
  executeDiskCaptureWithAdaptiveRetry: async () => [],
  explainStreamingEncodeGate: () => ({ enabled: true, reason: "single_worker" }),
  findMissingFrameRanges: () => [],
  isTransientCaptureRetryEligible: () => false,
  sampleDirectoryBytes: () => 0,
  resolveCompositeTransfer: () => "srgb",
}));

mock.module("../../hdrCompositor.js", () => ({
  closeHdrVideoFrameSource: () => {},
  resolveCompositeTransfer: () => "srgb",
}));

mock.module("./captureHdrResources.js", () => ({
  cleanupHdrVideoFrameSource: () => {},
  decodeHdrImageBuffers: () => new Map(),
  extractHdrVideoFrames: async () => ({
    sources: new Map(),
    estimatedBytes: 0,
    releaseReservation: () => {},
  }),
  planHdrResources: () => ({
    hdrVideoStartTimes: new Map(),
    nativeHdrVideos: [],
    nativeHdrImages: [],
  }),
  probeHdrExtractionDims: async () => {},
}));

mock.module("./captureHdrFrameShared.js", () => ({
  ensureFrameWritten: () => {},
  partitionTransitionFrames: () => new Set(),
  shouldUseHybridLayeredPath: () => false,
}));

mock.module("./captureHdrSequentialLoop.js", () => ({
  runSequentialLayeredFrameLoop: async () => {},
}));

mock.module("./captureHdrHybridLoop.js", () => ({
  runHybridLayeredFrameLoop: async () => {},
}));

function createInput(cfg: MinimalEngineConfig) {
  return {
    fileServer: {
      url: "http://127.0.0.1:4173",
      port: 4173,
      close: () => {},
      addPreHeadScript: () => {},
    },
    workDir: "/tmp/hf-test-work",
    framesDir: framesDir,
    videoOnlyPath: "/tmp/hf-test-video-only.mp4",
    job: {
      id: "streaming-config-test",
      config: { fps: { num: 30, den: 1 }, quality: "draft" },
      status: "queued",
      progress: 0,
      currentStage: "Streaming",
      createdAt: new Date(0),
      duration: 1,
    },
    totalFrames: 0,
    cfg,
    plan: createCapturePlan({
      workerCount: 1,
      forceScreenshot: false,
      useStreamingEncode: true,
      useLayeredComposite: false,
      usePageSideCompositing: false,
      hasHdrContent: false,
      needsAlpha: false,
    }),
    log: {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    },
    probeSession: null,
    outputFormat: "mp4",
    streamingEncoderOptions: { fps: { num: 30, den: 1 }, width: 1920, height: 1080 },
    buildCaptureOptions: () => ({}),
    createRenderVideoFrameInjector: () => null,
    abortSignal: undefined,
    assertNotAborted: () => {},
    dedupPerfs: [],
  };
}

describe("runCaptureStreamingStage", () => {
  it("passes the resolved engine config to spawnStreamingEncoder", async () => {
    failCaptureFrameToBuffer = false;
    failInitializeSession = false;
    const { runCaptureStreamingStage } = await import("./captureStreamingStage.js");
    const cfg = { forceScreenshot: false, ffmpegStreamingTimeout: 3_600_000 };
    const input = createInput(cfg);

    const result = await runCaptureStreamingStage(input);

    expect(result.success).toBe(true);
    expect(spawnStreamingEncoder.mock.calls[0]?.[3]).toBe(cfg);
  });

  it("wraps sequential capture failures with the browser console buffer", async () => {
    failCaptureFrameToBuffer = true;
    failInitializeSession = false;
    const { runCaptureStreamingStage } = await import("./captureStreamingStage.js");
    const cfg = { forceScreenshot: false, ffmpegStreamingTimeout: 3_600_000 };
    const input = { ...createInput(cfg), totalFrames: 1 };

    let caught: unknown;
    try {
      await runCaptureStreamingStage(input);
    } catch (error) {
      caught = error;
    } finally {
      failCaptureFrameToBuffer = false;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("captureFrameToBuffer failed");
    expect(getCaptureStageBrowserConsole(caught)).toEqual(browserConsoleBuffer);
    expect(closeCaptureSession).toHaveBeenCalled();
  });

  it("trips the stall watchdog and rethrows a non-cancellation error when the parallel path makes no frame progress", async () => {
    hangParallelUntilAbort = true;
    const prev = process.env.HF_DE_STALL_MS;
    process.env.HF_DE_STALL_MS = "50";
    const { runCaptureStreamingStage } = await import("./captureStreamingStage.js");
    const cfg = { forceScreenshot: false, ffmpegStreamingTimeout: 3_600_000 };
    const baseInput = createInput(cfg);
    const input = {
      ...baseInput,
      totalFrames: 100,
      plan: { ...baseInput.plan, workerCount: 2, forceParallelStream: true },
      parallelCaptureLabel: "screenshot",
    };

    let caught: unknown;
    try {
      await runCaptureStreamingStage(input);
    } catch (error) {
      caught = error;
    } finally {
      hangParallelUntilAbort = false;
      if (prev === undefined) delete process.env.HF_DE_STALL_MS;
      else process.env.HF_DE_STALL_MS = prev;
    }

    expect(caught).toBeInstanceOf(Error);
    // A stalled render must surface as a stall (→ pinned fallback), never as
    // the raw "[Parallel] Capture failed" or a cancellation. Typed, so the
    // orchestrator's retry gate recognises it on any routing.
    expect((caught as Error).name).toBe("ParallelCaptureStallError");
    expect((caught as Error).message).toContain("stalled");
    // The label is the caller's capture mode, not a hard-coded "drawElement":
    // screenshot-cohort stalls were being triaged as drawElement bugs.
    expect((caught as Error).message).toContain("Parallel screenshot capture stalled");
    expect((caught as Error).message).not.toContain("drawElement");
    expect((caught as Error).message).toContain("phase=frame_capture");
    expect((caught as Error).message).toContain("Chrome/152.0.7977.30");
    // Parent signal never fired, so the orchestrator won't read this as a cancel.
    expect(input.abortSignal).toBeUndefined();
  });

  describe("a parallel BeginFrame stall", () => {
    const run = async (afterFrames: number, everyAttempt = false) => {
      stallParallelAfterFrames = afterFrames;
      stallEveryParallelAttempt = everyAttempt;
      parallelAttempts = 0;
      distributeCalls.length = 0;
      reorderStarts.length = 0;
      writeFrame.mockClear();
      const prev = process.env.HF_DE_STALL_MS;
      process.env.HF_DE_STALL_MS = "50";
      const { runCaptureStreamingStage } = await import("./captureStreamingStage.js");
      const baseInput = createInput({ forceScreenshot: false, ffmpegStreamingTimeout: 3_600_000 });
      const input = {
        ...baseInput,
        totalFrames: 10,
        plan: { ...baseInput.plan, workerCount: 2, forceParallelStream: true },
        parallelCaptureLabel: "BeginFrame",
      };
      try {
        return await runCaptureStreamingStage(input).then(
          (result) => ({ result, caught: undefined as unknown }),
          (caught: unknown) => ({ result: undefined, caught }),
        );
      } finally {
        stallParallelAfterFrames = null;
        stallEveryParallelAttempt = false;
        if (prev === undefined) delete process.env.HF_DE_STALL_MS;
        else process.env.HF_DE_STALL_MS = prev;
      }
    };
    const written = () => writeFrame.mock.calls.map(([buffer]) => buffer.toString());

    it("resumes from the first unwritten frame, writing every frame once and in order", async () => {
      const { result, caught } = await run(4);
      expect(caught).toBeUndefined();
      expect(result?.success).toBe(true);
      expect(written()).toEqual(Array.from({ length: 10 }, (_, i) => `f${i}`));
      expect(distributeCalls).toEqual([
        { frames: 10, rangeStart: 0 },
        { frames: 6, rangeStart: 4 },
      ]);
      expect(reorderStarts.slice(-2)).toEqual([0, 4]);
    });

    it("falls back to the typed stall when the resumed workers stall again", async () => {
      const { caught } = await run(4, true);
      expect((caught as Error).name).toBe("ParallelCaptureStallError");
      expect((caught as Error).message).toContain("last frame 8/10");
      expect(distributeCalls).toHaveLength(2);
    });

    it("does not resume a stall that wrote nothing new", async () => {
      const { caught } = await run(0);
      expect((caught as Error).name).toBe("ParallelCaptureStallError");
      expect(distributeCalls).toHaveLength(1);
    });
  });

  it("does not arm the watchdog while every worker is still initialising", async () => {
    // Browsers launching and sub-composition timelines settling can take
    // longer than the stall window on a heavy composition. Counting that as
    // no-progress made the watchdog fail exactly the long renders it guards.
    hangParallelUntilAbort = true;
    hangParallelPhase = "session_init";
    const prev = process.env.HF_DE_STALL_MS;
    process.env.HF_DE_STALL_MS = "50";
    const controller = new AbortController();
    const { runCaptureStreamingStage } = await import("./captureStreamingStage.js");
    const cfg = { forceScreenshot: false, ffmpegStreamingTimeout: 3_600_000 };
    const baseInput = createInput(cfg);
    const input = {
      ...baseInput,
      totalFrames: 100,
      plan: { ...baseInput.plan, workerCount: 2, forceParallelStream: true },
      abortSignal: controller.signal,
    };

    let caught: unknown;
    const run = runCaptureStreamingStage(input).catch((error: unknown) => {
      caught = error;
    });
    // Five stall windows with no frame and no phase change past init.
    await new Promise((resolve) => setTimeout(resolve, 250));
    controller.abort();
    await run;

    hangParallelUntilAbort = false;
    hangParallelPhase = "frame_capture";
    if (prev === undefined) delete process.env.HF_DE_STALL_MS;
    else process.env.HF_DE_STALL_MS = prev;

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain("stalled");
  });

  async function streamParallelFrames(frames: number, frameMs: number): Promise<string[]> {
    parallelFrames = frames;
    parallelFrameMs = frameMs;
    const stages: string[] = [];
    const { runCaptureStreamingStage } = await import("./captureStreamingStage.js");
    const baseInput = createInput({ forceScreenshot: false, ffmpegStreamingTimeout: 3_600_000 });
    try {
      await runCaptureStreamingStage({
        ...baseInput,
        totalFrames: frames,
        plan: { ...baseInput.plan, workerCount: 2, forceParallelStream: true },
        onProgress: (_job: unknown, stage: string) => {
          stages.push(stage);
        },
      });
    } finally {
      parallelFrames = 0;
    }
    return stages;
  }

  it("reports browser warm-up and the first frame of a slow capture, then steadily", async () => {
    const stages = await streamParallelFrames(40, 400);
    expect(stages.slice(0, 3)).toEqual([
      "Starting browsers (0/2 ready)",
      "Streaming frame 1/40 (2 workers)",
      "Streaming frame 2/40 (2 workers)",
    ]);
    expect(stages).toHaveLength(42);
    expect(stages.at(-1)).toBe("Encoding frame 40/40");
  });

  async function runSlowParallel(total: number, maxRenderMs: number | undefined) {
    slowParallel = true;
    slowTotal = total;
    virtualNow = 0;
    const controller = new AbortController();
    const { runCaptureStreamingStage } = await import("./captureStreamingStage.js");
    const { startRenderEtaGuard } = await import("../renderEtaGuard.js");
    const baseInput = createInput({ forceScreenshot: false, ffmpegStreamingTimeout: 3_600_000 });
    const input = {
      ...baseInput,
      totalFrames: total,
      plan: { ...baseInput.plan, workerCount: 2, forceParallelStream: true },
      abortSignal: controller.signal,
    };
    let tooSlow: Error | undefined;
    const stop = startRenderEtaGuard({
      maxRenderMs,
      job: input.job,
      totalFrames: total,
      pipelineStartMs: 0,
      now: () => virtualNow,
      pollMs: 1,
      onTooSlow: (error) => {
        tooSlow = error;
        controller.abort(error);
      },
    });
    try {
      await runCaptureStreamingStage(input);
      return { tooSlow, completed: true };
    } catch {
      return { tooSlow, completed: false };
    } finally {
      stop();
      slowParallel = false;
    }
  }

  it("stops a crawling parallel capture through the ETA guard", async () => {
    const { tooSlow, completed } = await runSlowParallel(1_000, 120_000);
    expect(completed).toBe(false);
    expect(tooSlow?.message).toMatch(/^render too slow: stage capture/);
  });

  it("does not stop the same slow capture without maxRenderMs", async () => {
    const { tooSlow, completed } = await runSlowParallel(60, undefined);
    expect(tooSlow).toBeUndefined();
    expect(completed).toBe(true);
  });

  it("does not flood the callback when frames arrive faster than the report interval", async () => {
    const stages = await streamParallelFrames(300, 1);
    const frames = stages.filter((stage) => stage.startsWith("Streaming frame"));
    expect(frames.length).toBeLessThan(5);
    // Frame 1 lands 1 ms after the start-up report and is still reported.
    expect(frames[0]).toBe("Streaming frame 1/300 (2 workers)");
    expect(frames.at(-1)).toBe("Streaming frame 300/300 (2 workers)");
  });

  it("releases the writer with the dead worker's own error, not a stall", async () => {
    // A transient Chrome death in one interleaved worker. Before, peers parked
    // in the ordered writer until the watchdog relabelled it a stall a minute
    // later; the original transient error — the one the orchestrator knows how
    // to retry — was lost.
    failWorkerTransient = true;
    reorderAbortCalls.length = 0;
    const prev = process.env.HF_DE_STALL_MS;
    process.env.HF_DE_STALL_MS = "600000";
    const { runCaptureStreamingStage } = await import("./captureStreamingStage.js");
    const cfg = { forceScreenshot: false, ffmpegStreamingTimeout: 3_600_000 };
    const baseInput = createInput(cfg);
    const input = {
      ...baseInput,
      totalFrames: 100,
      plan: { ...baseInput.plan, workerCount: 2, forceParallelStream: true },
    };

    let caught: unknown;
    try {
      await runCaptureStreamingStage(input);
    } catch (error) {
      caught = error;
    } finally {
      failWorkerTransient = false;
      if (prev === undefined) delete process.env.HF_DE_STALL_MS;
      else process.env.HF_DE_STALL_MS = prev;
    }

    // The engine's own failure, not the pool's flattened "[Parallel] Capture failed: …"
    // string and not a stall, wrapped so the stage reports the page's console.
    expect(caught).toBeInstanceOf(CaptureStageError);
    expect((caught as CaptureStageError).cause).toBe(injectedWorkerFailure);
    expect((caught as CaptureStageError).kind).toBe("transient_browser");
    expect((caught as Error).message).not.toContain("stalled");
    // Parked peers were released with that same error.
    expect(reorderAbortCalls).toEqual([injectedWorkerFailure]);
  });

  it("reports the script's page errors when a worker dies in a streaming render", async () => {
    failWorkerTransient = true;
    workerFailurePageErrors = ["[Browser:PAGEERROR] ReferenceError: gsap is not defined"];
    const { runCaptureStreamingStage } = await import("./captureStreamingStage.js");
    const cfg = { forceScreenshot: false, ffmpegStreamingTimeout: 3_600_000 };
    const baseInput = createInput(cfg);
    const input = {
      ...baseInput,
      totalFrames: 100,
      plan: { ...baseInput.plan, workerCount: 2, forceParallelStream: true },
    };

    let caught: unknown;
    try {
      await runCaptureStreamingStage(input);
    } catch (error) {
      caught = error;
    } finally {
      failWorkerTransient = false;
      workerFailurePageErrors = [];
    }

    expect(caught).toBeInstanceOf(CaptureStageError);
    expect(getCaptureStageBrowserConsole(caught)).toContain(
      "[Browser:PAGEERROR] ReferenceError: gsap is not defined",
    );
  });

  it("does not relabel a genuine parent-abort as a stall", async () => {
    hangParallelUntilAbort = true;
    const prev = process.env.HF_DE_STALL_MS;
    // Huge window so the watchdog never trips; the parent abort is what ends it.
    process.env.HF_DE_STALL_MS = "600000";
    const controller = new AbortController();
    const { runCaptureStreamingStage } = await import("./captureStreamingStage.js");
    const cfg = { forceScreenshot: false, ffmpegStreamingTimeout: 3_600_000 };
    const baseInput = createInput(cfg);
    const input = {
      ...baseInput,
      totalFrames: 100,
      plan: { ...baseInput.plan, workerCount: 2, forceParallelStream: true },
      abortSignal: controller.signal,
    };

    let caught: unknown;
    const run = runCaptureStreamingStage(input).catch((error: unknown) => {
      caught = error;
    });
    controller.abort();
    await run;

    hangParallelUntilAbort = false;
    if (prev === undefined) delete process.env.HF_DE_STALL_MS;
    else process.env.HF_DE_STALL_MS = prev;

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain("stalled");
  });

  it.each([
    ["in batches", false],
    ["one frame at a time when the session injects video frames", true],
  ])(
    "captures risk frames in a screenshot session and every other frame with drawElement, in order, %s",
    async (_name, withBeforeCapture) => {
      sessionWorkerEncodeEnabled = true;
      sessionHasBeforeCapture = withBeforeCapture;
      sessionRiskFrames = new Set([2, 3, 25]);
      batchesRequested = [];
      writeFrame.mockClear();
      closeCaptureSession.mockClear();
      const { runCaptureStreamingStage } = await import("./captureStreamingStage.js");
      const cfg = { forceScreenshot: false, ffmpegStreamingTimeout: 3_600_000 };
      try {
        await runCaptureStreamingStage({ ...createInput(cfg), totalFrames: 30, workerCount: 1 });
      } finally {
        sessionWorkerEncodeEnabled = false;
        sessionHasBeforeCapture = false;
        sessionRiskFrames = undefined;
      }
      const written = writeFrame.mock.calls.map(([buffer]) => buffer.toString().split(":")[0]);
      expect(written).toEqual(
        Array.from({ length: 30 }, (_, i) =>
          [2, 3, 25].includes(i) ? `screenshot${i}` : `de${i}`,
        ),
      );
      // drawElement was never asked for a risk frame
      expect(batchesRequested?.flat().filter((f) => [2, 3, 25].includes(f))).toEqual([]);
      // the drawElement session and the screenshot session both closed
      expect(closeCaptureSession).toHaveBeenCalledTimes(2);
      batchesRequested = null;
    },
  );

  it("trips the stall watchdog on the single-worker worker-encode pipeline when capture makes no progress", async () => {
    hangSequentialUntilStall = true;
    sessionWorkerEncodeEnabled = true;
    const prev = process.env.HF_DE_STALL_MS;
    process.env.HF_DE_STALL_MS = "50";
    const { runCaptureStreamingStage } = await import("./captureStreamingStage.js");
    const cfg = { forceScreenshot: false, ffmpegStreamingTimeout: 3_600_000 };
    const input = { ...createInput(cfg), totalFrames: 10, workerCount: 1 };

    let caught: unknown;
    try {
      await runCaptureStreamingStage(input);
    } catch (error) {
      caught = error;
    } finally {
      hangSequentialUntilStall = false;
      sessionWorkerEncodeEnabled = false;
      if (prev === undefined) delete process.env.HF_DE_STALL_MS;
      else process.env.HF_DE_STALL_MS = prev;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("stalled");
  });

  describe("a BeginFrame capture that never draws its first frame", () => {
    const sequential = async (mode: "beginframe" | "screenshot", stallMs: string) => {
      hangSequentialUntilStall = true;
      captureSessionMode = mode;
      const prev = process.env.HF_DE_STALL_MS;
      process.env.HF_DE_STALL_MS = stallMs;
      const { runCaptureStreamingStage } = await import("./captureStreamingStage.js");
      const cfg = {
        forceScreenshot: false,
        ffmpegStreamingTimeout: 3_600_000,
        beginFrameFirstFrameDeadlineMs: 50,
      };
      try {
        return await runCaptureStreamingStage({ ...createInput(cfg), totalFrames: 10 }).catch(
          (error: unknown) => error,
        );
      } finally {
        hangSequentialUntilStall = false;
        captureSessionMode = "drawelement";
        if (prev === undefined) delete process.env.HF_DE_STALL_MS;
        else process.env.HF_DE_STALL_MS = prev;
      }
    };

    it("gives up on frame 0 at the first-frame deadline, not the ten-minute stall budget", async () => {
      const caught = await sequential("beginframe", "600000");
      expect((caught as Error).message).toContain(
        "BeginFrame capture stalled: no frame progress for 50ms",
      );
    });

    it("leaves a screenshot capture on the stall budget", async () => {
      const caught = await sequential("screenshot", "200");
      expect((caught as Error).message).toContain("no frame progress for 200ms");
    });

    it("gives up on a parallel BeginFrame capture at the first-frame deadline", async () => {
      hangParallelUntilAbort = true;
      const prev = process.env.HF_DE_STALL_MS;
      process.env.HF_DE_STALL_MS = "600000";
      const { runCaptureStreamingStage } = await import("./captureStreamingStage.js");
      const baseInput = createInput({
        forceScreenshot: false,
        ffmpegStreamingTimeout: 3_600_000,
        beginFrameFirstFrameDeadlineMs: 50,
      });
      try {
        const caught = await runCaptureStreamingStage({
          ...baseInput,
          totalFrames: 100,
          plan: { ...baseInput.plan, workerCount: 2, forceParallelStream: true },
          parallelCaptureLabel: "BeginFrame",
        }).catch((error: unknown) => error);
        expect((caught as Error).name).toBe("ParallelCaptureStallError");
        expect((caught as Error).message).toContain("50ms");
      } finally {
        hangParallelUntilAbort = false;
        if (prev === undefined) delete process.env.HF_DE_STALL_MS;
        else process.env.HF_DE_STALL_MS = prev;
      }
    });
  });

  it("trips the stall watchdog on the single-worker plain capture loop when capture makes no progress", async () => {
    hangSequentialUntilStall = true;
    const prev = process.env.HF_DE_STALL_MS;
    process.env.HF_DE_STALL_MS = "50";
    const { runCaptureStreamingStage } = await import("./captureStreamingStage.js");
    const cfg = { forceScreenshot: false, ffmpegStreamingTimeout: 3_600_000 };
    const input = { ...createInput(cfg), totalFrames: 10, workerCount: 1 };

    let caught: unknown;
    try {
      await runCaptureStreamingStage(input);
    } catch (error) {
      caught = error;
    } finally {
      hangSequentialUntilStall = false;
      if (prev === undefined) delete process.env.HF_DE_STALL_MS;
      else process.env.HF_DE_STALL_MS = prev;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("stalled");
  });

  it("reports the actual screenshot mode and closes a wedged low-memory session", async () => {
    hangSequentialUntilStall = true;
    captureSessionMode = "screenshot";
    closeCaptureSession.mockClear();
    const prev = process.env.HF_DE_STALL_MS;
    process.env.HF_DE_STALL_MS = "50";
    const { runCaptureStreamingStage } = await import("./captureStreamingStage.js");
    const cfg = {
      forceScreenshot: true,
      ffmpegStreamingTimeout: 3_600_000,
      lowMemoryMode: true,
    };
    const baseInput = createInput(cfg);
    const input = {
      ...baseInput,
      totalFrames: 10,
      plan: { ...baseInput.plan, forceScreenshot: true },
    };

    let caught: unknown;
    try {
      await runCaptureStreamingStage(input);
    } catch (error) {
      caught = error;
    } finally {
      hangSequentialUntilStall = false;
      captureSessionMode = "drawelement";
      if (prev === undefined) delete process.env.HF_DE_STALL_MS;
      else process.env.HF_DE_STALL_MS = prev;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error & { cause?: Error }).cause?.name).toBe("SequentialCaptureStallError");
    expect((caught as Error).message).toContain("Sequential screenshot capture stalled");
    expect((caught as Error).message).toContain("(stuck at frame 0/10 while capturing the frame)");
    expect((caught as Error).message).not.toContain("drawElement");
    expect(closeCaptureSession).toHaveBeenCalledTimes(1);
  });

  it("still honors the pre-rename HF_DE_PARALLEL_STALL_MS env var for one release", async () => {
    hangSequentialUntilStall = true;
    const prevNew = process.env.HF_DE_STALL_MS;
    const prevOld = process.env.HF_DE_PARALLEL_STALL_MS;
    delete process.env.HF_DE_STALL_MS;
    process.env.HF_DE_PARALLEL_STALL_MS = "50";
    const { runCaptureStreamingStage } = await import("./captureStreamingStage.js");
    const cfg = { forceScreenshot: false, ffmpegStreamingTimeout: 3_600_000 };
    const input = { ...createInput(cfg), totalFrames: 10, workerCount: 1 };

    let caught: unknown;
    try {
      await runCaptureStreamingStage(input);
    } catch (error) {
      caught = error;
    } finally {
      hangSequentialUntilStall = false;
      if (prevNew === undefined) delete process.env.HF_DE_STALL_MS;
      else process.env.HF_DE_STALL_MS = prevNew;
      if (prevOld === undefined) delete process.env.HF_DE_PARALLEL_STALL_MS;
      else process.env.HF_DE_PARALLEL_STALL_MS = prevOld;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("stalled");
  });

  it("does not relabel a genuine parent-abort as a stall on the sequential path", async () => {
    hangSequentialUntilStall = true;
    const prev = process.env.HF_DE_STALL_MS;
    process.env.HF_DE_STALL_MS = "50";
    const controller = new AbortController();
    controller.abort();
    const { runCaptureStreamingStage } = await import("./captureStreamingStage.js");
    const cfg = { forceScreenshot: false, ffmpegStreamingTimeout: 3_600_000 };
    const input = {
      ...createInput(cfg),
      totalFrames: 10,
      workerCount: 1,
      abortSignal: controller.signal,
    };

    let caught: unknown;
    try {
      await runCaptureStreamingStage(input);
    } catch (error) {
      caught = error;
    } finally {
      hangSequentialUntilStall = false;
      if (prev === undefined) delete process.env.HF_DE_STALL_MS;
      else process.env.HF_DE_STALL_MS = prev;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain("stalled");
    expect((caught as Error).message).toContain("aborted");
  });
});

describe("runCaptureStage", () => {
  it("closes a reused probe session when reuse preparation fails", async () => {
    failCaptureFrameToBuffer = false;
    failInitializeSession = false;
    failPrepareCaptureSessionForReuse = true;
    closeCaptureSession.mockClear();
    const { createCaptureSession } = await import("@hyperframes/engine");
    const { runCaptureStage } = await import("./captureStage.js");
    const cfg = { forceScreenshot: false, ffmpegStreamingTimeout: 3_600_000 };
    const probeSession = await createCaptureSession(
      "http://127.0.0.1:4173",
      framesDir,
      {},
      null,
      cfg,
    );

    let caught: unknown;
    try {
      await runCaptureStage({
        ...createInput(cfg),
        plan: createCapturePlan({
          workerCount: 1,
          forceScreenshot: false,
          useStreamingEncode: false,
          useLayeredComposite: false,
          usePageSideCompositing: false,
          hasHdrContent: false,
          needsAlpha: false,
        }),
        probeSession,
        videoOnlyPath: undefined,
        outputFormat: undefined,
        streamingEncoderOptions: undefined,
        captureAttempts: [],
      });
    } catch (error) {
      caught = error;
    } finally {
      failPrepareCaptureSessionForReuse = false;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("prepare reuse failed: ENOSPC");
    expect(closeCaptureSession).toHaveBeenCalledTimes(1);
    expect(closeCaptureSession).toHaveBeenCalledWith(probeSession);
  });

  it("wraps sequential capture failures with the browser console buffer", async () => {
    failCaptureFrameToBuffer = false;
    failInitializeSession = true;
    initializeSessionErrorMessage = "Navigation timeout of 60000 ms exceeded";
    const { runCaptureStage } = await import("./captureStage.js");
    const cfg = { forceScreenshot: false, ffmpegStreamingTimeout: 3_600_000 };

    let caught: unknown;
    try {
      await runCaptureStage({
        ...createInput(cfg),
        plan: createCapturePlan({
          workerCount: 1,
          forceScreenshot: false,
          useStreamingEncode: false,
          useLayeredComposite: false,
          usePageSideCompositing: false,
          hasHdrContent: false,
          needsAlpha: false,
        }),
        videoOnlyPath: undefined,
        outputFormat: undefined,
        streamingEncoderOptions: undefined,
        captureAttempts: [],
      });
    } catch (error) {
      caught = error;
    } finally {
      failInitializeSession = false;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("Navigation timeout of 60000 ms exceeded");
    expect(getCaptureStageBrowserConsole(caught)).toEqual(browserConsoleBuffer);
    expect(closeCaptureSession).toHaveBeenCalled();
  });
});

describe("runCaptureHdrStage", () => {
  function createHdrInput(useGpu: boolean | undefined): CaptureHdrStageInput {
    const plan = createCapturePlan({
      workerCount: 1,
      forceScreenshot: true,
      useStreamingEncode: false,
      useLayeredComposite: true,
      usePageSideCompositing: false,
      hasHdrContent: true,
      needsAlpha: false,
    });
    if (plan.kind !== "hdr_layered") throw new Error("Expected an HDR layered capture plan");
    return {
      job: {
        id: "capture-hdr-stage-test",
        config: { fps: { num: 30, den: 1 }, quality: "draft", useGpu },
        status: "queued",
        progress: 0,
        currentStage: "HDR Capture",
        createdAt: new Date(0),
        duration: 1,
      },
      cfg: { forceScreenshot: true },
      plan,
      log: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
      projectDir: fixtureRoot,
      compiledDir: fixtureRoot,
      framesDir,
      videoOnlyPath: join(fixtureRoot, "video-only.mp4"),
      width: 64,
      height: 64,
      totalFrames: 1,
      composition: { duration: 1, videos: [], audios: [], images: [], width: 64, height: 64 },
      hasHdrContent: true,
      effectiveHdr: { transfer: "pq" },
      nativeHdrVideoIds: new Set<string>(),
      nativeHdrImageIds: new Set<string>(),
      videoTransfers: new Map(),
      imageTransfers: new Map(),
      hdrImageSrcPaths: new Map(),
      preset: {
        preset: "ultrafast",
        quality: 28,
        codec: "h265",
        pixelFormat: "yuv420p10le",
        hdr: { transfer: "pq" },
      },
      effectiveQuality: 28,
      effectiveBitrate: undefined,
      fileServer: {
        url: "http://127.0.0.1:4173",
        port: 4173,
        close: () => {},
        addPreHeadScript: () => {},
      },
      buildCaptureOptions: () => ({}),
      createRenderVideoFrameInjector: () => null,
      hdrDiagnostics: { videoExtractionFailures: 0, imageDecodeFailures: 0 },
      abortSignal: undefined,
      assertNotAborted: () => {},
    };
  }

  it.each([true, false, undefined])("forwards useGpu=%s to the HDR encoder", async (useGpu) => {
    failCaptureFrameToBuffer = false;
    failInitializeSession = false;
    spawnStreamingEncoder.mockClear();
    closeEncoder.mockClear();
    const { runCaptureHdrStage } = await import("./captureHdrStage.js");
    const input = createHdrInput(useGpu);

    const result = await runCaptureHdrStage(input);

    expect(spawnStreamingEncoder).toHaveBeenCalledTimes(1);
    expect(spawnStreamingEncoder).toHaveBeenCalledWith(
      input.videoOnlyPath,
      expect.objectContaining({
        useGpu,
        codec: "h265",
        hdr: { transfer: "pq" },
        rawInputFormat: "rgb48le",
      }),
      undefined,
      { ffmpegStreamingTimeout: 3_600_000 },
    );
    expect(closeEncoder).toHaveBeenCalledTimes(1);
    expect(result.encodeMs).toBe(123);
  });

  it("wraps HDR capture failures with the browser console buffer", async () => {
    failCaptureFrameToBuffer = false;
    failInitializeSession = true;
    initializeSessionErrorMessage = "HDR initialize failed";
    const { runCaptureHdrStage } = await import("./captureHdrStage.js");

    let caught: unknown;
    try {
      await runCaptureHdrStage({
        job: {
          id: "capture-hdr-stage-test",
          config: { fps: { num: 30, den: 1 }, quality: "draft" },
          status: "queued",
          progress: 0,
          currentStage: "HDR Capture",
          createdAt: new Date(0),
          duration: 1,
        },
        cfg: { forceScreenshot: true },
        plan: createCapturePlan({
          workerCount: 1,
          forceScreenshot: true,
          useStreamingEncode: false,
          useLayeredComposite: true,
          usePageSideCompositing: false,
          hasHdrContent: false,
          needsAlpha: false,
        }),
        log: {
          error: () => {},
          warn: () => {},
          info: () => {},
          debug: () => {},
        },
        projectDir: "/tmp/hf-test-project",
        compiledDir: "/tmp/hf-test-compiled",
        framesDir: framesDir,
        videoOnlyPath: "/tmp/hf-test-video-only.mp4",
        width: 1920,
        height: 1080,
        totalFrames: 1,
        composition: {
          duration: 1,
          videos: [],
          audios: [],
          images: [],
          width: 1920,
          height: 1080,
        },
        hasHdrContent: false,
        effectiveHdr: undefined,
        nativeHdrVideoIds: new Set<string>(),
        nativeHdrImageIds: new Set<string>(),
        videoTransfers: new Map(),
        imageTransfers: new Map(),
        hdrImageSrcPaths: new Map(),
        preset: {
          preset: "ultrafast",
          quality: 28,
          codec: "h264" as const,
          pixelFormat: "yuv420p",
        },
        effectiveQuality: 28,
        effectiveBitrate: undefined,
        fileServer: {
          url: "http://127.0.0.1:4173",
          port: 4173,
          close: () => {},
          addPreHeadScript: () => {},
        },
        buildCaptureOptions: () => ({}),
        createRenderVideoFrameInjector: () => null,
        hdrDiagnostics: {
          videoExtractionFailures: 0,
          imageDecodeFailures: 0,
        },
        abortSignal: undefined,
        assertNotAborted: () => {},
      });
    } catch (error) {
      caught = error;
    } finally {
      failInitializeSession = false;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("HDR initialize failed");
    expect(getCaptureStageBrowserConsole(caught)).toEqual(browserConsoleBuffer);
    expect(closeCaptureSession).toHaveBeenCalled();
  });
});

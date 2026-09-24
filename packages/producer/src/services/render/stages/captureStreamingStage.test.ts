// fallow-ignore-file code-duplication
import { afterAll, describe, expect, it, mock, setSystemTime } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixtureRoot = mkdtempSync(join(tmpdir(), "hf-stage-test-"));
const framesDir = join(fixtureRoot, "frames");
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));
import { getCaptureStageBrowserConsole } from "../captureStageError.js";
import { createCapturePlan } from "../capturePlan.js";

type MinimalEngineConfig = {
  forceScreenshot: boolean;
  ffmpegStreamingTimeout: number;
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
// Which phase the wedged worker reports. frame_capture = past init, wedged in
// a capture call (the watchdog's job); session_init = still booting (not).
let hangParallelPhase: "session_init" | "frame_capture" = "frame_capture";
let failWorkerTransient = false;
// Parallel capture that reports this many frames, advancing the clock by parallelFrameMs each.
let parallelFrames = 0;
let parallelFrameMs = 0;
let injectedWorkerFailure: Error | null = null;
const reorderAbortCalls: unknown[] = [];
let hangSequentialUntilStall = false;
let sessionWorkerEncodeEnabled = false;
let captureSessionMode: "drawelement" | "screenshot" = "drawelement";
let failPrepareCaptureSessionForReuse = false;
let initializeSessionErrorMessage = "initialize failed";
const browserConsoleBuffer = ["[FrameCapture:ERROR] page.goto failed"];
const closeCaptureSession = mock(async () => {});
class DrawElementVerificationError extends Error {}

mock.module("@hyperframes/engine", () => ({
  calculateOptimalWorkers: () => 1,
  convertTransfer: () => {},
  captureFrame: async () => {},
  captureFrameToBufferPipelined: async () => {
    if (hangSequentialUntilStall) {
      return new Promise(() => {});
    }
    return { encodeResult: Promise.resolve(Buffer.from("frame")) };
  },
  captureFramesBatchPipelined: async () => {
    if (hangSequentialUntilStall) {
      return new Promise(() => {});
    }
    return [];
  },
  captureFrameToBuffer: async () => {
    if (failCaptureFrameToBuffer) {
      throw new Error("captureFrameToBuffer failed");
    }
    if (hangSequentialUntilStall) {
      return new Promise(() => {});
    }
    return { buffer: Buffer.from("frame"), captureTimeMs: 1 };
  },
  closeCaptureSession,
  completeDeferredDrawElementInit: async () => {},
  createCaptureSession: async () => ({
    isInitialized: false,
    browserConsoleBuffer,
    options: { captureBeyondViewport: false },
    workerEncodeEnabled: sessionWorkerEncodeEnabled,
    captureMode: captureSessionMode,
  }),
  createFrameReorderBuffer: () => ({
    waitForFrame: async () => {},
    advanceTo: () => {},
    abort: (reason: unknown) => {
      reorderAbortCalls.push(reason);
    },
  }),
  distributeFrames: () => [],
  distributeFramesInterleaved: () => [],
  DrawElementVerificationError,
  executeParallelCapture: async (
    _url: string,
    _workDir: string,
    _tasks: unknown,
    _opts: unknown,
    _hook: unknown,
    signal?: AbortSignal,
    onProgress?: (progress: unknown) => void,
    _onFrameBuffer?: unknown,
    _config?: unknown,
    hooks?: { onWorkerFailure?: (failure: Error) => void },
  ) => {
    if (failWorkerTransient) {
      // One worker's Chrome died. The engine reports the ORIGINAL failure
      // through the hook, then the pool rejects with its flattened summary.
      // That ordering is the engine's contract, pinned without a browser by
      // parallelCoordinator.test.ts "createPoolFailureHandler"; this mock
      // only replays it.
      injectedWorkerFailure = Object.assign(
        new Error("Protocol error (Page.captureScreenshot): Target closed"),
        { kind: "transient_browser" },
      );
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
      // Simulate a wedged worker: make no frame progress, then reject with the
      // pool's generic string once aborted (by the parent or the watchdog).
      await new Promise<void>((_resolve, reject) => {
        const fail = () => reject(new Error("[Parallel] Capture failed: aborted"));
        if (signal?.aborted) return fail();
        signal?.addEventListener("abort", fail, { once: true });
      });
    }
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
    expect(stages).toHaveLength(41);
  });

  it("does not flood the callback when frames arrive faster than the report interval", async () => {
    const stages = await streamParallelFrames(300, 1);
    expect(stages.filter((stage) => stage.startsWith("Streaming frame")).length).toBeLessThan(5);
    expect(stages.at(-1)).toBe("Streaming frame 300/300 (2 workers)");
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

    // The exact failure object the engine reported — not the pool's flattened
    // "[Parallel] Capture failed: …" string, and not a stall.
    expect(caught).toBe(injectedWorkerFailure);
    expect((caught as Error).message).not.toContain("stalled");
    // Parked peers were released with that same error.
    expect(reorderAbortCalls).toEqual([injectedWorkerFailure]);
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

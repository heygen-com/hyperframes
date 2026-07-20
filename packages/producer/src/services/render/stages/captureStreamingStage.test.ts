import { describe, expect, it, mock } from "bun:test";
import { getCaptureStageBrowserConsole } from "../captureStageError.js";
import { createCapturePlan } from "../capturePlan.js";

type MinimalEngineConfig = {
  forceScreenshot: boolean;
  ffmpegStreamingTimeout: number;
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
let hangSequentialUntilStall = false;
let sessionWorkerEncodeEnabled = false;
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
  }),
  createFrameReorderBuffer: () => ({
    waitForFrame: async () => {},
    advanceTo: () => {},
    abort: () => {},
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
  ) => {
    if (hangParallelUntilAbort) {
      // Simulate a wedged worker: make no frame progress, then reject with the
      // pool's generic string once aborted (by the parent or the watchdog).
      await new Promise<void>((_resolve, reject) => {
        const fail = () => reject(new Error("[Parallel] Capture failed: aborted"));
        if (signal?.aborted) return fail();
        signal?.addEventListener("abort", fail, { once: true });
      });
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
  prepareCaptureSessionForReuse: () => {},
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
  resolveCompositeTransfer: () => "srgb",
}));

mock.module("../../hdrCompositor.js", () => ({
  closeHdrVideoFrameSource: () => {},
  resolveCompositeTransfer: () => "srgb",
}));

mock.module("./captureHdrResources.js", () => ({
  decodeHdrImageBuffers: () => new Map(),
  extractHdrVideoFrames: async () => new Map(),
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
    framesDir: "/tmp/hf-test-frames",
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
    // the raw "[Parallel] Capture failed" or a cancellation.
    expect((caught as Error).message).toContain("stalled");
    // Parent signal never fired, so the orchestrator won't read this as a cancel.
    expect(input.abortSignal).toBeUndefined();
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
        framesDir: "/tmp/hf-test-frames",
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

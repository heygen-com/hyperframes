import { describe, expect, it, mock } from "bun:test";
import { getCaptureStageBrowserConsole } from "../captureStageError.js";

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
}));
let failCaptureFrameToBuffer = false;
let failInitializeSession = false;
let initializeSessionErrorMessage = "initialize failed";
const browserConsoleBuffer = ["[FrameCapture:ERROR] page.goto failed"];
const closeCaptureSession = mock(async () => {});

mock.module("@hyperframes/engine", () => ({
  calculateOptimalWorkers: () => 1,
  convertTransfer: () => {},
  captureFrame: async () => {},
  captureFrameToBuffer: async () => {
    if (failCaptureFrameToBuffer) {
      throw new Error("captureFrameToBuffer failed");
    }
    return { buffer: Buffer.from("frame"), captureTimeMs: 1 };
  },
  closeCaptureSession,
  createCaptureSession: async () => ({ isInitialized: false, browserConsoleBuffer }),
  createFrameReorderBuffer: () => ({
    waitForFrame: async () => {},
    advanceTo: () => {},
  }),
  distributeFrames: () => [],
  executeParallelCapture: async () => {},
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
  spawnStreamingEncoder,
}));

mock.module("@hyperframes/core", () => ({
  CANVAS_DIMENSIONS: {},
  fpsToNumber: () => 30,
}));

mock.module("../../renderOrchestrator.js", () => ({
  closeHdrVideoFrameSource: () => {},
  createHdrPerfCollector: () => ({}),
  executeDiskCaptureWithAdaptiveRetry: async () => [],
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
    forceScreenshot: false,
    log: {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    },
    workerCount: 1,
    probeSession: null,
    outputFormat: "mp4",
    streamingEncoderOptions: { fps: { num: 30, den: 1 }, width: 1920, height: 1080 },
    buildCaptureOptions: () => ({}),
    createRenderVideoFrameInjector: () => null,
    abortSignal: undefined,
    assertNotAborted: () => {},
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
        videoOnlyPath: undefined,
        outputFormat: undefined,
        streamingEncoderOptions: undefined,
        needsAlpha: false,
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
        forceScreenshot: true,
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
        workerCount: 1,
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

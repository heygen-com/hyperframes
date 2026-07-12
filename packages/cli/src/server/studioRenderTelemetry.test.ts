import { describe, expect, it, vi, beforeEach } from "vitest";
import type { RenderJob, RenderPerfSummary } from "@hyperframes/producer";

// Mock `../telemetry/events.js` so we can capture trackRenderComplete /
// trackRenderError calls and verify the payload mapping without firing
// network requests.
const trackRenderComplete = vi.fn();
const trackRenderError = vi.fn();
vi.mock("../telemetry/events.js", () => ({
  trackRenderComplete: (...args: unknown[]) => trackRenderComplete(...args),
  trackRenderError: (...args: unknown[]) => trackRenderError(...args),
}));

// Imported after the mock is registered so the module picks up the mocked
// trackRenderComplete / trackRenderError.
const { emitStudioRenderComplete, emitStudioRenderError } =
  await import("./studioRenderTelemetry.js");

const opts = {
  fps: { num: 30, den: 1 } as const,
  quality: "standard",
};

const fullObservability: NonNullable<RenderPerfSummary["observability"]> = {
  renderJobId: "render-123",
  compositionHash: "abc123",
  eventCount: 8,
  lastEvent: {
    phase: "pipeline",
    status: "checkpoint",
    elapsedMs: 5000,
    message: "completed",
  },
  failedPhase: undefined,
  browserDiagnostics: {
    total: 4,
    errors: 1,
    pageErrors: 0,
    requestFailed: 1,
    httpErrors: 1,
    navigationStarts: 1,
    navigationFailures: 0,
    consoleErrors: 0,
    consoleWarnings: 1,
  },
  capture: {
    forceScreenshot: true,
    captureMode: "screenshot",
    workerCount: 1,
    useStreamingEncode: false,
    useLayeredComposite: true,
    usePageSideCompositing: false,
    hasHdrContent: true,
    browserGpuMode: "auto",
    protocolTimeoutMs: 300_000,
    pageNavigationTimeoutMs: 60_000,
    playerReadyTimeoutMs: 45_000,
  },
  extraction: {
    videoCount: 6,
    extractedVideoCount: 6,
    totalFramesExtracted: 167_400,
    maxFramesPerVideo: 27_900,
    avgFramesPerExtractedVideo: 27_900,
    vfrProbeMs: 120,
    vfrPreflightMs: 2400,
    vfrPreflightCount: 6,
    cacheHits: 0,
    cacheMisses: 6,
  },
  init: {
    initDurationMs: 1234,
    tweenCount: 42,
  },
  events: [],
};

const fullPerf: RenderPerfSummary = {
  renderId: "r-1",
  totalElapsedMs: 5000,
  fps: 30,
  quality: "standard",
  workers: 4,
  chunkedEncode: false,
  chunkSizeFrames: null,
  compositionDurationSeconds: 10,
  totalFrames: 300,
  resolution: { width: 1920, height: 1080 },
  videoCount: 1,
  audioCount: 0,
  stages: {
    compileMs: 100,
    videoExtractMs: 200,
    audioProcessMs: 50,
    captureMs: 4000,
    captureSetupMs: 750,
    captureFrameMs: 3250,
    encodeMs: 500,
    assembleMs: 150,
  },
  videoExtractBreakdown: {
    resolveMs: 10,
    hdrProbeMs: 20,
    hdrPreflightMs: 30,
    hdrPreflightCount: 1,
    vfrProbeMs: 40,
    vfrPreflightMs: 50,
    vfrPreflightCount: 2,
    extractMs: 60,
    cacheHits: 3,
    cacheMisses: 4,
    cachePublishFailures: 0,
    cacheGcEvictions: 0,
    cacheGcBytesFreed: 0,
    cacheAgedPartialsCleared: 0,
  },
  tmpPeakBytes: 1024,
  captureAvgMs: 13,
  capturePeakMs: 25,
  observability: fullObservability,
};

describe("studioRenderTelemetry", () => {
  beforeEach(() => {
    trackRenderComplete.mockClear();
    trackRenderError.mockClear();
  });

  describe("emitStudioRenderComplete", () => {
    it("tags the event with source: 'studio' and fps as a number", () => {
      emitStudioRenderComplete(opts, 5000, fullPerf);
      expect(trackRenderComplete).toHaveBeenCalledOnce();
      const payload = trackRenderComplete.mock.calls[0]![0];
      expect(payload.source).toBe("studio");
      expect(payload.fps).toBe(30);
      expect(payload.quality).toBe("standard");
      expect(payload.docker).toBe(false);
      expect(payload.gpu).toBe(false);
    });

    it("forwards the browser user's distinctId so the render funnel is joinable", () => {
      emitStudioRenderComplete({ ...opts, distinctId: "browser-user-123" }, 5000, fullPerf);
      expect(trackRenderComplete.mock.calls[0]![0].distinctId).toBe("browser-user-123");
    });

    it("leaves distinctId undefined for older clients that don't send one", () => {
      emitStudioRenderComplete(opts, 5000, fullPerf);
      expect(trackRenderComplete.mock.calls[0]![0].distinctId).toBeUndefined();
    });

    it("maps every RenderPerfSummary field to the expected payload key", () => {
      emitStudioRenderComplete(opts, 5000, fullPerf);
      const p = trackRenderComplete.mock.calls[0]![0];
      expect(p.durationMs).toBe(5000);
      expect(p.workers).toBe(4);
      expect(p.compositionDurationMs).toBe(10_000);
      expect(p.compositionWidth).toBe(1920);
      expect(p.compositionHeight).toBe(1080);
      expect(p.totalFrames).toBe(300);
      // speedRatio = compositionDurationMs / elapsedMs = 10000 / 5000 = 2
      expect(p.speedRatio).toBe(2);
      expect(p.captureAvgMs).toBe(13);
      expect(p.capturePeakMs).toBe(25);
      expect(p.tmpPeakBytes).toBe(1024);
      // stages
      expect(p.stageCompileMs).toBe(100);
      expect(p.stageVideoExtractMs).toBe(200);
      expect(p.stageAudioProcessMs).toBe(50);
      expect(p.stageCaptureMs).toBe(4000);
      expect(p.stageCaptureSetupMs).toBe(750);
      expect(p.stageCaptureFrameMs).toBe(3250);
      expect(p.stageEncodeMs).toBe(500);
      expect(p.stageAssembleMs).toBe(150);
      // video-extract breakdown
      expect(p.extractResolveMs).toBe(10);
      expect(p.extractHdrProbeMs).toBe(20);
      expect(p.extractHdrPreflightMs).toBe(30);
      expect(p.extractHdrPreflightCount).toBe(1);
      expect(p.extractVfrProbeMs).toBe(40);
      expect(p.extractVfrPreflightMs).toBe(50);
      expect(p.extractVfrPreflightCount).toBe(2);
      // `extractMs` on RenderPerfSummary maps to `extractPhase3Ms` on the event
      // (named for legacy reasons — see packages/cli/src/commands/render.ts).
      expect(p.extractPhase3Ms).toBe(60);
      expect(p.extractCacheHits).toBe(3);
      expect(p.extractCacheMisses).toBe(4);
      // observability aggregate
      expect(p.observabilityRenderJobId).toBe("render-123");
      expect(p.observabilityCompositionHash).toBe("abc123");
      expect(p.observabilityEventCount).toBe(8);
      expect(p.observabilityLastPhase).toBe("pipeline");
      expect(p.observabilityLastStatus).toBe("checkpoint");
      expect(p.browserDiagnosticCount).toBe(4);
      expect(p.browserDiagnosticErrors).toBe(1);
      expect(p.browserDiagnosticRequestFailed).toBe(1);
      expect(p.browserDiagnosticHttpErrors).toBe(1);
      expect(p.browserDiagnosticNavigationStarts).toBe(1);
      expect(p.browserDiagnosticConsoleWarnings).toBe(1);
      expect(p.captureMode).toBe("screenshot");
      expect(p.captureForceScreenshot).toBe(true);
      expect(p.captureWorkerCount).toBe(1);
      expect(p.captureUseLayeredComposite).toBe(true);
      expect(p.captureHasHdrContent).toBe(true);
      expect(p.capturePageNavigationTimeoutMs).toBe(60_000);
      expect(p.observabilityExtractVideoCount).toBe(6);
      expect(p.observabilityExtractedVideoCount).toBe(6);
      expect(p.observabilityExtractTotalFrames).toBe(167_400);
      expect(p.observabilityExtractMaxFramesPerVideo).toBe(27_900);
      expect(p.observabilityExtractAvgFramesPerVideo).toBe(27_900);
      expect(p.observabilityExtractVfrPreflightCount).toBe(6);
      expect(p.observabilityExtractCacheMisses).toBe(6);
      expect(p.observabilityInitDurationMs).toBe(1234);
      expect(p.observabilityInitTweenCount).toBe(42);
    });

    it("omits all perf-derived fields when perfSummary is undefined", () => {
      emitStudioRenderComplete(opts, 5000, undefined);
      const p = trackRenderComplete.mock.calls[0]![0];
      // Identity fields still present
      expect(p.source).toBe("studio");
      expect(p.fps).toBe(30);
      expect(p.durationMs).toBe(5000);
      // Perf-derived fields all undefined
      expect(p.workers).toBeUndefined();
      expect(p.compositionDurationMs).toBeUndefined();
      expect(p.totalFrames).toBeUndefined();
      expect(p.speedRatio).toBeUndefined();
      expect(p.stageCompileMs).toBeUndefined();
      expect(p.extractResolveMs).toBeUndefined();
    });

    it("omits videoExtractBreakdown fields when only the breakdown is absent", () => {
      const perfNoExtract: RenderPerfSummary = { ...fullPerf, videoExtractBreakdown: undefined };
      emitStudioRenderComplete(opts, 5000, perfNoExtract);
      const p = trackRenderComplete.mock.calls[0]![0];
      expect(p.workers).toBe(4);
      expect(p.extractResolveMs).toBeUndefined();
      expect(p.extractCacheHits).toBeUndefined();
    });

    it("leaves speedRatio undefined when elapsedMs is zero", () => {
      emitStudioRenderComplete(opts, 0, fullPerf);
      const p = trackRenderComplete.mock.calls[0]![0];
      expect(p.speedRatio).toBeUndefined();
    });
  });

  describe("emitStudioRenderError", () => {
    it("tags with source: 'studio' and forwards failedStage + elapsedMs", () => {
      emitStudioRenderError(opts, 1200, "encode", new Error("boom"), undefined);
      expect(trackRenderError).toHaveBeenCalledOnce();
      const p = trackRenderError.mock.calls[0]![0];
      expect(p.source).toBe("studio");
      expect(p.fps).toBe(30);
      expect(p.quality).toBe("standard");
      expect(p.docker).toBe(false);
      expect(p.failedStage).toBe("encode");
      expect(p.elapsedMs).toBe(1200);
      expect(p.errorMessage).toBe("boom");
    });

    it("stringifies non-Error throwables", () => {
      emitStudioRenderError(opts, 100, undefined, "string error", undefined);
      expect(trackRenderError.mock.calls[0]![0].errorMessage).toBe("string error");
    });

    it("does not include a workers field on the error event payload", () => {
      // Documented behavior: studio renders don't request a worker count,
      // and the early-failure path doesn't have perfSummary to read it from.
      emitStudioRenderError(opts, 100, undefined, new Error("x"), undefined);
      const p = trackRenderError.mock.calls[0]![0];
      expect(p.workers).toBeUndefined();
    });

    it("maps observability from a failed producer job", () => {
      const job: RenderJob = {
        id: "r-error",
        config: { fps: opts.fps, quality: "standard" },
        status: "failed",
        progress: 25,
        currentStage: "Starting frame capture",
        createdAt: new Date(),
        errorDetails: {
          message: "Navigation timeout of 60000 ms exceeded",
          elapsedMs: 60_001,
          freeMemoryMB: 1024,
          observability: {
            ...fullObservability,
            failedPhase: "capture_hdr_layered",
            lastEvent: {
              phase: "capture_hdr_layered",
              status: "error",
              elapsedMs: 60_001,
              durationMs: 60_000,
              message: "Navigation timeout of 60000 ms exceeded",
            },
          },
        },
      };

      emitStudioRenderError(opts, 60_001, "Starting frame capture", new Error("timeout"), job);

      const p = trackRenderError.mock.calls[0]![0];
      expect(p.observabilityFailedPhase).toBe("capture_hdr_layered");
      expect(p.observabilityLastPhase).toBe("capture_hdr_layered");
      expect(p.observabilityLastStatus).toBe("error");
      expect(p.browserDiagnosticCount).toBe(4);
      expect(p.captureMode).toBe("screenshot");
      expect(p.capturePageNavigationTimeoutMs).toBe(60_000);
      expect(p.observabilityExtractTotalFrames).toBe(167_400);
      expect(p.observabilityExtractVfrPreflightCount).toBe(6);
    });
  });
});

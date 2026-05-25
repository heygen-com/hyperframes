import { describe, expect, it, vi, beforeEach } from "vitest";
import type { RenderPerfSummary } from "@hyperframes/producer";

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
  },
  tmpPeakBytes: 1024,
  captureAvgMs: 13,
  capturePeakMs: 25,
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
      emitStudioRenderError(opts, 1200, "encode", new Error("boom"));
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
      emitStudioRenderError(opts, 100, undefined, "string error");
      expect(trackRenderError.mock.calls[0]![0].errorMessage).toBe("string error");
    });

    it("does not include a workers field on the error event payload", () => {
      // Documented behavior: studio renders don't request a worker count,
      // and the early-failure path doesn't have perfSummary to read it from.
      emitStudioRenderError(opts, 100, undefined, new Error("x"));
      const p = trackRenderError.mock.calls[0]![0];
      expect(p.workers).toBeUndefined();
    });
  });
});

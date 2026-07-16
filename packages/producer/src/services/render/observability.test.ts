import { describe, expect, it, vi } from "vitest";
import { CaptureStageError, getCaptureStageBrowserConsole } from "./captureStageError.js";
import {
  computeCompositionObservabilityHash,
  observeRenderStage,
  RenderObservabilityRecorder,
  sanitizeObservationMessage,
  summarizeBrowserDiagnostics,
} from "./observability.js";

function makeLog() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

function makeExtractionObservability() {
  return {
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
  };
}

describe("summarizeBrowserDiagnostics", () => {
  it("classifies navigation, page, request, HTTP, and console diagnostics", () => {
    const summary = summarizeBrowserDiagnostics([
      "[FrameCapture:NAV] page.goto start mode=screenshot timeoutMs=60000 url=http://127.0.0.1:4173/index.html",
      "[FrameCapture:ERROR] page.goto failed mode=screenshot timeoutMs=60000 elapsedMs=60001 url=http://127.0.0.1:4173/index.html error=Navigation timeout",
      "[Browser:PAGEERROR] ReferenceError: gsap is not defined",
      "[Browser:REQUESTFAILED] GET http://127.0.0.1:4173/video.mp4 resource=media error=net::ERR_FAILED",
      "[Browser:HTTP404] GET http://127.0.0.1:4173/missing.png resource=image",
      "[warn] parser-blocking script",
      "[error] failed to load resource",
    ]);

    expect(summary).toEqual({
      total: 7,
      errors: 0,
      pageErrors: 1,
      requestFailed: 1,
      httpErrors: 1,
      navigationStarts: 1,
      navigationFailures: 1,
      consoleErrors: 1,
      consoleWarnings: 1,
    });
  });

  it("keeps generic error counts exclusive from specific diagnostic buckets", () => {
    const summary = summarizeBrowserDiagnostics([
      "[Browser:PAGEERROR] ReferenceError: gsap is not defined",
      "[FrameCapture:ERROR] page.goto failed",
      "Unhandled ERROR outside browser diagnostic buckets",
    ]);

    expect(summary.errors).toBe(1);
    expect(summary.pageErrors).toBe(1);
    expect(summary.navigationFailures).toBe(1);
  });
});

describe("sanitizeObservationMessage", () => {
  it("redacts local paths and URL query strings before telemetry/log forwarding", () => {
    expect(
      sanitizeObservationMessage(
        "ENOENT: open '/home/ubuntu/project/media/video.mp4' https://example.com/video.mp4?X-Amz-Signature=secret",
      ),
    ).toBe("ENOENT: open '[path]' https://example.com/video.mp4?…");
  });

  it("computes a stable short hash for compiled composition correlation", () => {
    expect(computeCompositionObservabilityHash("<html><body>Hello</body></html>")).toBe(
      "03ee66f1452916b4",
    );
  });
});

describe("CaptureStageError", () => {
  it("preserves the original message and browser console diagnostics", () => {
    const cause = new Error("Navigation timeout of 60000 ms exceeded");
    const browserConsole = ["[FrameCapture:ERROR] page.goto failed"];
    const error = new CaptureStageError({ cause, browserConsole });

    browserConsole.push("mutated after wrap");

    expect(error.message).toBe("Navigation timeout of 60000 ms exceeded");
    expect(getCaptureStageBrowserConsole(error)).toEqual(["[FrameCapture:ERROR] page.goto failed"]);
    expect(getCaptureStageBrowserConsole(cause)).toEqual([]);
  });
});

describe("RenderObservabilityRecorder", () => {
  it("emits capped heartbeats while a stage is still running and stops after settlement", async () => {
    vi.useFakeTimers();
    const log = makeLog();
    const recorder = new RenderObservabilityRecorder({
      pipelineStartMs: Date.now(),
      log,
      renderJobId: "render-hang",
    });
    let resolveStage: (() => void) | undefined;
    let framesCompleted = 0;
    const stage = observeRenderStage(
      recorder,
      "capture_streaming",
      {
        workerCount: 1,
        captureMode: "screenshot",
        captureOperation: "captureScreenshot",
        totalFrames: 900,
        get framesCompleted() {
          return framesCompleted;
        },
      },
      () =>
        new Promise<void>((resolve) => {
          resolveStage = resolve;
        }),
    );

    framesCompleted = 12;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(log.info).toHaveBeenCalledWith(
      "[Render:trace]",
      expect.objectContaining({
        phase: "capture_streaming",
        status: "checkpoint",
        message: "stage still running",
        heartbeatIndex: 1,
        stageElapsedMs: 30_000,
        captureMode: "screenshot",
        captureOperation: "captureScreenshot",
        framesCompleted: 12,
        totalFrames: 900,
      }),
    );

    await vi.advanceTimersByTimeAsync(90_000);
    const heartbeatCalls = log.info.mock.calls.filter(
      ([message, meta]) => message === "[Render:trace]" && meta?.message === "stage still running",
    );
    expect(heartbeatCalls).toHaveLength(3);

    resolveStage?.();
    await stage;
    const endCall = log.info.mock.calls.find(
      // fallow-ignore-next-line complexity
      ([message, meta]) =>
        message === "[Render:trace]" &&
        meta?.phase === "capture_streaming" &&
        meta?.status === "end",
    );
    expect(endCall?.[1]).toEqual(
      expect.objectContaining({
        framesCompleted: 12,
        totalFrames: 900,
        captureMode: "screenshot",
        captureOperation: "captureScreenshot",
        workerCount: 1,
      }),
    );
    await vi.advanceTimersByTimeAsync(240_000);
    expect(
      log.info.mock.calls.filter(
        ([message, meta]) =>
          message === "[Render:trace]" && meta?.message === "stage still running",
      ),
    ).toHaveLength(3);
    vi.useRealTimers();
  });

  it("keeps emitting heartbeats every 120s once the initial ramp is exhausted", async () => {
    vi.useFakeTimers();
    const log = makeLog();
    const recorder = new RenderObservabilityRecorder({
      pipelineStartMs: Date.now(),
      log,
      renderJobId: "render-long-hang",
    });
    let resolveStage: (() => void) | undefined;
    const stage = observeRenderStage(
      recorder,
      "capture_streaming",
      { captureMode: "screenshot" },
      () =>
        new Promise<void>((resolve) => {
          resolveStage = resolve;
        }),
    );

    // Ramp: 30s, 60s, 120s → 3 heartbeats. Then steady 120s cadence: 240s, 360s.
    await vi.advanceTimersByTimeAsync(360_000);
    const heartbeatCalls = log.info.mock.calls.filter(
      ([message, meta]) => message === "[Render:trace]" && meta?.message === "stage still running",
    );
    expect(heartbeatCalls.map(([, meta]) => meta?.heartbeatIndex)).toEqual([1, 2, 3, 4, 5]);
    expect(heartbeatCalls.map(([, meta]) => meta?.stageElapsedMs)).toEqual([
      30_000, 60_000, 120_000, 240_000, 360_000,
    ]);

    resolveStage?.();
    await stage;
    vi.useRealTimers();
  });

  // Field signal ts=1784019503: a healthy ~64s browser calibration
  // pre-capture emitted heartbeats saying "stage still running /
  // framesCompleted: 0" and read as broken to downstream consumers. The
  // calibration call sites now pass `heartbeatMessage: "browser calibrating
  // (frames not started)"` so operator-facing logs and metrics can
  // distinguish healthy calibration waits from actual zero-frame stalls
  // once capture is meant to be underway.
  it("uses a custom heartbeat message during calibration stages", async () => {
    vi.useFakeTimers();
    const log = makeLog();
    const recorder = new RenderObservabilityRecorder({
      pipelineStartMs: Date.now(),
      log,
      renderJobId: "render-calibrating",
    });
    let resolveStage: (() => void) | undefined;
    const stage = observeRenderStage(
      recorder,
      "capture_calibration",
      { stagePhase: "calibrating", framesCompleted: 0, totalFrames: 900 },
      () =>
        new Promise<void>((resolve) => {
          resolveStage = resolve;
        }),
      { heartbeatMessage: "browser calibrating (frames not started)" },
    );

    await vi.advanceTimersByTimeAsync(30_000);
    const heartbeatCalls = log.info.mock.calls.filter(
      ([message, meta]) =>
        message === "[Render:trace]" &&
        meta?.phase === "capture_calibration" &&
        meta?.status === "checkpoint",
    );
    expect(heartbeatCalls).toHaveLength(1);
    expect(heartbeatCalls[0]?.[1]).toEqual(
      expect.objectContaining({
        message: "browser calibrating (frames not started)",
        stagePhase: "calibrating",
        framesCompleted: 0,
        heartbeatIndex: 1,
      }),
    );
    // No "stage still running" for this stage — the calibration override
    // must fully replace the default, not sit alongside it.
    expect(
      log.info.mock.calls.some(
        ([message, meta]) =>
          message === "[Render:trace]" && meta?.message === "stage still running",
      ),
    ).toBe(false);

    resolveStage?.();
    await stage;
    vi.useRealTimers();
  });

  it("keeps the default heartbeat message when no override is passed", async () => {
    vi.useFakeTimers();
    const log = makeLog();
    const recorder = new RenderObservabilityRecorder({
      pipelineStartMs: Date.now(),
      log,
      renderJobId: "render-default",
    });
    let resolveStage: (() => void) | undefined;
    const stage = observeRenderStage(
      recorder,
      "capture_streaming",
      { stagePhase: "capturing", framesCompleted: 42, totalFrames: 900 },
      () =>
        new Promise<void>((resolve) => {
          resolveStage = resolve;
        }),
    );

    await vi.advanceTimersByTimeAsync(30_000);
    const heartbeatCalls = log.info.mock.calls.filter(
      ([message, meta]) => message === "[Render:trace]" && meta?.message === "stage still running",
    );
    expect(heartbeatCalls).toHaveLength(1);
    expect(heartbeatCalls[0]?.[1]).toEqual(
      expect.objectContaining({
        stagePhase: "capturing",
        framesCompleted: 42,
      }),
    );
    resolveStage?.();
    await stage;
    vi.useRealTimers();
  });

  it("clears pending heartbeats when a stage rejects", async () => {
    vi.useFakeTimers();
    const log = makeLog();
    const recorder = new RenderObservabilityRecorder({
      pipelineStartMs: Date.now(),
      log,
      renderJobId: "render-error",
    });

    await expect(
      observeRenderStage(
        recorder,
        "capture_disk",
        {
          workerCount: 2,
          totalFrames: 42,
          framesCompleted: 7,
          captureMode: "screenshot",
          captureOperation: "captureScreenshot",
        },
        async () => {
          throw new Error("capture failed");
        },
      ),
    ).rejects.toThrow("capture failed");
    const errorCall = log.info.mock.calls.find(
      // fallow-ignore-next-line complexity
      ([message, meta]) =>
        message === "[Render:trace]" && meta?.phase === "capture_disk" && meta?.status === "error",
    );
    expect(errorCall?.[1]).toEqual(
      expect.objectContaining({
        framesCompleted: 7,
        totalFrames: 42,
        captureMode: "screenshot",
        captureOperation: "captureScreenshot",
        workerCount: 2,
      }),
    );
    await vi.advanceTimersByTimeAsync(240_000);

    expect(
      log.info.mock.calls.some(
        ([message, meta]) =>
          message === "[Render:trace]" && meta?.message === "stage still running",
      ),
    ).toBe(false);
    vi.useRealTimers();
  });

  // fallow-ignore-next-line complexity
  it("records bounded phase events and summarizes browser diagnostics", () => {
    const log = makeLog();
    const recorder = new RenderObservabilityRecorder({
      pipelineStartMs: Date.now() - 100,
      log,
      renderJobId: "render-123",
    });
    const startedAt = recorder.stageStart("capture_hdr_layered", { workerCount: 1 });

    recorder.stageError(
      "capture_hdr_layered",
      startedAt - 5,
      new Error("Navigation timeout of 60000 ms exceeded for /Users/alice/project/video.mp4"),
      { projectPath: "/Users/alice/project", workerCount: 1 },
    );

    const summary = recorder.summary({
      lastBrowserConsole: [
        "[FrameCapture:NAV] page.goto start",
        "[FrameCapture:ERROR] page.goto failed",
        "[FrameCapture:INIT] complete initDurationMs=1234 tweenCount=42",
      ],
      capture: {
        forceScreenshot: true,
        captureMode: "screenshot",
        workerCount: 1,
        useLayeredComposite: true,
      },
      extraction: makeExtractionObservability(),
      compositionHash: "abc123",
    });

    expect(summary.eventCount).toBe(2);
    expect(summary.renderJobId).toBe("render-123");
    expect(summary.compositionHash).toBe("abc123");
    expect(summary.failedPhase).toBe("capture_hdr_layered");
    expect(summary.lastEvent?.status).toBe("error");
    expect(summary.lastEvent?.message).toBe("Navigation timeout of 60000 ms exceeded for [path]");
    expect(summary.lastEvent?.data).toEqual({ workerCount: 1 });
    expect(summary.browserDiagnostics.navigationStarts).toBe(1);
    expect(summary.browserDiagnostics.navigationFailures).toBe(1);
    expect(summary.capture.captureMode).toBe("screenshot");
    expect(summary.extraction?.totalFramesExtracted).toBe(167_400);
    expect(summary.extraction?.vfrPreflightCount).toBe(6);
    expect(summary.init).toEqual({ initDurationMs: 1234, tweenCount: 42 });
    expect(log.info).toHaveBeenCalledWith(
      "[Render:trace]",
      expect.objectContaining({
        renderJobId: "render-123",
        phase: "capture_hdr_layered",
        status: "error",
      }),
    );
  });
});

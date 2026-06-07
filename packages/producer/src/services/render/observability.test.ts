import { describe, expect, it, vi } from "vitest";
import { CaptureStageError, getCaptureStageBrowserConsole } from "./captureStageError.js";
import {
  computeCompositionObservabilityHash,
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

import { describe, expect, it, vi, beforeEach } from "vitest";

const trackEvent = vi.fn();
vi.mock("./client.js", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

const {
  trackRenderComplete,
  trackRenderError,
  trackRenderObservation,
  trackCommandFailure,
  trackCliError,
  trackFigmaImport,
  trackRenderFeedback,
  trackRenderPreflightRejected,
  trackAuthLoginStarted,
  trackAuthLoginCompleted,
  trackAuthLoginFailed,
} = await import("./events.js");

describe("render telemetry events", () => {
  beforeEach(() => {
    trackEvent.mockClear();
  });

  it("redacts paths and URL query strings from render error messages", () => {
    trackRenderError({
      fps: 30,
      quality: "standard",
      docker: false,
      errorMessage:
        "ENOENT: open '/home/ubuntu/project/media/video.mp4' https://example.com/video.mp4?token=secret",
      observabilityCompositionHash: "abc123",
    });

    expect(trackEvent).toHaveBeenCalledWith(
      "render_error",
      expect.objectContaining({
        error_message: "ENOENT: open '[path]' https://example.com/video.mp4?…",
        observability_composition_hash: "abc123",
      }),
      undefined,
    );
  });

  it("emits render_preflight_rejected with the low-cardinality issue kind", () => {
    trackRenderPreflightRejected({ kind: "aspect-mismatch" });
    expect(trackEvent).toHaveBeenCalledWith("render_preflight_rejected", {
      kind: "aspect-mismatch",
    });
  });

  it("forwards distinctId to trackEvent so studio renders attribute to the browser user", () => {
    trackRenderError({
      fps: 30,
      quality: "standard",
      docker: false,
      source: "studio",
      distinctId: "browser-user-123",
    });

    expect(trackEvent).toHaveBeenCalledWith(
      "render_error",
      expect.objectContaining({ source: "studio" }),
      "browser-user-123",
    );
  });

  it("sends split capture-stage timing fields on render_complete", () => {
    trackRenderComplete({
      durationMs: 6000,
      fps: 30,
      quality: "standard",
      docker: false,
      gpu: false,
      stageCaptureMs: 5100,
      stageCaptureSetupMs: 1860,
      stageCaptureFrameMs: 3240,
      captureAvgMs: 27,
    });

    expect(trackEvent).toHaveBeenCalledWith(
      "render_complete",
      expect.objectContaining({
        stage_capture_ms: 5100,
        stage_capture_setup_ms: 1860,
        stage_capture_frame_ms: 3240,
        capture_avg_ms: 27,
      }),
      undefined,
    );
  });

  it("redacts render_observation messages and includes renderJobId for correlation", () => {
    trackRenderObservation({
      renderJobId: "render-123",
      phase: "capture_hdr_layered",
      status: "error",
      compositionHash: "abc123",
      message: "Navigation failed for C:\\Users\\Alice\\project\\video.mov?not-a-query",
    });

    expect(trackEvent).toHaveBeenCalledWith(
      "render_observation",
      expect.objectContaining({
        render_job_id: "render-123",
        composition_hash: "abc123",
        message: "Navigation failed for [path]",
      }),
    );
  });
});

describe("trackRenderFeedback", () => {
  beforeEach(() => {
    trackEvent.mockClear();
  });

  it("omits render_duration_ms when no duration is known (standalone feedback)", () => {
    trackRenderFeedback({ rating: 4, comment: "great" });

    const [, props] = trackEvent.mock.calls[0] as [string, Record<string, unknown>];
    expect(props).not.toHaveProperty("render_duration_ms");
    expect(props.$survey_response).toBe(4);
  });

  it("includes render_duration_ms when a real duration is supplied", () => {
    trackRenderFeedback({ rating: 5, renderDurationMs: 6000 });

    expect(trackEvent).toHaveBeenCalledWith(
      "survey sent",
      expect.objectContaining({ render_duration_ms: 6000 }),
    );
  });
});

describe("trackCliError", () => {
  beforeEach(() => {
    trackEvent.mockClear();
  });

  it("redacts install paths from error_message and stack_trace", () => {
    trackCliError({
      error_name: "Error",
      error_message: "ENOENT: open '/Users/alice/project/index.html'",
      stack_trace: "Error: boom\n    at /Users/alice/.cache/hyperframes/chrome/headless",
      command: "info",
      kind: "command_error",
    });

    const [, props] = trackEvent.mock.calls[0] as [string, Record<string, string>];
    expect(props.error_message).not.toContain("/Users/alice");
    expect(props.error_message).toContain("[path]");
    expect(props.stack_trace).not.toContain("/Users/alice");
  });
});

describe("trackCommandFailure", () => {
  beforeEach(() => {
    trackEvent.mockClear();
  });

  it("reports an Error as a command_error with name/message/stack", () => {
    const err = new Error("ffmpeg is required to extract audio");
    trackCommandFailure("transcribe", err);

    expect(trackEvent).toHaveBeenCalledWith(
      "cli_error",
      expect.objectContaining({
        kind: "command_error",
        command: "transcribe",
        error_name: "Error",
        error_message: "ffmpeg is required to extract audio",
        // stack_trace is asserted (redacted) in the trackCliError suite; the
        // raw err.stack no longer matches once paths are stripped.
      }),
    );
  });

  it("coerces a non-Error reason (e.g. a string) into the message", () => {
    trackCommandFailure("transcribe", "No words found in transcript.");

    expect(trackEvent).toHaveBeenCalledWith(
      "cli_error",
      expect.objectContaining({
        kind: "command_error",
        command: "transcribe",
        error_message: "No words found in transcript.",
      }),
    );
  });
});

describe("trackFigmaImport", () => {
  beforeEach(() => {
    trackEvent.mockClear();
  });

  it("emits figma_import with phase + quality counters, no identifiers", () => {
    trackFigmaImport({
      phase: "component",
      durationMs: 1234,
      unresolvedBindings: 2,
      rasterizedNodes: 3,
    });
    expect(trackEvent).toHaveBeenCalledWith("figma_import", {
      phase: "component",
      duration_ms: 1234,
      unresolved_bindings: 2,
      rasterized_nodes: 3,
    });
  });

  it("carries reused for the asset phase and omits absent props entirely", () => {
    trackFigmaImport({ phase: "asset", durationMs: 42, reused: true });
    expect(trackEvent).toHaveBeenCalledWith("figma_import", {
      phase: "asset",
      duration_ms: 42,
      reused: true,
    });
  });

  it("carries tokens mode + entry count for the tokens phase", () => {
    trackFigmaImport({ phase: "tokens", durationMs: 10, tokensMode: "styles", entryCount: 0 });
    expect(trackEvent).toHaveBeenCalledWith(
      "figma_import",
      expect.objectContaining({ phase: "tokens", tokens_mode: "styles", entry_count: 0 }),
    );
  });
});

describe("auth login telemetry events", () => {
  beforeEach(() => {
    trackEvent.mockClear();
  });

  it("emits auth_login_started tagged with the method", () => {
    trackAuthLoginStarted("oauth");
    expect(trackEvent).toHaveBeenCalledWith("auth_login_started", { method: "oauth" }, undefined);
  });

  it("emits auth_login_completed tagged with the method", () => {
    trackAuthLoginCompleted("api_key");
    expect(trackEvent).toHaveBeenCalledWith(
      "auth_login_completed",
      { method: "api_key" },
      undefined,
    );
  });

  it("emits auth_login_failed with the method and a low-cardinality reason", () => {
    trackAuthLoginFailed("oauth", "flow_error");
    expect(trackEvent).toHaveBeenCalledWith(
      "auth_login_failed",
      { method: "oauth", reason: "flow_error" },
      undefined,
    );
  });

  it("distinguishes a timed-out browser flow from a real error", () => {
    trackAuthLoginFailed("oauth", "flow_timeout");
    expect(trackEvent).toHaveBeenCalledWith(
      "auth_login_failed",
      { method: "oauth", reason: "flow_timeout" },
      undefined,
    );
  });

  it("records an aborted prompt / stdin timeout as its own reason", () => {
    trackAuthLoginFailed("api_key", "aborted");
    expect(trackEvent).toHaveBeenCalledWith(
      "auth_login_failed",
      { method: "api_key", reason: "aborted" },
      undefined,
    );
  });

  it("carries only method + reason — never a key, token, or free text", () => {
    trackAuthLoginFailed("api_key", "rejected");
    expect(trackEvent).toHaveBeenCalledWith(
      "auth_login_failed",
      { method: "api_key", reason: "rejected" },
      undefined,
    );
  });

  it("forwards an explicit distinctId to trackEvent for future user-level attribution", () => {
    trackAuthLoginCompleted("oauth", "heygen-user-123");
    expect(trackEvent).toHaveBeenCalledWith(
      "auth_login_completed",
      { method: "oauth" },
      "heygen-user-123",
    );
  });
});

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

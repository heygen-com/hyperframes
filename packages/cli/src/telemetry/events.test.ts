import { describe, expect, it, vi, beforeEach } from "vitest";

const trackEvent = vi.fn();
vi.mock("./client.js", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

const { trackRenderError, trackRenderObservation, trackCommandFailure } =
  await import("./events.js");

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
        stack_trace: err.stack,
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

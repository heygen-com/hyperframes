import { describe, expect, it, vi, beforeEach } from "vitest";

const trackEvent = vi.fn();
vi.mock("./client.js", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

// identifyUser reads the install anonymousId; pin it so the $identify alias is
// deterministic and the test never touches disk.
vi.mock("./config.js", () => ({
  readConfig: () => ({ anonymousId: "anon-test-123", telemetryEnabled: true }),
}));

const {
  trackCommand,
  trackCommandResult,
  trackCheckReport,
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
  identifyUser,
} = await import("./events.js");

describe("command telemetry events", () => {
  beforeEach(() => {
    trackEvent.mockClear();
  });

  it("includes run_id in cli_command when a run ID is provided", () => {
    trackCommand("check", "run-123");

    expect(trackEvent).toHaveBeenCalledWith("cli_command", {
      command: "check",
      run_id: "run-123",
    });
  });

  it("omits run_id from cli_command when no run ID is provided", () => {
    trackCommand("check");

    const properties = trackEvent.mock.lastCall?.[1];
    expect(properties).not.toHaveProperty("run_id");
  });

  it("includes run_id in cli_command_result when a run ID is provided", () => {
    trackCommandResult({
      command: "check",
      success: true,
      exitCode: 0,
      durationMs: 42,
      runId: "run-123",
    });

    expect(trackEvent).toHaveBeenCalledWith("cli_command_result", {
      command: "check",
      success: true,
      exit_code: 0,
      duration_ms: 42,
      run_id: "run-123",
    });
  });

  it("omits run_id from cli_command_result when no run ID is provided", () => {
    trackCommandResult({
      command: "check",
      success: false,
      exitCode: 1,
      durationMs: 42,
    });

    const properties = trackEvent.mock.lastCall?.[1];
    expect(properties).not.toHaveProperty("run_id");
  });
});

describe("trackCheckReport", () => {
  beforeEach(() => {
    trackEvent.mockClear();
  });

  it("emits the check breakdown with snake_case properties and a run ID", () => {
    trackCheckReport({
      contrastGate: true,
      motionGate: false,
      captionZoneGate: true,
      frameCheckGate: false,
      snapshotsGate: true,
      lintErrors: 1,
      lintWarnings: 2,
      runtimeErrors: 3,
      runtimeWarnings: 4,
      layoutErrors: 5,
      layoutWarnings: 6,
      motionErrors: 7,
      motionWarnings: 8,
      contrastErrors: 9,
      contrastWarnings: 10,
      launchSettleMs: 11,
      seekLoopMs: 12,
      contrastMs: 13,
      gridPoints: 14,
      contrastPoints: 15,
      ok: false,
      exitCode: 1,
      runId: "run-123",
    });

    expect(trackEvent).toHaveBeenCalledWith("check_report", {
      gate_contrast: true,
      gate_motion: false,
      gate_caption_zone: true,
      gate_frame_check: false,
      gate_snapshots: true,
      lint_errors: 1,
      lint_warnings: 2,
      runtime_errors: 3,
      runtime_warnings: 4,
      layout_errors: 5,
      layout_warnings: 6,
      motion_errors: 7,
      motion_warnings: 8,
      contrast_errors: 9,
      contrast_warnings: 10,
      launch_settle_ms: 11,
      seek_loop_ms: 12,
      contrast_ms: 13,
      grid_points: 14,
      contrast_points: 15,
      ok: false,
      exit_code: 1,
      run_id: "run-123",
    });
  });

  it("omits run_id when no run ID is provided", () => {
    trackCheckReport({
      contrastGate: false,
      motionGate: false,
      captionZoneGate: false,
      frameCheckGate: false,
      snapshotsGate: false,
      lintErrors: 0,
      lintWarnings: 0,
      runtimeErrors: 0,
      runtimeWarnings: 0,
      layoutErrors: 0,
      layoutWarnings: 0,
      motionErrors: 0,
      motionWarnings: 0,
      contrastErrors: 0,
      contrastWarnings: 0,
      launchSettleMs: 0,
      seekLoopMs: 0,
      contrastMs: 0,
      gridPoints: 0,
      contrastPoints: 0,
      ok: true,
      exitCode: 0,
    });

    const properties = trackEvent.mock.lastCall?.[1];
    expect(properties).not.toHaveProperty("run_id");
  });
});

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

  it("carries the DE parallel-router/inversion cohort on render_error (hard failure, not just self-verify revert)", () => {
    trackRenderError({
      fps: 30,
      quality: "standard",
      docker: false,
      errorMessage: "worker crashed",
      captureDeParallelRouter: "routed",
      captureDePreRouterWorkers: 2,
      captureWorkerCount: 3,
      captureMemoryExhaustionDetected: true,
    });

    expect(trackEvent).toHaveBeenCalledWith(
      "render_error",
      expect.objectContaining({
        de_parallel_router: "routed",
        de_pre_router_workers: 2,
        capture_worker_count: 3,
        capture_memory_exhaustion_detected: true,
      }),
      undefined,
    );
  });

  it("carries de_fallback_reason on render_error so a render that fails AFTER an OOM-triggered fallback attempt is distinguishable from one that never attempted a fallback", () => {
    trackRenderError({
      fps: 30,
      quality: "standard",
      docker: false,
      errorMessage: "worker crashed again after fallback",
      captureDeParallelRouter: "reverted",
      captureDeSelfVerifyFallback: false,
      captureDeFallbackReason: "oom",
    });

    expect(trackEvent).toHaveBeenCalledWith(
      "render_error",
      expect.objectContaining({
        de_parallel_router: "reverted",
        de_self_verify_fallback: false,
        de_fallback_reason: "oom",
      }),
      undefined,
    );
  });

  it("prefers the explicit perfSummary-sourced de_worker_inversion over the capture-observability fallback on render_complete", () => {
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "standard",
      docker: false,
      gpu: false,
      deWorkerInversion: "inverted",
      // Simulates a stale/divergent capture-observability value — the explicit
      // perfSummary field above must win, not this one.
      captureDeWorkerInversion: "reverted",
    });

    expect(trackEvent).toHaveBeenCalledWith(
      "render_complete",
      expect.objectContaining({ de_worker_inversion: "inverted" }),
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
      captureMode: "screenshot",
      captureOperation: "captureScreenshot",
      framesCompleted: 12,
      totalFrames: 900,
      heartbeatIndex: 1,
      stageElapsedMs: 30_000,
      message: "Navigation failed for C:\\Users\\Alice\\project\\video.mov?not-a-query",
    });

    expect(trackEvent).toHaveBeenCalledWith(
      "render_observation",
      expect.objectContaining({
        render_job_id: "render-123",
        composition_hash: "abc123",
        capture_mode: "screenshot",
        capture_operation: "captureScreenshot",
        frames_completed: 12,
        total_frames: 900,
        heartbeat_index: 1,
        stage_elapsed_ms: 30_000,
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

  it("forwards an explicit distinctId to trackEvent for user-level attribution", () => {
    trackAuthLoginCompleted("oauth", "alice@example.com");
    expect(trackEvent).toHaveBeenCalledWith(
      "auth_login_completed",
      { method: "oauth" },
      "alice@example.com",
    );
  });

  it("identifyUser emits a $identify alias linking the anon install to the identity", () => {
    identifyUser("alice@example.com");
    expect(trackEvent).toHaveBeenCalledWith(
      "$identify",
      { $anon_distinct_id: "anon-test-123" },
      "alice@example.com",
    );
  });

  it("identifyUser is a no-op when there is no identity to attach", () => {
    identifyUser("");
    expect(trackEvent).not.toHaveBeenCalled();
  });
});

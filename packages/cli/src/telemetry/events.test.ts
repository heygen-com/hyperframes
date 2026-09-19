import { describe, expect, it, vi, beforeEach } from "vitest";

const trackEvent = vi.fn();
const flush = vi.fn(() => Promise.resolve());
const shouldTrack = vi.fn(() => true);
vi.mock("./client.js", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
  flush: () => flush(),
  shouldTrack: () => shouldTrack(),
}));

// Power state shells out to `pmset`; spy so tests can assert it is NOT
// sampled for opted-out installs (the fields are built at the call site,
// before trackEvent's own shouldTrack guard).
const getPowerState = vi.fn(() => ({ on_battery: true, low_power_mode: false }));
vi.mock("./system.js", async () => ({
  ...(await vi.importActual<typeof import("./system.js")>("./system.js")),
  getPowerState: () => getPowerState(),
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
    flush.mockClear();
  });

  // The catalog join. Counts must be present at zero: the no-catalog cohort is
  // what the with-catalog cohort is compared against, and an absent property is
  // indistinguishable from an older CLI that never sent one.
  it("reports zero catalog counts for a project with no registry items", () => {
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "draft",
      docker: false,
      gpu: false,
      catalogUsage: { installed: [], usedBlocks: [], manifestUnreadable: false },
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.registry_item_count).toBe(0);
    expect(props.registry_blocks_used_count).toBe(0);
    expect(props.registry_items).toBeUndefined();
  });

  it("names the installed items and the subset the render reached", () => {
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "draft",
      docker: false,
      gpu: false,
      catalogUsage: {
        installed: ["bar-chart-race", "data-chart"],
        usedBlocks: ["data-chart"],
        manifestUnreadable: false,
      },
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.registry_items).toBe("bar-chart-race,data-chart");
    expect(props.registry_item_count).toBe(2);
    expect(props.registry_blocks_used).toBe("data-chart");
    expect(props.registry_blocks_used_count).toBe(1);
  });

  // A count is one integer with no cardinality risk. Capping it would lose the
  // real number with no way downstream to tell 40 installs from 400.
  it("caps the item names but reports the true counts past the cap", () => {
    const installed = Array.from({ length: 45 }, (_, i) => `b${String(i + 1).padStart(2, "0")}`);
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "draft",
      docker: false,
      gpu: false,
      catalogUsage: { installed, usedBlocks: installed.slice(-5), manifestUnreadable: false },
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.registry_item_count).toBe(45);
    expect(props.registry_blocks_used_count).toBe(5);
    expect(String(props.registry_items).split(",")).toHaveLength(40);
    // The names are a window, and a query joining on them would otherwise read
    // this project as 45 abandoned items: every used block sits past the cap,
    // so `registry_blocks_used` is absent against a count of 5.
    expect(props.registry_items_truncated).toBe(true);
    expect(props.registry_blocks_used).toBeUndefined();
  });

  it("does not claim truncation when every name fits", () => {
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "draft",
      docker: false,
      gpu: false,
      catalogUsage: {
        installed: ["bar-chart-race", "data-chart"],
        usedBlocks: ["data-chart"],
        manifestUnreadable: false,
      },
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.registry_items_truncated).toBeUndefined();
  });

  // Sliced independently the two lists come out disjoint, which breaks the one
  // relationship any drop-off query relies on.
  it("keeps the used names a subset of the reported installed names", () => {
    const installed = Array.from({ length: 45 }, (_, i) => `b${String(i + 1).padStart(2, "0")}`);
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "draft",
      docker: false,
      gpu: false,
      catalogUsage: { installed, usedBlocks: installed.slice(-5), manifestUnreadable: false },
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    const reported = new Set(String(props.registry_items).split(","));
    const used =
      props.registry_blocks_used === undefined ? [] : String(props.registry_blocks_used).split(",");
    expect(used.every((name) => reported.has(name))).toBe(true);
  });

  // The control cohort is the one that must not silently absorb failures: a
  // project whose manifest cannot be read is not a project without a catalog.
  it("flags an unreadable manifest instead of reporting it as zero catalog items", () => {
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "draft",
      docker: false,
      gpu: false,
      catalogUsage: { installed: [], usedBlocks: [], manifestUnreadable: true },
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.registry_manifest_unreadable).toBe(true);
    expect(props.registry_item_count).toBeUndefined();
  });

  // A caller that built render options by hand makes no catalog claim, rather
  // than claiming zero items.
  it("omits the catalog props entirely when usage was never resolved", () => {
    trackRenderComplete({ durationMs: 1, fps: 30, quality: "draft", docker: false, gpu: false });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.registry_item_count).toBeUndefined();
    expect(props.registry_blocks_used_count).toBeUndefined();
  });

  // Output-shape request facts are resolved from CLI flags before the
  // pipeline starts, so both render_complete and render_error must carry
  // them: a failure before perfSummary exists is exactly the case these
  // fields (unlike the perfSummary-derived ones) still need to cover.
  it("carries output-shape request facts on render_complete", () => {
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "high",
      docker: false,
      gpu: false,
      outputResolutionPreset: "landscape-4k",
      outputFormat: "gif",
      hdrMode: "force-sdr",
      videoFrameFormat: "png",
      gifFpsCapped: true,
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.output_resolution_preset).toBe("landscape-4k");
    expect(props.output_format).toBe("gif");
    expect(props.hdr_mode).toBe("force-sdr");
    expect(props.video_frame_format).toBe("png");
    expect(props.gif_fps_capped).toBe(true);
  });

  it("carries output-shape request facts on render_error", () => {
    trackRenderError({
      fps: 30,
      quality: "high",
      docker: false,
      outputResolutionPreset: "portrait",
      outputFormat: "mp4",
      hdrMode: "auto",
      videoFrameFormat: "auto",
      gifFpsCapped: false,
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.output_resolution_preset).toBe("portrait");
    expect(props.output_format).toBe("mp4");
    expect(props.hdr_mode).toBe("auto");
    expect(props.video_frame_format).toBe("auto");
    expect(props.gif_fps_capped).toBe(false);
  });

  it("omits output-shape request facts when the caller never resolved them", () => {
    trackRenderComplete({ durationMs: 1, fps: 30, quality: "draft", docker: false, gpu: false });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.output_resolution_preset).toBeUndefined();
    expect(props.output_format).toBeUndefined();
    expect(props.hdr_mode).toBeUndefined();
    expect(props.video_frame_format).toBeUndefined();
    expect(props.gif_fps_capped).toBeUndefined();
  });

  // Local-preflight toolchain majors; absent on Docker renders (the
  // container runs its own preflight, never surfaced to the host CLI).
  it("carries local toolchain majors on render_complete", () => {
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "high",
      docker: false,
      gpu: false,
      ffmpegVersionMajor: 7,
      browserVersionMajor: 119,
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.ffmpeg_version_major).toBe(7);
    expect(props.browser_version_major).toBe(119);
  });

  it("carries local toolchain majors on render_error", () => {
    trackRenderError({
      fps: 30,
      quality: "high",
      docker: false,
      ffmpegVersionMajor: 6,
      browserVersionMajor: 118,
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.ffmpeg_version_major).toBe(6);
    expect(props.browser_version_major).toBe(118);
  });

  it("carries the browser install path facts on both render events, never the path", () => {
    const browserInstall = {
      build: "152.0.7928.2",
      pathAscii: false,
      pathLength: "200_to_259",
      drive: "windows_other",
    } as const;
    trackRenderComplete({
      durationMs: 1,
      fps: 30,
      quality: "draft",
      docker: false,
      gpu: false,
      browserInstall,
    });
    trackRenderError({ fps: 30, quality: "draft", docker: false, browserInstall });
    for (const call of trackEvent.mock.calls) {
      const props = call[1] as Record<string, unknown>;
      expect(props).toMatchObject({
        browser_build: "152.0.7928.2",
        browser_path_ascii: false,
        browser_path_length: "200_to_259",
        browser_path_drive: "windows_other",
      });
      expect(Object.keys(props)).not.toContain("browser_path");
    }
  });

  it("omits toolchain majors on a Docker render", () => {
    trackRenderComplete({ durationMs: 1, fps: 30, quality: "draft", docker: true, gpu: false });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.ffmpeg_version_major).toBeUndefined();
    expect(props.browser_version_major).toBeUndefined();
  });

  it("reports which step resolved authoring-skill attribution", () => {
    trackRenderComplete({
      durationMs: 1,
      fps: 30,
      quality: "draft",
      docker: false,
      gpu: false,
      authoringSkill: "product-launch-video",
      authoringSkillSource: "flag",
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.authoring_skill).toBe("product-launch-video");
    expect(props.authoring_skill_source).toBe("flag");
    expect(props.authoring_skill_invalid).toBeUndefined();
  });

  it("carries a malformed --skill value on render_error without a resolved source", () => {
    trackRenderError({
      fps: 30,
      quality: "draft",
      docker: false,
      authoringSkillInvalid: "Not A Skill!",
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.authoring_skill_invalid).toBe("Not A Skill!");
    expect(props.authoring_skill_source).toBeUndefined();
  });

  it("carries the root/body scaffold-mismatch measurement from perfSummary on render_complete", () => {
    trackRenderComplete({
      durationMs: 1,
      fps: 30,
      quality: "draft",
      docker: false,
      gpu: false,
      rootBodyMismatch: true,
      rootBodyDeltaPxBucket: "51+",
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.root_body_mismatch).toBe(true);
    expect(props.root_body_delta_px_bucket).toBe("51+");
  });

  it("falls back to the live capture-observability measurement on render_error (no perfSummary)", () => {
    trackRenderError({
      fps: 30,
      quality: "draft",
      docker: false,
      captureRootBodyMismatch: false,
      captureRootBodyDeltaPxBucket: "0",
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.root_body_mismatch).toBe(false);
    expect(props.root_body_delta_px_bucket).toBe("0");
  });

  it("carries the names of HF/HYPERFRAMES env overrides present at plan time", () => {
    trackRenderComplete({
      durationMs: 1,
      fps: 30,
      quality: "draft",
      docker: false,
      gpu: false,
      hfEnvOverrides: ["HF_DE_VERIFY", "HYPERFRAMES_FONT_CACHE_DIR"],
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.hf_env_overrides).toEqual(["HF_DE_VERIFY", "HYPERFRAMES_FONT_CACHE_DIR"]);
  });

  it("reports an empty array, not an absent field, when no override was resolved", () => {
    trackRenderError({ fps: 30, quality: "draft", docker: false });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.hf_env_overrides).toEqual([]);
  });

  it("names the runtime adapters a render exercised", () => {
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "high",
      docker: false,
      gpu: false,
      adaptersUsed: ["gsap", "three"],
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.adapters_used).toEqual(["gsap", "three"]);
  });

  // adaptersUsed is a live+static UNION with no gating role (unlike
  // compositionElementCount), so "no adapter detected" is a real measurement
  // and must be reported as one: an absent property is indistinguishable from
  // an older CLI that never sent it.
  it("reports an empty adapter list rather than dropping the property", () => {
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "high",
      docker: false,
      gpu: false,
      adaptersUsed: [],
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.adapters_used).toEqual([]);
  });

  it("omits adapters_used entirely when the caller never resolved it", () => {
    trackRenderComplete({ durationMs: 1000, fps: 30, quality: "high", docker: false, gpu: false });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.adapters_used).toBeUndefined();
  });

  it("carries the composition scan's element/attribute counts and hasLut flag", () => {
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "high",
      docker: false,
      gpu: false,
      audioCount: 3,
      imageCount: 5,
      subCompositionCount: 1,
      audioGroupCount: 2,
      colorGradingCount: 4,
      hasLut: true,
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.audio_count).toBe(3);
    expect(props.image_count).toBe(5);
    expect(props.sub_composition_count).toBe(1);
    expect(props.audio_group_count).toBe(2);
    expect(props.color_grading_count).toBe(4);
    expect(props.has_lut).toBe(true);
  });

  it("reports zero counts and hasLut false rather than dropping the properties", () => {
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "high",
      docker: false,
      gpu: false,
      audioCount: 0,
      imageCount: 0,
      subCompositionCount: 0,
      audioGroupCount: 0,
      colorGradingCount: 0,
      hasLut: false,
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.audio_count).toBe(0);
    expect(props.image_count).toBe(0);
    expect(props.sub_composition_count).toBe(0);
    expect(props.audio_group_count).toBe(0);
    expect(props.color_grading_count).toBe(0);
    expect(props.has_lut).toBe(false);
  });

  // emitStudioRenderComplete never resolves perfSummary.drawElement, only the
  // observability capture fields (captureAudioCount/captureRootBodyMismatch/etc),
  // so these must fall back to the capture value or a studio render reports none
  // of them despite having computed and sent it.
  it("falls back to the observability capture value for a studio render, which never resolves the direct field", () => {
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "high",
      docker: false,
      gpu: false,
      source: "studio",
      captureAudioCount: 2,
      captureImageCount: 1,
      captureRootBodyMismatch: true,
      captureRootBodyDeltaPxBucket: "11-50",
      captureAdaptersUsed: ["gsap"],
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.audio_count).toBe(2);
    expect(props.image_count).toBe(1);
    expect(props.root_body_mismatch).toBe(true);
    expect(props.root_body_delta_px_bucket).toBe("11-50");
    expect(props.adapters_used).toEqual(["gsap"]);
  });

  it("prefers the direct drawElement-sourced value over the capture fallback when both are present", () => {
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "high",
      docker: false,
      gpu: false,
      audioCount: 3,
      captureAudioCount: 99,
    });
    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props.audio_count).toBe(3);
  });

  it("flushes immediately after render_complete and render_error (exit races the lazy flush)", () => {
    trackRenderComplete({ durationMs: 1000, fps: 30, quality: "draft", docker: false, gpu: false });
    expect(flush).toHaveBeenCalledTimes(1);
    trackRenderError({ fps: 30, quality: "draft", docker: false });
    expect(flush).toHaveBeenCalledTimes(2);
  });

  // The enforcement decision for the advisory heap budget reads these fleet
  // props (see computeWorkerSizing) — a silent drop in the summary→event hop
  // would invalidate that decision without anyone noticing.
  it("carries every worker-sizing provenance prop on render_complete", () => {
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "high",
      docker: false,
      gpu: false,
      workers: 6,
      workersBoundBy: "max_workers",
      workersCpuBased: 16,
      workersMemoryBased: 8,
      workersHeapBased: 4,
      workersFrameBased: 24,
      workersHeapLimitMb: 4096,
      workersExceedHeapAdvisory: true,
    });

    expect(trackEvent).toHaveBeenCalledWith(
      "render_complete",
      expect.objectContaining({
        workers: 6,
        workers_bound_by: "max_workers",
        workers_cpu_based: 16,
        workers_memory_based: 8,
        workers_heap_based: 4,
        workers_frame_based: 24,
        workers_heap_limit_mb: 4096,
        workers_exceed_heap_advisory: true,
      }),
      undefined,
    );
  });

  it("ties feedback to its report and recent renders via feedback_id + recent_render_ids", () => {
    trackRenderFeedback({
      rating: 3,
      comment: "hook scene blank",
      feedbackId: "feedback-uuid",
      recentRenderIds: ["render-a", "render-b"],
    });

    expect(trackEvent).toHaveBeenCalledWith(
      "cli_render_feedback",
      expect.objectContaining({
        feedback_id: "feedback-uuid",
        recent_render_ids: "render-a,render-b",
      }),
    );
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

  it("maps Chrome memory and capture path observability onto render_error", () => {
    trackRenderError({
      fps: 30,
      quality: "draft",
      docker: false,
      captureChromeBrowserRssPeakMb: 210,
      captureChromeRendererRssPeakMb: 1900,
      captureChromeRssLastMb: 2400,
      captureChromeGpuProcessSeenLastSample: true,
      captureChromeMemorySamples: 42,
      captureCapturePath: "streaming",
      captureSegmentIndex: 3,
      captureSegmentRetries: 1,
    });

    expect(trackEvent).toHaveBeenCalledWith(
      "render_error",
      expect.objectContaining({
        chrome_browser_rss_peak_mb: 210,
        chrome_renderer_rss_peak_mb: 1900,
        chrome_rss_last_mb: 2400,
        gpu_process_seen_last_sample: true,
        chrome_memory_samples: 42,
        capture_path: "streaming",
        segment_index: 3,
        segment_retries: 1,
      }),
      undefined,
    );
  });

  it("prefers the aggregate Chrome memory over the live sample on render_complete", () => {
    // The live observability values are the last session's; the perf summary
    // aggregates every worker. On success both are present and the aggregate
    // must win, or a multi-worker render reports one worker's peak as the
    // fleet's.
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "draft",
      docker: false,
      gpu: false,
      captureChromeBrowserRssPeakMb: 100,
      captureChromeRendererRssPeakMb: 800,
      captureChromeRssLastMb: 900,
      captureChromeMemorySamples: 5,
      chromeBrowserRssPeakMb: 210,
      chromeRendererRssPeakMb: 1900,
      chromeRssLastMb: 2400,
      chromeGpuProcessSeenLastSample: true,
      chromeMemorySamples: 42,
    });

    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props).toMatchObject({
      chrome_browser_rss_peak_mb: 210,
      chrome_renderer_rss_peak_mb: 1900,
      chrome_rss_last_mb: 2400,
      gpu_process_seen_last_sample: true,
      chrome_memory_samples: 42,
    });
  });

  it("falls back to the live Chrome memory sample when no aggregate exists", () => {
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "draft",
      docker: false,
      gpu: false,
      captureChromeBrowserRssPeakMb: 100,
      captureChromeMemorySamples: 5,
      captureCapturePath: "disk",
    });

    const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props).toMatchObject({
      chrome_browser_rss_peak_mb: 100,
      chrome_memory_samples: 5,
      capture_path: "disk",
    });
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

  it("carries the failing dB, frame index, and threshold on render_error for a psnr fallback that failed hard afterward", () => {
    trackRenderError({
      fps: 30,
      quality: "standard",
      docker: false,
      errorMessage: "worker crashed after a psnr fallback",
      captureDeParallelRouter: "reverted",
      captureDeSelfVerifyFallback: true,
      captureDeFallbackReason: "psnr",
      captureDeFallbackFailedDb: 28.4,
      captureDeFallbackFrameIndex: 649,
      captureDeFallbackThresholdDb: 32,
    });

    expect(trackEvent).toHaveBeenCalledWith(
      "render_error",
      expect.objectContaining({
        de_fallback_reason: "psnr",
        de_fallback_failed_db: 28.4,
        de_fallback_frame_index: 649,
        de_fallback_threshold_db: 32,
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

  it("carries the perfSummary-sourced failing dB, frame index, and threshold on render_complete", () => {
    trackRenderComplete({
      durationMs: 1000,
      fps: 30,
      quality: "standard",
      docker: false,
      gpu: false,
      deParallelRouter: "reverted",
      deFallbackReason: "psnr",
      deFallbackFailedDb: 28.4,
      deFallbackFrameIndex: 649,
      deFallbackThresholdDb: 32,
    });

    expect(trackEvent).toHaveBeenCalledWith(
      "render_complete",
      expect.objectContaining({
        de_fallback_reason: "psnr",
        de_fallback_failed_db: 28.4,
        de_fallback_frame_index: 649,
        de_fallback_threshold_db: 32,
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

  it("sends beginframe no-damage reuse counters on render_complete", () => {
    trackRenderComplete({
      durationMs: 6000,
      fps: 30,
      quality: "standard",
      docker: false,
      gpu: false,
      beginFrameNoDamageFrames: 720,
      beginFrameHasDamageFrames: 480,
    });

    expect(trackEvent).toHaveBeenCalledWith(
      "render_complete",
      expect.objectContaining({
        begin_frame_no_damage_frames: 720,
        begin_frame_has_damage_frames: 480,
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

  it("carries capture_parallel_stream on render_error via the shared payload", () => {
    trackRenderError({
      fps: 30,
      quality: "standard",
      docker: false,
      errorMessage: "worker crashed",
      captureParallelStream: "beginframe",
    });

    expect(trackEvent).toHaveBeenCalledWith(
      "render_error",
      expect.objectContaining({ capture_parallel_stream: "beginframe" }),
      undefined,
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
    expect(props.rating).toBe(4);
    expect(props.rating_scale).toBe(10);
  });

  it("includes render_duration_ms when a real duration is supplied", () => {
    trackRenderFeedback({ rating: 5, renderDurationMs: 6000 });

    expect(trackEvent).toHaveBeenCalledWith(
      "cli_render_feedback",
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

  it("forwards the figma endpoint label when supplied", () => {
    trackCliError({
      error_name: "RATE_LIMITED",
      error_message: "figma rate limit hit (429)",
      command: "figma asset",
      kind: "command_error",
      endpoint: "images",
    });

    expect(trackEvent).toHaveBeenCalledWith(
      "cli_error",
      expect.objectContaining({ endpoint: "images" }),
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

describe("power-state sampling respects the telemetry opt-out", () => {
  beforeEach(() => {
    getPowerState.mockClear();
    shouldTrack.mockReturnValue(true);
  });

  it("samples power state for a tracked render", () => {
    trackRenderComplete({ durationMs: 1, fps: 30, quality: "high", docker: false, gpu: false });
    expect(getPowerState).toHaveBeenCalled();
    const props = trackEvent.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(props.on_battery).toBe(true);
    expect(props.low_power_mode).toBe(false);
  });

  it("does NOT spawn pmset when telemetry is disabled", () => {
    // Regression: powerStateFields() is spread into the properties object at
    // the call site, so it runs BEFORE trackEvent's `if (!shouldTrack())`
    // guard — an opted-out install would otherwise pay two blocking
    // subprocess spawns per render for an event that is then discarded.
    shouldTrack.mockReturnValue(false);
    trackRenderComplete({ durationMs: 1, fps: 30, quality: "high", docker: false, gpu: false });
    expect(getPowerState).not.toHaveBeenCalled();
  });
});

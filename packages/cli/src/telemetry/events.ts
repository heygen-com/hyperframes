import { redactTelemetryString, type OutputResolutionIssueKind } from "@hyperframes/core";
import { trackEvent } from "./client.js";

export interface RenderObservabilityTelemetryPayload {
  observabilityRenderJobId?: string;
  observabilityCompositionHash?: string;
  observabilityEventCount?: number;
  observabilityLastPhase?: string;
  observabilityLastStatus?: string;
  observabilityFailedPhase?: string;
  browserDiagnosticCount?: number;
  browserDiagnosticErrors?: number;
  browserDiagnosticPageErrors?: number;
  browserDiagnosticRequestFailed?: number;
  browserDiagnosticHttpErrors?: number;
  browserDiagnosticNavigationStarts?: number;
  browserDiagnosticNavigationFailures?: number;
  browserDiagnosticConsoleErrors?: number;
  browserDiagnosticConsoleWarnings?: number;
  captureMode?: string;
  captureForceScreenshot?: boolean;
  captureWorkerCount?: number;
  captureUseStreamingEncode?: boolean;
  captureUseLayeredComposite?: boolean;
  captureUsePageSideCompositing?: boolean;
  captureHasHdrContent?: boolean;
  captureBrowserGpuMode?: string;
  captureProtocolTimeoutMs?: number;
  capturePageNavigationTimeoutMs?: number;
  capturePlayerReadyTimeoutMs?: number;
  captureTransientRetries?: number;
  captureMemoryExhaustionDetected?: boolean;
  observabilityExtractVideoCount?: number;
  observabilityExtractedVideoCount?: number;
  observabilityExtractTotalFrames?: number;
  observabilityExtractMaxFramesPerVideo?: number;
  observabilityExtractAvgFramesPerVideo?: number;
  observabilityExtractVfrProbeMs?: number;
  observabilityExtractVfrPreflightMs?: number;
  observabilityExtractVfrPreflightCount?: number;
  observabilityExtractCacheHits?: number;
  observabilityExtractCacheMisses?: number;
  observabilityInitDurationMs?: number;
  observabilityInitTweenCount?: number;
}

function renderObservabilityEventProperties(props: RenderObservabilityTelemetryPayload) {
  return {
    observability_render_job_id: props.observabilityRenderJobId,
    observability_composition_hash: props.observabilityCompositionHash,
    observability_event_count: props.observabilityEventCount,
    observability_last_phase: props.observabilityLastPhase,
    observability_last_status: props.observabilityLastStatus,
    observability_failed_phase: props.observabilityFailedPhase,
    browser_diagnostic_count: props.browserDiagnosticCount,
    browser_diagnostic_errors: props.browserDiagnosticErrors,
    browser_diagnostic_page_errors: props.browserDiagnosticPageErrors,
    browser_diagnostic_request_failed: props.browserDiagnosticRequestFailed,
    browser_diagnostic_http_errors: props.browserDiagnosticHttpErrors,
    browser_diagnostic_navigation_starts: props.browserDiagnosticNavigationStarts,
    browser_diagnostic_navigation_failures: props.browserDiagnosticNavigationFailures,
    browser_diagnostic_console_errors: props.browserDiagnosticConsoleErrors,
    browser_diagnostic_console_warnings: props.browserDiagnosticConsoleWarnings,
    capture_mode: props.captureMode,
    capture_force_screenshot: props.captureForceScreenshot,
    capture_worker_count: props.captureWorkerCount,
    capture_use_streaming_encode: props.captureUseStreamingEncode,
    capture_use_layered_composite: props.captureUseLayeredComposite,
    capture_use_page_side_compositing: props.captureUsePageSideCompositing,
    capture_has_hdr_content: props.captureHasHdrContent,
    capture_browser_gpu_mode: props.captureBrowserGpuMode,
    capture_protocol_timeout_ms: props.captureProtocolTimeoutMs,
    capture_page_navigation_timeout_ms: props.capturePageNavigationTimeoutMs,
    capture_player_ready_timeout_ms: props.capturePlayerReadyTimeoutMs,
    capture_transient_retries: props.captureTransientRetries,
    capture_memory_exhaustion_detected: props.captureMemoryExhaustionDetected,
    observability_extract_video_count: props.observabilityExtractVideoCount,
    observability_extracted_video_count: props.observabilityExtractedVideoCount,
    observability_extract_total_frames: props.observabilityExtractTotalFrames,
    observability_extract_max_frames_per_video: props.observabilityExtractMaxFramesPerVideo,
    observability_extract_avg_frames_per_video: props.observabilityExtractAvgFramesPerVideo,
    observability_extract_vfr_probe_ms: props.observabilityExtractVfrProbeMs,
    observability_extract_vfr_preflight_ms: props.observabilityExtractVfrPreflightMs,
    observability_extract_vfr_preflight_count: props.observabilityExtractVfrPreflightCount,
    observability_extract_cache_hits: props.observabilityExtractCacheHits,
    observability_extract_cache_misses: props.observabilityExtractCacheMisses,
    observability_init_duration_ms: props.observabilityInitDurationMs,
    observability_init_tween_count: props.observabilityInitTweenCount,
  };
}

function redactTelemetryMessage(value: string): string {
  return redactTelemetryString(value);
}

export function trackCommand(command: string): void {
  trackEvent("cli_command", { command });
}

export function trackRenderComplete(
  props: {
    durationMs: number;
    fps: number;
    quality: string;
    /** Authoring workflow skill that drove this render (e.g. "product-launch-video"). */
    authoringSkill?: string;
    workers?: number;
    docker: boolean;
    gpu: boolean;
    // Static-frame dedup outcome (opt-out HF_STATIC_DEDUP=false). Undefined on
    // render paths with no capture session.
    staticDedupEnabled?: boolean;
    staticDedupArmed?: boolean;
    staticDedupSkipReason?: string;
    staticDedupPredictedFrames?: number;
    staticDedupReusedFrames?: number;
    // drawElement fast-capture outcome (default-on release visibility).
    // Undefined on render paths with no capture session.
    deCaptureMode?: string;
    deCompileGate?: string;
    deClampReason?: string;
    deGateReason?: string;
    deWorkerEncode?: boolean;
    deVerifyArmed?: number;
    deVerifyChecked?: number;
    deVerifyMinDb?: number;
    deVerifyInitMs?: number;
    deSelfVerifyFallback?: boolean;
    deFallbackReason?: string;
    deBlankSuspects?: number;
    deBlankDeterministicAccepts?: number;
    deBlankRecaptures?: number;
    deBoundaryFrames?: number;
    deNcprFallbacks?: number;
    // "cli" when triggered by `hyperframes render` (default), "studio" when
    // triggered by a studio preview-server render (POST /api/projects/:id/render).
    source?: "cli" | "studio";
    // Composition metadata
    compositionDurationMs?: number;
    compositionWidth?: number;
    compositionHeight?: number;
    totalFrames?: number;
    // Processing efficiency
    speedRatio?: number;
    captureAvgMs?: number;
    /** Warmup-robust per-frame capture median (basis for speedup estimates). */
    captureP50Ms?: number;
    /** <video> element count (speedup segmentation: injection comps read lower). */
    videoCount?: number;
    capturePeakMs?: number;
    // Resource usage
    peakMemoryMb?: number;
    memoryFreeMb?: number;
    tmpPeakBytes?: number;
    // Per-stage timings (subset of RenderPerfSummary.stages)
    stageCompileMs?: number;
    stageVideoExtractMs?: number;
    stageAudioProcessMs?: number;
    stageCaptureMs?: number;
    stageCaptureSetupMs?: number;
    stageCaptureFrameMs?: number;
    stageEncodeMs?: number;
    stageAssembleMs?: number;
    // Video-extraction breakdown (from RenderPerfSummary.videoExtractBreakdown)
    extractResolveMs?: number;
    extractHdrProbeMs?: number;
    extractHdrPreflightMs?: number;
    extractHdrPreflightCount?: number;
    extractVfrProbeMs?: number;
    extractVfrPreflightMs?: number;
    extractVfrPreflightCount?: number;
    extractPhase3Ms?: number;
    extractCacheHits?: number;
    extractCacheMisses?: number;
    // Attribute this event to a specific user (e.g. the browser user who
    // triggered a studio render); defaults to the install anonymousId.
    distinctId?: string;
  } & RenderObservabilityTelemetryPayload,
): void {
  trackEvent(
    "render_complete",
    {
      duration_ms: props.durationMs,
      fps: props.fps,
      quality: props.quality,
      authoring_skill: props.authoringSkill,
      workers: props.workers,
      docker: props.docker,
      gpu: props.gpu,
      static_dedup_enabled: props.staticDedupEnabled,
      static_dedup_armed: props.staticDedupArmed,
      static_dedup_skip_reason: props.staticDedupSkipReason,
      static_dedup_predicted_frames: props.staticDedupPredictedFrames,
      static_dedup_reused_frames: props.staticDedupReusedFrames,
      de_capture_mode: props.deCaptureMode,
      de_compile_gate: props.deCompileGate,
      de_clamp_reason: props.deClampReason,
      de_gate_reason: props.deGateReason,
      de_worker_encode: props.deWorkerEncode,
      de_verify_armed: props.deVerifyArmed,
      de_verify_checked: props.deVerifyChecked,
      de_verify_min_db: props.deVerifyMinDb,
      de_verify_init_ms: props.deVerifyInitMs,
      de_self_verify_fallback: props.deSelfVerifyFallback,
      de_fallback_reason: props.deFallbackReason,
      de_blank_suspects: props.deBlankSuspects,
      de_blank_deterministic_accepts: props.deBlankDeterministicAccepts,
      de_blank_recaptures: props.deBlankRecaptures,
      de_boundary_frames: props.deBoundaryFrames,
      de_ncpr_fallbacks: props.deNcprFallbacks,
      source: props.source ?? "cli",
      composition_duration_ms: props.compositionDurationMs,
      composition_width: props.compositionWidth,
      composition_height: props.compositionHeight,
      total_frames: props.totalFrames,
      speed_ratio: props.speedRatio,
      capture_avg_ms: props.captureAvgMs,
      capture_p50_ms: props.captureP50Ms,
      video_count: props.videoCount,
      capture_peak_ms: props.capturePeakMs,
      peak_memory_mb: props.peakMemoryMb,
      memory_free_mb: props.memoryFreeMb,
      tmp_peak_bytes: props.tmpPeakBytes,
      stage_compile_ms: props.stageCompileMs,
      stage_video_extract_ms: props.stageVideoExtractMs,
      stage_audio_process_ms: props.stageAudioProcessMs,
      stage_capture_ms: props.stageCaptureMs,
      stage_capture_setup_ms: props.stageCaptureSetupMs,
      stage_capture_frame_ms: props.stageCaptureFrameMs,
      stage_encode_ms: props.stageEncodeMs,
      stage_assemble_ms: props.stageAssembleMs,
      extract_resolve_ms: props.extractResolveMs,
      extract_hdr_probe_ms: props.extractHdrProbeMs,
      extract_hdr_preflight_ms: props.extractHdrPreflightMs,
      extract_hdr_preflight_count: props.extractHdrPreflightCount,
      extract_vfr_probe_ms: props.extractVfrProbeMs,
      extract_vfr_preflight_ms: props.extractVfrPreflightMs,
      extract_vfr_preflight_count: props.extractVfrPreflightCount,
      extract_phase3_ms: props.extractPhase3Ms,
      extract_cache_hits: props.extractCacheHits,
      extract_cache_misses: props.extractCacheMisses,
      ...renderObservabilityEventProperties(props),
    },
    props.distinctId,
  );
}

export function trackRenderError(
  props: {
    fps: number;
    quality: string;
    /** Authoring workflow skill that drove this render (e.g. "product-launch-video"). */
    authoringSkill?: string;
    docker: boolean;
    workers?: number;
    gpu?: boolean;
    source?: "cli" | "studio";
    failedStage?: string;
    errorMessage?: string;
    elapsedMs?: number;
    peakMemoryMb?: number;
    memoryFreeMb?: number;
    // Attribute this event to a specific user (e.g. the browser user who
    // triggered a studio render); defaults to the install anonymousId.
    distinctId?: string;
  } & RenderObservabilityTelemetryPayload,
): void {
  trackEvent(
    "render_error",
    {
      fps: props.fps,
      quality: props.quality,
      authoring_skill: props.authoringSkill,
      docker: props.docker,
      workers: props.workers,
      gpu: props.gpu,
      source: props.source ?? "cli",
      failed_stage: props.failedStage,
      error_message: props.errorMessage ? redactTelemetryMessage(props.errorMessage) : undefined,
      elapsed_ms: props.elapsedMs,
      peak_memory_mb: props.peakMemoryMb,
      memory_free_mb: props.memoryFreeMb,
      ...renderObservabilityEventProperties(props),
    },
    props.distinctId,
  );
}

export function trackRenderObservation(props: {
  source?: "cli" | "studio";
  renderJobId?: string;
  phase?: string;
  status?: string;
  compositionHash?: string;
  elapsedMs?: number;
  durationMs?: number;
  message?: string;
  workerCount?: number;
  forceScreenshot?: boolean;
  useStreamingEncode?: boolean;
  useLayeredComposite?: boolean;
  usePageSideCompositing?: boolean;
  hasHdrContent?: boolean;
  captureMode?: string;
  videoCount?: number;
  extractedVideoCount?: number;
  totalFramesExtracted?: number;
  maxFramesPerVideo?: number;
  avgFramesPerExtractedVideo?: number;
  vfrPreflightCount?: number;
  vfrPreflightMs?: number;
  cacheHits?: number;
  cacheMisses?: number;
}): void {
  trackEvent("render_observation", {
    source: props.source ?? "cli",
    render_job_id: props.renderJobId,
    phase: props.phase,
    status: props.status,
    composition_hash: props.compositionHash,
    elapsed_ms: props.elapsedMs,
    duration_ms: props.durationMs,
    message: props.message ? redactTelemetryMessage(props.message) : undefined,
    worker_count: props.workerCount,
    force_screenshot: props.forceScreenshot,
    use_streaming_encode: props.useStreamingEncode,
    use_layered_composite: props.useLayeredComposite,
    use_page_side_compositing: props.usePageSideCompositing,
    has_hdr_content: props.hasHdrContent,
    capture_mode: props.captureMode,
    video_count: props.videoCount,
    extracted_video_count: props.extractedVideoCount,
    total_frames_extracted: props.totalFramesExtracted,
    max_frames_per_video: props.maxFramesPerVideo,
    avg_frames_per_extracted_video: props.avgFramesPerExtractedVideo,
    vfr_preflight_count: props.vfrPreflightCount,
    vfr_preflight_ms: props.vfrPreflightMs,
    extract_cache_hits: props.cacheHits,
    extract_cache_misses: props.cacheMisses,
  });
}

export function trackInitTemplate(templateId: string, props?: { tailwind?: boolean }): void {
  trackEvent("init_template", { template: templateId, tailwind: props?.tailwind });
}

export function trackBrowserInstall(): void {
  trackEvent("browser_install", {});
}

// Sign-in lifecycle. The CLI tracks command and render lifecycles but never
// authentication, so `auth login` outcomes are invisible on the observability
// dashboards — a completed sign-in, a browser flow the user abandoned, and a
// rejected key all look identical (i.e. absent). These three events close that
// gap so the sign-in funnel is measurable like the render funnel already is.
// `method` is "oauth" (the default browser PKCE flow) or "api_key". No token,
// key, identity, email, or free text is ever attached — only the method and a
// low-cardinality outcome/reason.
//
// The three trackers accept an optional `distinctId`, forwarded to trackEvent
// exactly like trackRenderComplete/trackRenderError already do. It is unused
// today (events attribute to the install's anonymousId), but pre-plumbing it
// makes attributing a completed sign-in to a resolved identity later a one-line
// change at the callsite rather than a signature sweep.
export type AuthLoginMethod = "oauth" | "api_key";
export type AuthLoginFailureReason =
  | "flow_error" // OAuth authorization/exchange threw a real error
  | "flow_timeout" // OAuth callback wait elapsed (user closed the tab / walked away)
  | "no_credential" // flow reported success but nothing was persisted
  | "rejected" // backend rejected the supplied API key (401)
  | "invalid_input" // key was empty, header-unsafe, or too short
  | "aborted"; // prompt cancelled, or no key arrived on stdin before timeout

export function trackAuthLoginStarted(method: AuthLoginMethod, distinctId?: string): void {
  trackEvent("auth_login_started", { method }, distinctId);
}

export function trackAuthLoginCompleted(method: AuthLoginMethod, distinctId?: string): void {
  trackEvent("auth_login_completed", { method }, distinctId);
}

export function trackAuthLoginFailed(
  method: AuthLoginMethod,
  reason: AuthLoginFailureReason,
  distinctId?: string,
): void {
  trackEvent("auth_login_failed", { method, reason }, distinctId);
}

// A render was rejected by the output-resolution/alpha/HDR pre-flight (P1-3)
// before any browser/ffmpeg work. Counts the "caught early" saves on dashboard
// 1783183, distinct from deep render failures. `kind` is the low-cardinality
// `OutputResolutionIssueKind` (aspect-mismatch / alpha-incompatible / etc.),
// typed to the union so the metric can never carry free text.
export function trackRenderPreflightRejected(props: { kind: OutputResolutionIssueKind }): void {
  trackEvent("render_preflight_rejected", { kind: props.kind });
}

export function trackCliError(props: {
  error_name: string;
  error_message: string;
  stack_trace?: string;
  command?: string;
  kind: "uncaught_exception" | "unhandled_rejection" | "command_error";
}): void {
  trackEvent("cli_error", {
    error_name: props.error_name,
    // Redact before truncating — CLI messages and stack traces carry absolute
    // install paths (/Users/...), cache dirs, and user-supplied args. Same
    // redaction the render_* events already apply.
    error_message: redactTelemetryMessage(props.error_message).slice(0, 1000),
    stack_trace: props.stack_trace
      ? redactTelemetryMessage(props.stack_trace).slice(0, 2000)
      : undefined,
    command: props.command,
    kind: props.kind,
  });
}

/**
 * One figma import outcome (asset/tokens/component). Carries capability mix,
 * dedup effectiveness, and fidelity-degradation counts — never fileKeys,
 * node ids, names, or descriptions.
 */
export function trackFigmaImport(props: {
  phase: "asset" | "tokens" | "component";
  durationMs: number;
  reused?: boolean;
  tokensMode?: "variables" | "styles";
  entryCount?: number;
  unresolvedBindings?: number;
  rasterizedNodes?: number;
}): void {
  trackEvent("figma_import", {
    phase: props.phase,
    duration_ms: props.durationMs,
    ...(props.reused !== undefined ? { reused: props.reused } : {}),
    ...(props.tokensMode !== undefined ? { tokens_mode: props.tokensMode } : {}),
    ...(props.entryCount !== undefined ? { entry_count: props.entryCount } : {}),
    ...(props.unresolvedBindings !== undefined
      ? { unresolved_bindings: props.unresolvedBindings }
      : {}),
    ...(props.rasterizedNodes !== undefined ? { rasterized_nodes: props.rasterizedNodes } : {}),
  });
}

// Report why a command failed before it exits non-zero. cli_command_result
// records the failure but not the reason; this fills that gap via cli_error so
// command failures are diagnosable. Enqueues synchronously — the process `exit`
// handler flushes it. Drop this into any command's failure path.
export function trackCommandFailure(command: string, err: unknown): void {
  const error = err instanceof Error ? err : new Error(String(err));
  trackCliError({
    error_name: error.name,
    error_message: error.message,
    stack_trace: error.stack,
    command,
    kind: "command_error",
  });
}

// Whisper being absent/uninstallable is an environment prerequisite gap, not a
// command crash — track it on its own low-severity metric instead of cli_error
// so the command-failure budget reflects real bugs. `optional` records whether
// the caller (init / skill pipeline) treated captions as skippable.
export function trackTranscribeUnavailable(props: { optional: boolean }): void {
  trackEvent("transcribe_unavailable", { optional: props.optional });
}

// A skills install was skipped because a required prerequisite binary is
// absent from PATH (e.g. git on a fresh Windows box). Best-effort callers
// (init) skip cleanly rather than crash, so the skip is otherwise invisible;
// this surfaces the rare environments that hit it. `reason` is a low-cardinality
// binary tag (e.g. "git_missing"), never a path or free text.
export function trackSkillsInstallSkipped(props: { reason: string }): void {
  trackEvent("cli skill install skipped", { reason: props.reason });
}

export function trackRenderFeedback(props: {
  rating: number;
  renderDurationMs?: number;
  comment?: string;
  doctorSummary?: string;
}): void {
  trackEvent("survey sent", {
    $survey_id: "render_satisfaction",
    $survey_response: props.rating,
    ...(props.comment ? { $survey_response_2: props.comment } : {}),
    ...(props.renderDurationMs !== undefined ? { render_duration_ms: props.renderDurationMs } : {}),
    ...(props.doctorSummary ? { doctor_summary: props.doctorSummary } : {}),
  });
}

export function trackCommandResult(props: {
  command: string;
  success: boolean;
  exitCode: number;
  durationMs: number;
}): void {
  trackEvent("cli_command_result", {
    command: props.command,
    success: props.success,
    exit_code: props.exitCode,
    duration_ms: props.durationMs,
  });
}

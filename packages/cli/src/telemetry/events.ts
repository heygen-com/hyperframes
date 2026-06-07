import { redactTelemetryString } from "@hyperframes/core";
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
    workers?: number;
    docker: boolean;
    gpu: boolean;
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
  } & RenderObservabilityTelemetryPayload,
): void {
  trackEvent("render_complete", {
    duration_ms: props.durationMs,
    fps: props.fps,
    quality: props.quality,
    workers: props.workers,
    docker: props.docker,
    gpu: props.gpu,
    source: props.source ?? "cli",
    composition_duration_ms: props.compositionDurationMs,
    composition_width: props.compositionWidth,
    composition_height: props.compositionHeight,
    total_frames: props.totalFrames,
    speed_ratio: props.speedRatio,
    capture_avg_ms: props.captureAvgMs,
    capture_peak_ms: props.capturePeakMs,
    peak_memory_mb: props.peakMemoryMb,
    memory_free_mb: props.memoryFreeMb,
    tmp_peak_bytes: props.tmpPeakBytes,
    stage_compile_ms: props.stageCompileMs,
    stage_video_extract_ms: props.stageVideoExtractMs,
    stage_audio_process_ms: props.stageAudioProcessMs,
    stage_capture_ms: props.stageCaptureMs,
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
  });
}

export function trackRenderError(
  props: {
    fps: number;
    quality: string;
    docker: boolean;
    workers?: number;
    gpu?: boolean;
    source?: "cli" | "studio";
    failedStage?: string;
    errorMessage?: string;
    elapsedMs?: number;
    peakMemoryMb?: number;
    memoryFreeMb?: number;
  } & RenderObservabilityTelemetryPayload,
): void {
  trackEvent("render_error", {
    fps: props.fps,
    quality: props.quality,
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
  });
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

export function trackCliError(props: {
  error_name: string;
  error_message: string;
  stack_trace?: string;
  command?: string;
  kind: "uncaught_exception" | "unhandled_rejection" | "command_error";
}): void {
  trackEvent("cli_error", {
    error_name: props.error_name,
    error_message: props.error_message.slice(0, 1000),
    stack_trace: props.stack_trace?.slice(0, 2000),
    command: props.command,
    kind: props.kind,
  });
}

export function trackRenderFeedback(props: {
  rating: number;
  renderDurationMs: number;
  comment?: string;
  doctorSummary?: string;
}): void {
  trackEvent("survey sent", {
    $survey_id: "render_satisfaction",
    $survey_response: props.rating,
    ...(props.comment ? { $survey_response_2: props.comment } : {}),
    render_duration_ms: props.renderDurationMs,
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

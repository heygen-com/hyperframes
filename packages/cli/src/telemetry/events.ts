import { trackEvent } from "./client.js";

export function trackCommand(command: string): void {
  trackEvent("cli_command", { command });
}

export function trackRenderComplete(props: {
  durationMs: number;
  fps: number;
  quality: string;
  workers: number;
  docker: boolean;
  gpu: boolean;
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
}): void {
  trackEvent("render_complete", {
    duration_ms: props.durationMs,
    fps: props.fps,
    quality: props.quality,
    workers: props.workers,
    docker: props.docker,
    gpu: props.gpu,
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
  });
}

export function trackRenderError(props: {
  fps: number;
  quality: string;
  docker: boolean;
  workers?: number;
  gpu?: boolean;
  failedStage?: string;
  errorMessage?: string;
  elapsedMs?: number;
  peakMemoryMb?: number;
  memoryFreeMb?: number;
}): void {
  trackEvent("render_error", {
    fps: props.fps,
    quality: props.quality,
    docker: props.docker,
    workers: props.workers,
    gpu: props.gpu,
    failed_stage: props.failedStage,
    error_message: props.errorMessage,
    elapsed_ms: props.elapsedMs,
    peak_memory_mb: props.peakMemoryMb,
    memory_free_mb: props.memoryFreeMb,
  });
}

export function trackInitTemplate(templateId: string): void {
  trackEvent("init_template", { template: templateId });
}

export function trackBrowserInstall(): void {
  trackEvent("browser_install", {});
}

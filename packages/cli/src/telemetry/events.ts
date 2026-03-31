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

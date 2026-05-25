// ---------------------------------------------------------------------------
// Maps studio-triggered renders into the existing `render_complete` /
// `render_error` telemetry events with `source: "studio"`, so they land
// alongside CLI renders in one unified taxonomy.
//
// Kept in its own file so `studioServer.ts` only needs two function calls.
// ---------------------------------------------------------------------------

import { freemem } from "node:os";
import type { Fps } from "@hyperframes/core";
import { fpsToNumber } from "@hyperframes/core";
import type { RenderPerfSummary } from "@hyperframes/producer";
import { trackRenderComplete, trackRenderError } from "../telemetry/events.js";
import { bytesToMb } from "../telemetry/system.js";

export interface StudioRenderOpts {
  fps: Fps;
  quality: string;
}

type RenderCompleteProps = Parameters<typeof trackRenderComplete>[0];

function memSnapshot(): { peakMemoryMb: number; memoryFreeMb: number } {
  return {
    peakMemoryMb: bytesToMb(process.memoryUsage.rss()),
    memoryFreeMb: bytesToMb(freemem()),
  };
}

function stagesPayload(stages: Record<string, number>): Partial<RenderCompleteProps> {
  return {
    stageCompileMs: stages.compileMs,
    stageVideoExtractMs: stages.videoExtractMs,
    stageAudioProcessMs: stages.audioProcessMs,
    stageCaptureMs: stages.captureMs,
    stageEncodeMs: stages.encodeMs,
    stageAssembleMs: stages.assembleMs,
  };
}

function extractPayload(
  extract: RenderPerfSummary["videoExtractBreakdown"],
): Partial<RenderCompleteProps> {
  if (!extract) return {};
  return {
    extractResolveMs: extract.resolveMs,
    extractHdrProbeMs: extract.hdrProbeMs,
    extractHdrPreflightMs: extract.hdrPreflightMs,
    extractHdrPreflightCount: extract.hdrPreflightCount,
    extractVfrProbeMs: extract.vfrProbeMs,
    extractVfrPreflightMs: extract.vfrPreflightMs,
    extractVfrPreflightCount: extract.vfrPreflightCount,
    extractPhase3Ms: extract.extractMs,
    extractCacheHits: extract.cacheHits,
    extractCacheMisses: extract.cacheMisses,
  };
}

function perfPayload(
  perf: RenderPerfSummary | undefined,
  elapsedMs: number,
): Partial<RenderCompleteProps> {
  if (!perf) return {};
  const compositionDurationMs = Math.round(perf.compositionDurationSeconds * 1000);
  const speedRatio =
    compositionDurationMs > 0 && elapsedMs > 0
      ? Math.round((compositionDurationMs / elapsedMs) * 100) / 100
      : undefined;
  return {
    workers: perf.workers,
    compositionDurationMs,
    compositionWidth: perf.resolution.width,
    compositionHeight: perf.resolution.height,
    totalFrames: perf.totalFrames,
    speedRatio,
    captureAvgMs: perf.captureAvgMs,
    capturePeakMs: perf.capturePeakMs,
    tmpPeakBytes: perf.tmpPeakBytes,
    ...stagesPayload(perf.stages),
    ...extractPayload(perf.videoExtractBreakdown),
  };
}

export function emitStudioRenderError(
  opts: StudioRenderOpts,
  elapsedMs: number,
  failedStage: string | undefined,
  err: unknown,
): void {
  // `workers` is intentionally omitted: studio renders don't accept a
  // user-supplied worker count (the producer picks its default), so on early
  // failures we genuinely don't know one. The CLI side has the value from
  // `options.workers` even before `job.perfSummary` exists; studio doesn't.
  trackRenderError({
    fps: fpsToNumber(opts.fps),
    quality: opts.quality,
    docker: false,
    source: "studio",
    failedStage,
    errorMessage: err instanceof Error ? err.message : String(err),
    elapsedMs,
    ...memSnapshot(),
  });
}

export function emitStudioRenderComplete(
  opts: StudioRenderOpts,
  elapsedMs: number,
  perf: RenderPerfSummary | undefined,
): void {
  trackRenderComplete({
    durationMs: elapsedMs,
    fps: fpsToNumber(opts.fps),
    quality: opts.quality,
    docker: false,
    gpu: false,
    source: "studio",
    ...perfPayload(perf, elapsedMs),
    ...memSnapshot(),
  });
}

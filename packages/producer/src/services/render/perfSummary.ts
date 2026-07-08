/**
 * Build the `RenderPerfSummary` that lands on `job.perfSummary` and
 * the `perf-summary.json` debug artifact.
 */

import { fpsToNumber } from "@hyperframes/core";
import type { CapturePerfSummary } from "@hyperframes/engine";
import type { CaptureCalibrationSample, CaptureCostEstimate } from "./captureCost.js";
import type {
  CaptureAttemptSummary,
  HdrDiagnostics,
  RenderJob,
  RenderPerfSummary,
} from "../renderOrchestrator.js";
import { type HdrPerfCollector, finalizeHdrPerf } from "./hdrPerf.js";
import type { RenderObservabilitySummary } from "./observability.js";

/**
 * Append each parallel worker's static-dedup perf into the render-level sink
 * (skipping workers that reported none). Shared by the disk + streaming parallel
 * paths so the collection contract lives in one place.
 */
export function pushWorkerDedupPerfs(
  results: ReadonlyArray<{ perf?: CapturePerfSummary }>,
  sink: CapturePerfSummary[],
): void {
  for (const r of results) {
    if (r.perf) sink.push(r.perf);
  }
}

/**
 * Collapse per-session/per-worker static-dedup perf into one render-level
 * outcome. enabled/armed = OR across workers (they run the same gates on the
 * same composition); predicted/reused = SUM (each worker dedups its own frame
 * range); skipReason = the distinct reasons (sorted, `|`-joined) when not armed.
 */
/**
 * Collapse per-session capture perf + producer-side decisions into the
 * render-level drawElement outcome. mode/gateReason |-join distinct values
 * across workers (bounded cardinality); counters SUM.
 */
/** Orchestrator-supplied render-level drawElement outcome (one shape, used by
 * both the aggregate function and buildRenderPerfSummary's input). */
export interface DrawElementPerfInput {
  compileGate?: string;
  clampReason?: string;
  workerInversion?: "inverted" | "reverted";
  /** Auto-resolved worker count before the inversion pinned it to 1 (set only when the inversion fired). */
  preInversionWorkers?: number;
  selfVerifyFallback: boolean;
  fallbackReason?: string;
  drainStats?: {
    verifyChecked: number;
    verifyMinDb?: number;
    blankSuspects: number;
    blankDeterministicAccepts: number;
    blankRecaptures: number;
  };
}

// Flat field mapping — branches are ?? fallbacks, not logic.
// fallow-ignore-next-line complexity
function aggregateDrawElement(
  perfs: CapturePerfSummary[],
  de: DrawElementPerfInput,
): RenderPerfSummary["drawElement"] {
  if (perfs.length === 0) return undefined;
  const modes = [...new Set(perfs.map((p) => p.captureMode).filter(Boolean))].sort();
  const gateReasons = [
    ...new Set(perfs.map((p) => p.deGateReason).filter((r): r is string => !!r)),
  ].sort();
  const drain = de.drainStats;
  return {
    mode: modes.join("|") || "unknown",
    compileGate: de.compileGate,
    clampReason: de.clampReason,
    workerInversion: de.workerInversion ?? "none",
    preInversionWorkers: de.preInversionWorkers,
    gateReason: gateReasons.length > 0 ? gateReasons.join("|") : undefined,
    workerEncode: perfs.some((p) => p.deWorkerEncode),
    verifyArmed: perfs.reduce((sum, p) => sum + (p.deVerifyArmed ?? 0), 0),
    verifyChecked: drain?.verifyChecked ?? 0,
    verifyMinDb:
      drain?.verifyMinDb === undefined
        ? undefined
        : Math.round(Math.min(drain.verifyMinDb, 999) * 10) / 10,
    verifyInitMs: perfs.reduce((sum, p) => sum + (p.deVerifyInitMs ?? 0), 0),
    selfVerifyFallback: de.selfVerifyFallback,
    fallbackReason: de.fallbackReason,
    blankSuspects: drain?.blankSuspects ?? 0,
    blankDeterministicAccepts: drain?.blankDeterministicAccepts ?? 0,
    blankRecaptures: drain?.blankRecaptures ?? 0,
    boundaryFrames: perfs.reduce((sum, p) => sum + (p.deBoundaryFrames ?? 0), 0),
    ncprFallbacks: perfs.reduce((sum, p) => sum + (p.deNcprFallbacks ?? 0), 0),
  };
}

function aggregateDedup(perfs: CapturePerfSummary[]): RenderPerfSummary["staticDedup"] {
  if (perfs.length === 0) return undefined;
  const armed = perfs.some((p) => p.staticDedupArmed);
  // When unarmed, report every DISTINCT skip reason across workers (sorted, joined)
  // rather than just the first — workers can diverge (e.g. one `ineligible`, one
  // `capture_mode`), and dropping the rest hides why dedup didn't engage. Cardinality
  // stays bounded (a handful of codes, small combinations).
  const skipReasons = armed
    ? []
    : [
        ...new Set(perfs.map((p) => p.staticDedupSkipReason).filter((r): r is string => !!r)),
      ].sort();
  return {
    enabled: perfs.some((p) => p.staticDedupEnabled),
    armed,
    predictedFrames: perfs.reduce((sum, p) => sum + (p.staticDedupPredicted ?? 0), 0),
    reusedFrames: perfs.reduce((sum, p) => sum + (p.staticDedupReused ?? 0), 0),
    skipReason: skipReasons.length > 0 ? skipReasons.join("|") : undefined,
  };
}

export function buildRenderPerfSummary(input: {
  job: RenderJob;
  workerCount: number;
  enableChunkedEncode: boolean;
  chunkedEncodeSize: number;
  compositionDurationSeconds: number;
  totalFrames: number;
  outputWidth: number;
  outputHeight: number;
  videoCount: number;
  audioCount: number;
  totalElapsedMs: number;
  perfStages: Record<string, number>;
  videoExtractBreakdown: RenderPerfSummary["videoExtractBreakdown"];
  tmpPeakBytes: number;
  captureCalibration?: {
    estimate: CaptureCostEstimate;
    samples: CaptureCalibrationSample[];
  };
  captureAttempts: CaptureAttemptSummary[];
  hdrDiagnostics: HdrDiagnostics;
  hdrPerf?: HdrPerfCollector;
  observability?: RenderObservabilitySummary;
  peakRssBytes: number;
  peakHeapUsedBytes: number;
  /** Per-session/per-worker static-dedup perf; aggregated into `staticDedup`. */
  dedupPerfs: CapturePerfSummary[];
  drawElement?: DrawElementPerfInput;
}): RenderPerfSummary {
  return {
    renderId: input.job.id,
    totalElapsedMs: input.totalElapsedMs,
    // RenderPerfSummary surfaces fps as a decimal because it lands in JSON
    // payloads (CLI telemetry, regression-harness reports) where a single
    // number is friendlier than `{num,den}`. Callers needing the rational
    // back can read `job.config.fps`.
    fps: fpsToNumber(input.job.config.fps),
    quality: input.job.config.quality,
    workers: input.workerCount,
    chunkedEncode: input.enableChunkedEncode,
    chunkSizeFrames: input.enableChunkedEncode ? input.chunkedEncodeSize : null,
    compositionDurationSeconds: input.compositionDurationSeconds,
    totalFrames: input.totalFrames,
    resolution: { width: input.outputWidth, height: input.outputHeight },
    videoCount: input.videoCount,
    audioCount: input.audioCount,
    stages: input.perfStages,
    videoExtractBreakdown: input.videoExtractBreakdown,
    tmpPeakBytes: input.tmpPeakBytes,
    captureCalibration: input.captureCalibration
      ? {
          sampledFrames: input.captureCalibration.samples.map((sample) => sample.frameIndex),
          p95Ms: input.captureCalibration.estimate.p95Ms,
          multiplier: input.captureCalibration.estimate.multiplier,
          reasons: input.captureCalibration.estimate.reasons,
        }
      : undefined,
    captureAttempts: input.captureAttempts.length > 0 ? input.captureAttempts : undefined,
    hdrDiagnostics:
      input.hdrDiagnostics.videoExtractionFailures > 0 ||
      input.hdrDiagnostics.imageDecodeFailures > 0
        ? { ...input.hdrDiagnostics }
        : undefined,
    hdrPerf: input.hdrPerf ? finalizeHdrPerf(input.hdrPerf) : undefined,
    observability: input.observability,
    captureAvgMs:
      input.totalFrames > 0
        ? Math.round(
            (input.perfStages.captureFrameMs ?? input.perfStages.captureMs ?? 0) /
              input.totalFrames,
          )
        : undefined,
    captureP50Ms: (() => {
      // Per-frame median from the engine's samples; when parallel workers
      // report separately, take the busiest session's median.
      const withSamples = input.dedupPerfs.filter((p) => (p.p50TotalMs ?? 0) > 0);
      if (withSamples.length === 0) return undefined;
      return withSamples.reduce((a, b) => (b.frames > a.frames ? b : a)).p50TotalMs;
    })(),
    peakRssMb: Math.round(input.peakRssBytes / (1024 * 1024)),
    peakHeapUsedMb: Math.round(input.peakHeapUsedBytes / (1024 * 1024)),
    staticDedup: aggregateDedup(input.dedupPerfs),
    drawElement: aggregateDrawElement(
      input.dedupPerfs,
      input.drawElement ?? { selfVerifyFallback: false },
    ),
  };
}

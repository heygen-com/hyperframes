/**
 * Build the `RenderPerfSummary` that lands on `job.perfSummary` and
 * the `perf-summary.json` debug artifact.
 */

import { fpsToNumber } from "@hyperframes/core";
import type { CaptureCalibrationSample, CaptureCostEstimate } from "./captureCost.js";
import type {
  CaptureAttemptSummary,
  HdrDiagnostics,
  RenderJob,
  RenderPerfSummary,
} from "../renderOrchestrator.js";
import { type HdrPerfCollector, finalizeHdrPerf } from "./hdrPerf.js";
import type { RenderObservabilitySummary } from "./observability.js";

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
        ? Math.round((input.perfStages.captureMs ?? 0) / input.totalFrames)
        : undefined,
    peakRssMb: Math.round(input.peakRssBytes / (1024 * 1024)),
    peakHeapUsedMb: Math.round(input.peakHeapUsedBytes / (1024 * 1024)),
  };
}

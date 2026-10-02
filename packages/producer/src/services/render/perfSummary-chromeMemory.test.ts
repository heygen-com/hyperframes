import { describe, it, expect } from "vitest";
import type { CapturePerfSummary } from "@hyperframes/engine";
import { buildRenderPerfSummary } from "./perfSummary.js";
import { createRenderJob } from "../renderOrchestrator.js";

function baseInput(
  dedupPerfs: CapturePerfSummary[],
  overrides: Partial<Parameters<typeof buildRenderPerfSummary>[0]> = {},
) {
  return {
    job: createRenderJob({ fps: { num: 30, den: 1 }, quality: "high" }),
    workerCount: dedupPerfs.length || 1,
    enableChunkedEncode: false,
    chunkedEncodeSize: 0,
    compositionDurationSeconds: 5,
    totalFrames: 150,
    outputWidth: 1920,
    outputHeight: 1080,
    videoCount: 0,
    audioCount: 0,
    totalElapsedMs: 1000,
    perfStages: {},
    videoExtractBreakdown: undefined,
    tmpPeakBytes: 0,
    captureAttempts: [],
    hdrDiagnostics: { videoExtractionFailures: 0, imageDecodeFailures: 0 },
    peakRssBytes: 0,
    peakHeapUsedBytes: 0,
    dedupPerfs,
    ...overrides,
  };
}

function perf(overrides: Partial<CapturePerfSummary>): CapturePerfSummary {
  return {
    frames: 10,
    avgTotalMs: 1,
    avgSeekMs: 1,
    avgBeforeCaptureMs: 0,
    avgScreenshotMs: 0,
    staticDedupReused: 0,
    staticDedupEnabled: false,
    staticDedupArmed: false,
    staticDedupPredicted: 0,
    ...overrides,
  };
}

describe("aggregateChromeMemory", () => {
  it("takes the max peak across workers and the sum of samples", () => {
    const summary = buildRenderPerfSummary(
      baseInput([
        perf({
          chromeBrowserRssPeakMb: 100,
          chromeRendererRssPeakMb: 900,
          chromeRssLastMb: 1000,
          chromeGpuProcessSeenLastSample: true,
          chromeMemorySamples: 5,
        }),
        perf({
          chromeBrowserRssPeakMb: 120,
          chromeRendererRssPeakMb: 700,
          chromeRssLastMb: 800,
          chromeGpuProcessSeenLastSample: false,
          chromeMemorySamples: 4,
        }),
      ]),
    );
    expect(summary.chromeMemory).toEqual({
      browserRssPeakMb: 120,
      rendererRssPeakMb: 900,
      rssLastMb: 1800,
      gpuProcessSeenLastSample: true,
      samples: 9,
    });
  });

  it("is undefined when no session sampled", () => {
    const summary = buildRenderPerfSummary(baseInput([perf({})]));
    expect(summary.chromeMemory).toBeUndefined();
  });

  it("aggregates a mixed fleet where only some workers sampled", () => {
    // A worker whose sampler never produced a reading must not drag the
    // result: no renderer peak invented, and gpuProcessSeenLastSample stays
    // false rather than inheriting the sampling worker's `undefined`.
    const summary = buildRenderPerfSummary(
      baseInput([
        perf({ chromeMemorySamples: 0 }),
        perf({ chromeBrowserRssPeakMb: 42, chromeRssLastMb: 42, chromeMemorySamples: 3 }),
      ]),
    );
    expect(summary.chromeMemory).toEqual({
      browserRssPeakMb: 42,
      rendererRssPeakMb: undefined,
      rssLastMb: 42,
      gpuProcessSeenLastSample: false,
      samples: 3,
    });
  });
});

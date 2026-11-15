import { describe, it, expect } from "vitest";
import type { CapturePerfSummary, PageMotionBlurSummary } from "@hyperframes/engine";
import { buildRenderPerfSummary } from "./perfSummary.js";
import { createRenderJob } from "../renderOrchestrator.js";

function summaryOf(dedupPerfs: CapturePerfSummary[]) {
  return buildRenderPerfSummary({
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
    gpuDisabled: false,
  });
}

const worker = (motionBlur?: Partial<PageMotionBlurSummary>): CapturePerfSummary => ({
  frames: 10,
  avgTotalMs: 1,
  avgSeekMs: 1,
  avgBeforeCaptureMs: 0,
  avgScreenshotMs: 0,
  staticDedupReused: 0,
  staticDedupEnabled: false,
  staticDedupArmed: false,
  staticDedupPredicted: 0,
  motionBlur: motionBlur && {
    tier: "capture",
    reasonCode: null,
    movers: 2,
    failedFrames: 0,
    readEvents: false,
    fingerprint: null,
    ...motionBlur,
  },
});

const counts = (over: Partial<NonNullable<PageMotionBlurSummary["fingerprint"]>>) => ({
  canvas2d: 0,
  webgl: 0,
  video: 0,
  iframe: 0,
  customElement: 0,
  svgClip: 0,
  mask: 0,
  scrollContainer: 0,
  threeD: 0,
  overflowingMover: 0,
  frontOfMover: 0,
  blendMode: 0,
  fixedInMover: 0,
  pseudoOutside: 0,
  ...over,
});

describe("aggregateMotionBlur", () => {
  it("is undefined when blur never ran in a session", () => {
    expect(summaryOf([worker(), worker({ tier: null, movers: 0 })]).motionBlur).toBeUndefined();
  });

  it("sums failed frames across workers and takes the rest from the first that reported", () => {
    const summary = summaryOf([
      worker({ failedFrames: 4, movers: 3, fingerprint: counts({ webgl: 1 }) }),
      worker({ failedFrames: 2, readEvents: true, fingerprint: counts({ video: 2 }) }),
    ]);
    expect(summary.motionBlur).toEqual({
      tier: "capture",
      reasonCode: null,
      movers: 3,
      failedFrames: 6,
      readEvents: true,
      fingerprint: counts({ webgl: 1 }),
    });
  });

  it("skips workers that reported nothing, and keeps a fingerprint a first worker lacked", () => {
    const summary = summaryOf([
      worker(),
      worker({ tier: "filter", reasonCode: "accelerated-canvas" }),
      worker({ tier: "filter", failedFrames: 1, fingerprint: counts({ mask: 5 }) }),
    ]);
    expect(summary.motionBlur).toMatchObject({
      tier: "filter",
      reasonCode: "accelerated-canvas",
      failedFrames: 1,
      fingerprint: counts({ mask: 5 }),
    });
  });

  it("reports failed frames from a session whose blur ended before it named a tier", () => {
    const summary = summaryOf([
      worker({ tier: null, failedFrames: 3, reasonCode: "capture-failures" }),
    ]);
    expect(summary.motionBlur).toMatchObject({ tier: null, failedFrames: 3 });
  });
});

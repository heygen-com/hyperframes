import { describe, expect, it } from "vitest";
import { buildRenderPerfSummary, roundDb } from "./perfSummary.js";
import type { RenderJob } from "../renderOrchestrator.js";

describe("roundDb", () => {
  it("rounds to 1 decimal", () => {
    expect(roundDb(28.4373)).toBe(28.4);
    expect(roundDb(28.45)).toBe(28.5);
  });

  it("clamps at 999 (an Infinity PSNR must never ship literally to telemetry)", () => {
    expect(roundDb(Infinity)).toBe(999);
    expect(roundDb(50000)).toBe(999);
  });

  it("passes undefined through unchanged", () => {
    expect(roundDb(undefined)).toBeUndefined();
  });

  it("is idempotent — rounding an already-rounded value is a no-op", () => {
    expect(roundDb(roundDb(28.4373))).toBe(28.4);
  });
});

// ponytail: minimal stub — only the fields buildRenderPerfSummary reads are real.
const baseInput = {
  job: { id: "r1", config: { fps: { num: 30, den: 1 }, quality: "high" } } as unknown as RenderJob,
  workerCount: 4,
  enableChunkedEncode: false,
  chunkedEncodeSize: 0,
  compositionDurationSeconds: 5,
  totalFrames: 150,
  outputWidth: 1920,
  outputHeight: 1080,
  videoCount: 0,
  audioCount: 0,
  totalElapsedMs: 1234,
  perfStages: {},
  videoExtractBreakdown: undefined,
  tmpPeakBytes: 0,
  captureAttempts: [],
  hdrDiagnostics: { videoExtractionFailures: 0, imageDecodeFailures: 0 },
  peakRssBytes: 0,
  peakHeapUsedBytes: 0,
  dedupPerfs: [],
};

describe("buildRenderPerfSummary host telemetry", () => {
  it("captures host facts and threads gpuDisabled through", () => {
    const summary = buildRenderPerfSummary({ ...baseInput, gpuDisabled: true });
    expect(summary.host).toBeDefined();
    expect(summary.host?.gpuDisabled).toBe(true);
    expect(summary.host?.cpuCount).toBeGreaterThan(0);
    expect(summary.host?.totalMemMb).toBeGreaterThan(0);
    expect(summary.host?.platform).toBe(process.platform);
    expect(summary.host?.arch).toBe(process.arch);
    expect(summary.host?.nodeVersion).toBe(process.version);
  });

  it("reflects gpuDisabled=false", () => {
    const summary = buildRenderPerfSummary({ ...baseInput, gpuDisabled: false });
    expect(summary.host?.gpuDisabled).toBe(false);
    // workers vs cores is the headline correlation — both must be present.
    expect(summary.workers).toBe(4);
  });
});

describe("buildRenderPerfSummary drawElement gate reason", () => {
  it("keeps the probe's gate when the workers that captured report none", () => {
    const summary = buildRenderPerfSummary({
      ...baseInput,
      dedupPerfs: [{ captureMode: "screenshot" }, { captureMode: "screenshot" }],
      drawElement: { probeGateReason: "css_effect:filter", selfVerifyFallback: false },
    } as Parameters<typeof buildRenderPerfSummary>[0]);
    expect(summary.drawElement?.gateReason).toBe("css_effect:filter");
  });
});

describe("buildRenderPerfSummary capture phases", () => {
  it("weights each worker's phase averages by the frames it captured", () => {
    const summary = buildRenderPerfSummary({
      ...baseInput,
      perfStages: { encoderDrainWaitMs: 1500 },
      dedupPerfs: [
        { frames: 100, avgSeekMs: 10, avgBeforeCaptureMs: 4, avgScreenshotMs: 30 },
        { frames: 50, avgSeekMs: 40, avgBeforeCaptureMs: 1, avgScreenshotMs: 60 },
      ],
    } as Parameters<typeof buildRenderPerfSummary>[0]);
    expect(summary.captureSeekAvgMs).toBe(20);
    expect(summary.captureBeforeCaptureAvgMs).toBe(3);
    expect(summary.captureScreenshotAvgMs).toBe(40);
    expect(summary.encoderWaitAvgMs).toBe(10);
  });

  it("leaves the phases unset when no frames or no streaming encoder ran", () => {
    const summary = buildRenderPerfSummary(baseInput);
    expect(summary.captureSeekAvgMs).toBeUndefined();
    expect(summary.encoderWaitAvgMs).toBeUndefined();
  });
});

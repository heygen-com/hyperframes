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

function perf(p: Partial<CapturePerfSummary>): CapturePerfSummary {
  return {
    frames: 0,
    avgTotalMs: 0,
    avgSeekMs: 0,
    avgBeforeCaptureMs: 0,
    avgScreenshotMs: 0,
    staticDedupReused: 0,
    staticDedupEnabled: false,
    staticDedupArmed: false,
    staticDedupPredicted: 0,
    ...p,
  };
}

describe("buildRenderPerfSummary static-dedup aggregation", () => {
  it("is undefined when no capture session ran", () => {
    expect(buildRenderPerfSummary(baseInput([])).staticDedup).toBeUndefined();
  });

  it("SUMs reused/predicted and ORs armed across workers", () => {
    const s = buildRenderPerfSummary(
      baseInput([
        perf({
          staticDedupEnabled: true,
          staticDedupArmed: true,
          staticDedupPredicted: 40,
          staticDedupReused: 30,
        }),
        perf({
          staticDedupEnabled: true,
          staticDedupArmed: false,
          staticDedupSkipReason: "ineligible",
        }),
        perf({
          staticDedupEnabled: true,
          staticDedupArmed: true,
          staticDedupPredicted: 20,
          staticDedupReused: 18,
        }),
      ]),
    ).staticDedup;
    expect(s).toEqual({
      enabled: true,
      armed: true,
      predictedFrames: 60,
      reusedFrames: 48,
      skipReason: undefined, // armed → no skip reason
    });
  });

  it("reports skipReason when no worker armed", () => {
    const s = buildRenderPerfSummary(
      baseInput([
        perf({
          staticDedupEnabled: true,
          staticDedupArmed: false,
          staticDedupSkipReason: "capture_mode",
        }),
      ]),
    ).staticDedup;
    expect(s?.armed).toBe(false);
    expect(s?.skipReason).toBe("capture_mode");
    expect(s?.reusedFrames).toBe(0);
  });

  it("joins DISTINCT skip reasons across diverging unarmed workers (sorted, deduped)", () => {
    const s = buildRenderPerfSummary(
      baseInput([
        perf({
          staticDedupEnabled: true,
          staticDedupArmed: false,
          staticDedupSkipReason: "ineligible",
        }),
        perf({
          staticDedupEnabled: true,
          staticDedupArmed: false,
          staticDedupSkipReason: "capture_mode",
        }),
        perf({
          staticDedupEnabled: true,
          staticDedupArmed: false,
          staticDedupSkipReason: "capture_mode",
        }),
      ]),
    ).staticDedup;
    expect(s?.armed).toBe(false);
    expect(s?.skipReason).toBe("capture_mode|ineligible"); // sorted, deduped
  });

  it("carries enabled=false through (opt-out renders)", () => {
    const s = buildRenderPerfSummary(baseInput([perf({ staticDedupEnabled: false })])).staticDedup;
    expect(s).toEqual({
      enabled: false,
      armed: false,
      predictedFrames: 0,
      reusedFrames: 0,
      skipReason: undefined,
    });
  });
});

describe("buildRenderPerfSummary capture average attribution", () => {
  it("uses frame-capture time for captureAvgMs instead of setup-inclusive captureMs", () => {
    const summary = buildRenderPerfSummary(
      baseInput([], {
        totalFrames: 120,
        perfStages: {
          captureMs: 5_100,
          captureSetupMs: 1_860,
          captureFrameMs: 3_240,
        },
      }),
    );

    expect(summary.captureAvgMs).toBe(27);
  });

  it("falls back to legacy captureMs when captureFrameMs is absent", () => {
    const summary = buildRenderPerfSummary(
      baseInput([], {
        totalFrames: 120,
        perfStages: {
          captureMs: 5_100,
        },
      }),
    );

    expect(summary.captureAvgMs).toBe(43);
  });
});

describe("buildRenderPerfSummary beginframe no-damage reuse aggregation", () => {
  it("is undefined when no capture session ran", () => {
    expect(buildRenderPerfSummary(baseInput([])).beginFrameReuse).toBeUndefined();
  });

  it("is undefined when no session captured in beginframe mode (both counters zero)", () => {
    const s = buildRenderPerfSummary(
      baseInput([perf({ staticDedupEnabled: true, staticDedupReused: 10 })]),
    ).beginFrameReuse;
    expect(s).toBeUndefined();
  });

  it("SUMs no-damage and has-damage frames across workers", () => {
    const s = buildRenderPerfSummary(
      baseInput([
        perf({ beginFrameNoDamage: 240, beginFrameHasDamage: 160 }),
        perf({ beginFrameNoDamage: 245, beginFrameHasDamage: 155 }),
        perf({ beginFrameNoDamage: 235, beginFrameHasDamage: 165 }),
      ]),
    ).beginFrameReuse;
    expect(s).toEqual({ noDamageFrames: 720, hasDamageFrames: 480 });
  });

  it("reports an all-damage beginframe render (noDamageFrames 0, not undefined)", () => {
    const s = buildRenderPerfSummary(
      baseInput([perf({ beginFrameNoDamage: 0, beginFrameHasDamage: 400 })]),
    ).beginFrameReuse;
    expect(s).toEqual({ noDamageFrames: 0, hasDamageFrames: 400 });
  });
});

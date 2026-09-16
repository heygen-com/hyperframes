import { describe, expect, it } from "bun:test";
import { recordJobFailureMetrics, resolveBrowserMediaEnd } from "./shared.js";

describe("resolveBrowserMediaEnd", () => {
  it("prefers a runtime duration over a stale compiler-clamped end", () => {
    expect(resolveBrowserMediaEnd(0, 5.04, 56.738)).toBe(56.738);
  });

  it("projects a runtime duration from the browser-local start", () => {
    expect(resolveBrowserMediaEnd(2, 7.04, 56.738)).toBe(58.738);
  });

  it("falls back to data-end when runtime duration is unavailable", () => {
    expect(resolveBrowserMediaEnd(0, 5.04, Number.NaN)).toBe(5.04);
    expect(resolveBrowserMediaEnd(0, 5.04, 0)).toBe(5.04);
  });
});

describe("recordJobFailureMetrics", () => {
  const sampler = {
    peakRssBytes: () => 300 * 1024 * 1024,
    peakHeapUsedBytes: () => 120 * 1024 * 1024,
  };

  // The whole point: perfSummary is success-only, so a thrown render must
  // still leave sizing + peaks on the job for render_error to read.
  it("copies sampled peaks and sizing onto the job", () => {
    const job: { peakRssMb?: number; peakHeapUsedMb?: number; workerSizing?: { workers: number } } =
      {};
    recordJobFailureMetrics(job, sampler, { workers: 6 });
    expect(job.peakRssMb).toBe(300);
    expect(job.peakHeapUsedMb).toBe(120);
    expect(job.workerSizing).toEqual({ workers: 6 });
  });

  it("records peaks even when sizing was never computed (failure before capture)", () => {
    const job: { peakRssMb?: number; peakHeapUsedMb?: number; workerSizing?: { workers: number } } =
      {};
    recordJobFailureMetrics(job, sampler, undefined);
    expect(job.peakRssMb).toBe(300);
    expect(job.workerSizing).toBeUndefined();
  });

  it("keeps an already-recorded sizing rather than blanking it", () => {
    const job: { peakRssMb?: number; peakHeapUsedMb?: number; workerSizing?: { workers: number } } =
      {
        workerSizing: { workers: 4 },
      };
    recordJobFailureMetrics(job, null, undefined);
    expect(job.workerSizing).toEqual({ workers: 4 });
    expect(job.peakRssMb).toBeUndefined();
  });
});

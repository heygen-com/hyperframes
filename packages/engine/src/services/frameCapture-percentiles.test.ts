/**
 * Tests for the `percentileOf` helper added alongside the fast-capture
 * fallback profiling diagnostic (PR: `feat(engine): opt-in per-frame
 * timing on fast-capture fallback path`).
 *
 * The helper feeds the `capture_fallback_profile` observability checkpoint
 * — a diagnostic-only surface that has to give reviewers of future fallback
 * perf regressions a *trustworthy* number, so the percentile math is
 * pinned by these tests rather than left as read-through-the-caller
 * behavior.
 *
 * Nearest-rank semantics were chosen to match the existing `medianOf` p50
 * helper (`sorted[Math.floor(sorted.length / 2)]`) so p50 and p95/p99 stay
 * comparable — an interpolated-percentile answer would differ from the p50
 * emission for small sample sets and make cross-percentile reads confusing.
 */

import { describe, expect, it } from "vitest";
import { percentileOf } from "./frameCapture.js";

describe("percentileOf", () => {
  it("returns 0 for empty samples (matches medianOf's empty behavior)", () => {
    expect(percentileOf([], 0.5)).toBe(0);
    expect(percentileOf([], 0.95)).toBe(0);
    expect(percentileOf([], 0.99)).toBe(0);
  });

  it("returns the sole sample regardless of percentile for length-1 input", () => {
    expect(percentileOf([42], 0.5)).toBe(42);
    expect(percentileOf([42], 0.95)).toBe(42);
    expect(percentileOf([42], 0.99)).toBe(42);
  });

  it("computes nearest-rank percentiles on a fixed 100-sample ramp (1..100)", () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    // floor(0.5 * 100) = 50 → sorted[50] = 51
    expect(percentileOf(samples, 0.5)).toBe(51);
    // floor(0.95 * 100) = 95 → sorted[95] = 96
    expect(percentileOf(samples, 0.95)).toBe(96);
    // floor(0.99 * 100) = 99 → sorted[99] = 100
    expect(percentileOf(samples, 0.99)).toBe(100);
  });

  it("clamps p=1 (would land at length) to the last sample rather than out-of-range", () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    // floor(1.0 * 100) = 100 → clamped to sorted[99] = 100
    expect(percentileOf(samples, 1.0)).toBe(100);
  });

  it("does not require pre-sorted input (sorts a shuffled sample set)", () => {
    const samples = [10, 3, 7, 1, 5, 9, 2, 8, 4, 6];
    // sorted = [1..10]; floor(0.5*10)=5 → sorted[5]=6
    expect(percentileOf(samples, 0.5)).toBe(6);
    // floor(0.95*10)=9 → sorted[9]=10
    expect(percentileOf(samples, 0.95)).toBe(10);
    // floor(0.99*10)=9 → sorted[9]=10
    expect(percentileOf(samples, 0.99)).toBe(10);
  });

  it("does not mutate the caller's samples array", () => {
    const samples = [5, 3, 8, 1, 9, 2, 7, 4, 6];
    const snapshot = [...samples];
    percentileOf(samples, 0.95);
    expect(samples).toEqual(snapshot);
  });

  it("rounds fractional millisecond samples the same way medianOf does", () => {
    // 100 ramped fractional samples 0.5, 1.5, 2.5, …, 99.5.
    const samples = Array.from({ length: 100 }, (_, i) => i + 0.5);
    // floor(0.5*100)=50 → sorted[50] = 50.5 → Math.round → 51
    expect(percentileOf(samples, 0.5)).toBe(51);
    // floor(0.95*100)=95 → sorted[95] = 95.5 → Math.round → 96
    expect(percentileOf(samples, 0.95)).toBe(96);
  });

  it("distinguishes p95 from p99 on a heavy-tailed sample set", () => {
    // 95 samples at 40ms (steady-state) + 5 samples at 200ms (paint-heavy tail)
    // — a shape the fast-capture fallback path is expected to produce
    // (see `fallbackCaptureProfile.ts` framing for why p95≠p99 matters here).
    const steady = Array.from({ length: 95 }, () => 40);
    const tail = Array.from({ length: 5 }, () => 200);
    const samples = [...steady, ...tail];
    // sorted: [40 x95, 200 x5]; floor(0.5*100)=50 → 40
    expect(percentileOf(samples, 0.5)).toBe(40);
    // floor(0.95*100)=95 → sorted[95] = 200 (first of the tail)
    expect(percentileOf(samples, 0.95)).toBe(200);
    // floor(0.99*100)=99 → sorted[99] = 200
    expect(percentileOf(samples, 0.99)).toBe(200);
  });
});

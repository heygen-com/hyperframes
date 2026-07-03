import { describe, it, expect } from "vitest";
import { computeStaticVerificationPoints } from "./frameCapture.js";

/**
 * Regression lock for static-dedup verification sample density.
 *
 * The prior formula capped points-per-run at a flat `min(sampleCount, 8)`,
 * so the stride between checks grew linearly with the run's span — a run of
 * a few thousand frames could end up with checks hundreds of frames apart.
 * A genuine content change hiding between two such checks (e.g. text
 * swapped by a mechanism the GSAP tween walk in computeStaticFrameSet can't
 * see) would never get sampled, and the run would be wrongly trusted as
 * static. The fix bounds the STRIDE itself by `sampleCount`, so density
 * scales with run length instead of staying flat.
 */
describe("computeStaticVerificationPoints", () => {
  const sampleCount = 24;

  function maxGap(points: number[]): number {
    let max = 0;
    for (let i = 1; i < points.length; i++) max = Math.max(max, points[i] - points[i - 1]);
    return max;
  }

  it("never leaves a gap wider than sampleCount frames on a long run", () => {
    // Pre-fix: perRun = min(24, 8) = 8 → stride = floor(2000 / 7) = 285,
    // leaving ~285-frame gaps a real content change could hide inside.
    const points = computeStaticVerificationPoints(0, 2000, sampleCount);
    expect(maxGap(points)).toBeLessThanOrEqual(sampleCount);
  });

  it("scales density up further for an even longer run", () => {
    const points = computeStaticVerificationPoints(0, 10_000, sampleCount);
    expect(maxGap(points)).toBeLessThanOrEqual(sampleCount);
    // Longer run, same stride bound → proportionally more sample points.
    expect(points.length).toBeGreaterThan(400);
  });

  it("matches the prior behavior on short/typical runs (formulas agree)", () => {
    // span=50 with perRun=8 → stride = floor(50/7) = 7, well under maxStride (24),
    // so the new min() with maxStride is a no-op here.
    const points = computeStaticVerificationPoints(100, 150, sampleCount);
    expect(points[0]).toBe(100);
    expect(points[points.length - 1]).toBe(150);
    expect(maxGap(points)).toBeLessThanOrEqual(7);
  });

  it("always includes the run's start and end", () => {
    const points = computeStaticVerificationPoints(500, 500 + 3333, sampleCount);
    expect(points[0]).toBe(500);
    expect(points[points.length - 1]).toBe(500 + 3333);
  });

  it("handles a single-frame run without dividing by zero", () => {
    const points = computeStaticVerificationPoints(42, 42, sampleCount);
    expect(points).toEqual([42]);
  });
});

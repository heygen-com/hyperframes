import { describe, expect, it } from "vitest";
import { decimatePeaks, loudnessToOpacity } from "./audioWaveformPeaks";

describe("loudnessToOpacity", () => {
  it("maps silence to the floor and the file peak to fully opaque", () => {
    expect(loudnessToOpacity(0)).toBe(0.64);
    expect(loudnessToOpacity(1)).toBe(1);
    expect(loudnessToOpacity(0.5)).toBeCloseTo(0.82, 5);
  });

  it("clamps out-of-range and non-finite peaks to the same floor or ceiling", () => {
    expect(loudnessToOpacity(-0.2)).toBe(0.64);
    expect(loudnessToOpacity(4)).toBe(1);
    expect(loudnessToOpacity(Number.NaN)).toBe(0.64);
  });
});

describe("decimatePeaks", () => {
  it("keeps a transient that a single sample in the bucket would miss", () => {
    const peaks = [0, 0, 0, 1, 0, 0, 0, 0];
    expect(decimatePeaks(peaks, 0, 1, 2)).toEqual([1, 0]);
  });

  it("windows to the trimmed source slice", () => {
    expect(decimatePeaks([0.1, 0.2, 0.9, 0.3], 0.5, 1, 1)).toEqual([0.9]);
  });

  it("returns no bars when there is nothing to draw", () => {
    expect(decimatePeaks([], 0, 1, 4)).toEqual([]);
    expect(decimatePeaks([0.5], 0, 1, 0)).toEqual([]);
  });

  it("selects original bins rather than resampling a smaller trimmed range", () => {
    const peaks = [0.1, 1, 0.3, 0.4, 0.8, 0.2, 0.7, 0.5];
    expect(decimatePeaks(peaks, 0.1, 0.9, 13, 3, 8)).toEqual(
      decimatePeaks(peaks, 0.1, 0.9, 13).slice(3, 8),
    );
  });
});

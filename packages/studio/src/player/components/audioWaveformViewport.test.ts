import { describe, expect, it } from "vitest";
import { alignWaveformViewport, getWaveformViewport } from "./audioWaveformViewport";

describe("getWaveformViewport", () => {
  it("bounds a long clip to the shared quarter-viewport overscan", () => {
    expect(getWaveformViewport(15000, -9000, 100, 800)).toEqual({
      fullWidth: 15000,
      left: 8900,
      width: 1200,
    });
  });

  it("keeps a short visible clip's complete canvas", () => {
    expect(getWaveformViewport(120, 200, 100, 800)).toEqual({
      fullWidth: 120,
      left: 0,
      width: 120,
    });
  });

  it.each([
    [10000, 0],
    [-10000, 120],
  ])("releases the bitmap of a clip beyond the render window at %s", (clipLeft, left) => {
    expect(getWaveformViewport(120, clipLeft, 100, 800)).toEqual({
      fullWidth: 120,
      left,
      width: 0,
    });
  });

  it("rounds the crop outwards without changing the full clip's bar grid", () => {
    expect(getWaveformViewport(2000, -100.75, 10.5, 801)).toEqual({
      fullWidth: 2000,
      left: 0,
      width: 1113,
    });
  });

  it("keeps the full clip until the viewport has a measurable width", () => {
    expect(getWaveformViewport(1200, 0, 0, 0)).toEqual({
      fullWidth: 1200,
      left: 0,
      width: 1200,
    });
  });
});

describe("alignWaveformViewport", () => {
  it("keeps a fractional DPR crop on the original bitmap's pixel grid", () => {
    const aligned = alignWaveformViewport(
      { fullWidth: 9875, left: 3993, width: 1201 },
      9874.5,
      1.25,
    );
    const pixelsPerDisplayPixel = Math.ceil(9875 * 1.25) / 9874.5;
    expect(aligned.bitmapWidth).toBe(1502);
    expect((aligned.displayLeft ?? 0) * pixelsPerDisplayPixel).toBeCloseTo(4991);
    expect((aligned.displayWidth ?? 0) * pixelsPerDisplayPixel).toBeCloseTo(1502);
    expect(aligned.left * 1.25).toBe(4991);
    expect(aligned.width * 1.25).toBe(1502);
  });
});

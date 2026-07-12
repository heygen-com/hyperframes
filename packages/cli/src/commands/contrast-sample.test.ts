import { describe, expect, it } from "vitest";
import { computeSampleRect, sampleGridPoints } from "./contrast-sample.js";

describe("computeSampleRect", () => {
  it("insets 1px on each side of a normal bbox", () => {
    expect(computeSampleRect({ x: 10, y: 20, w: 30, h: 40 }, 640, 480)).toEqual({
      x0: 11,
      x1: 39,
      y0: 21,
      y1: 59,
    });
  });

  it("clamps the left/top edge to 0 when the bbox starts off-canvas", () => {
    expect(computeSampleRect({ x: -5, y: -5, w: 20, h: 20 }, 640, 480)).toEqual({
      x0: 0,
      x1: 14,
      y0: 0,
      y1: 14,
    });
  });

  it("clamps the right/bottom edge to the canvas bounds", () => {
    expect(computeSampleRect({ x: 620, y: 460, w: 40, h: 40 }, 640, 480)).toEqual({
      x0: 621,
      x1: 639,
      y0: 461,
      y1: 479,
    });
  });

  it("returns null when the bbox is too small to survive the 1px inset", () => {
    // width 2 → x0 = x+1, x1 = x+1 - 1 = x → x1 <= x0
    expect(computeSampleRect({ x: 100, y: 100, w: 2, h: 2 }, 640, 480)).toBeNull();
  });

  it("returns null when the bbox is entirely outside the canvas", () => {
    expect(computeSampleRect({ x: 1000, y: 1000, w: 20, h: 20 }, 640, 480)).toBeNull();
  });
});

describe("sampleGridPoints", () => {
  it("covers the full rect, starting at its top-left interior corner", () => {
    const points = sampleGridPoints({ x0: 10, x1: 22, y0: 10, y1: 16 }, 12, 6);
    expect(points[0]).toEqual([10, 10]);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThanOrEqual(22);
      expect(y).toBeGreaterThanOrEqual(10);
      expect(y).toBeLessThanOrEqual(16);
    }
  });

  it("caps the point count for a large rect instead of scanning every pixel", () => {
    const points = sampleGridPoints({ x0: 0, x1: 1199, y0: 0, y1: 59 }, 12, 6);
    // (maxCols+1) * (maxRows+1) upper bound — nowhere near a full 1200x60 scan.
    expect(points.length).toBeLessThan(13 * 7 + 5);
  });

  it("still returns at least one point for a rect narrower than the grid step", () => {
    const points = sampleGridPoints({ x0: 5, x1: 6, y0: 5, y1: 6 }, 12, 6);
    expect(points.length).toBeGreaterThan(0);
  });
});

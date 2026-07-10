// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { overlayCornersCentroid, selectionCacheKey } from "./domEditOverlayGeometry";

describe("overlayCornersCentroid", () => {
  it("averages the four corners (the rendered rotation center)", () => {
    expect(
      overlayCornersCentroid({
        nw: { x: 10, y: 20 },
        ne: { x: 110, y: 20 },
        se: { x: 110, y: 80 },
        sw: { x: 10, y: 80 },
      }),
    ).toEqual({ x: 60, y: 50 });
  });

  it("is unchanged by rotation — a rotated square's corners average to its center", () => {
    // Unit square centered at (5,5), rotated 45deg about its center: corners land
    // on the axis midpoints, whose average is still the center.
    const c = overlayCornersCentroid({
      nw: { x: 5, y: 5 - Math.SQRT2 / 2 },
      ne: { x: 5 + Math.SQRT2 / 2, y: 5 },
      se: { x: 5, y: 5 + Math.SQRT2 / 2 },
      sw: { x: 5 - Math.SQRT2 / 2, y: 5 },
    });
    expect(c.x).toBeCloseTo(5, 9);
    expect(c.y).toBeCloseTo(5, 9);
  });
});

describe("selectionCacheKey — hfId collision (R7)", () => {
  it("produces distinct keys for two elements that differ only by hfId", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = selectionCacheKey({ sourceFile: "index.html", hfId: "hf-111" } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = selectionCacheKey({ sourceFile: "index.html", hfId: "hf-222" } as any);
    expect(a).not.toBe(b);
  });
});

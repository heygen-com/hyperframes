import { describe, expect, it } from "vitest";
import { rectsOverlap } from "../../utils/marqueeGeometry";

/**
 * An element dragged past the edge of the frame sits out in the grey, and the
 * rubber band refused to START there — it only began inside the composition
 * rect, so the one gesture that could reach those elements could not be begun
 * near them, leaving the timeline as the only way to select something plainly
 * visible on screen.
 *
 * The collection half never had that limit: it compares rects in overlay space
 * and never clipped to the frame, so a band drawn out in the grey has always
 * been able to find what it covers. This pins that, including the negative
 * coordinates an off-canvas element actually has.
 */
describe("marquee reaches elements outside the composition", () => {
  const offCanvas = { left: -180, top: 40, width: 90, height: 40 };

  it("covers an element sitting left of the frame", () => {
    expect(rectsOverlap({ left: -220, top: 10, width: 160, height: 120 }, offCanvas)).toBe(true);
  });

  it("covers one sitting above the frame", () => {
    const above = { left: 60, top: -140, width: 80, height: 50 };
    expect(rectsOverlap({ left: 20, top: -200, width: 200, height: 120 }, above)).toBe(true);
  });

  it("does not claim one the band misses", () => {
    expect(rectsOverlap({ left: 400, top: 400, width: 50, height: 50 }, offCanvas)).toBe(false);
  });
});

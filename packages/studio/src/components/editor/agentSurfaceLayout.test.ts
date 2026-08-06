import { describe, expect, it } from "vitest";
import { layoutAgentSurfaces } from "./agentSurfaceLayout";
import type { OverlayRect } from "./domEditOverlayGeometry";

const CANVAS = { width: 900, height: 600 };
const COMPOSER = { width: 320, height: 84 };
/** Where the composer's own rule puts it: beside the element, top-aligned. */
function besideRect(r: OverlayRect) {
  return { ...COMPOSER, left: r.left + r.width + 10, top: Math.max(10, r.top) };
}
const BUBBLE = { width: 268, height: 108 };

function rect(partial: Partial<OverlayRect> = {}): OverlayRect {
  return { left: 300, top: 250, width: 200, height: 60, editScaleX: 1, editScaleY: 1, ...partial };
}

/** Two boxes overlap when they intersect on both axes. */
function overlaps(
  a: { left: number; top: number } & { width: number; height: number },
  b: { left: number; top: number } & { width: number; height: number },
): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

describe("layoutAgentSurfaces", () => {
  it("keeps the composer where it put itself, and clears the bubble of it", () => {
    const r = rect();
    const placed = besideRect(r);
    const { composer, bubble } = layoutAgentSurfaces({
      rect: r,
      canvas: CANVAS,
      composer: placed,
      bubble: BUBBLE,
    });
    // The composer's own rule owns its position; this only reports it.
    expect(composer?.left).toBe(placed.left);
    expect(composer?.top).toBe(placed.top);
    expect(overlaps({ ...composer!, ...COMPOSER }, { ...bubble!, ...BUBBLE })).toBe(false);
  });

  it("pushes the bubble clear when the composer is over the side it wanted", () => {
    // A wide element leaves the composer sitting where the bubble would go.
    const r = rect({ left: 40, top: 250, width: 500, height: 60 });
    const placed = { ...COMPOSER, left: 60, top: 300 };
    const { bubble } = layoutAgentSurfaces({
      rect: r,
      canvas: CANVAS,
      composer: placed,
      bubble: BUBBLE,
    });
    expect(overlaps({ ...placed }, { ...bubble!, ...BUBBLE })).toBe(false);
  });

  it("never overlaps, wherever the element sits", () => {
    for (const top of [0, 40, 120, 260, 400, 520, 580]) {
      for (const left of [-120, 0, 200, 500, 860]) {
        const r = rect({ top, left });
        const { composer, bubble } = layoutAgentSurfaces({
          rect: r,
          canvas: CANVAS,
          composer: besideRect(r),
          bubble: BUBBLE,
        });
        expect(overlaps({ ...composer!, ...COMPOSER }, { ...bubble!, ...BUBBLE })).toBe(false);
      }
    }
  });

  it("keeps the bubble's tail pointing at the element", () => {
    const centred = layoutAgentSurfaces({
      rect: rect(),
      canvas: CANVAS,
      composer: null,
      bubble: BUBBLE,
    });
    expect(centred.bubble?.tailLeft).toBe(134);

    // Pushed against the edge, the bubble stops but the tail keeps tracking.
    const edge = layoutAgentSurfaces({
      rect: rect({ left: 0, width: 40 }),
      canvas: CANVAS,
      composer: null,
      bubble: BUBBLE,
    });
    expect(edge.bubble?.left).toBe(10);
    expect(edge.bubble?.tailLeft).toBe(14);
  });

  it("gives the bubble the preferred side when it is alone", () => {
    const { composer, bubble } = layoutAgentSurfaces({
      rect: rect(),
      canvas: CANVAS,
      composer: null,
      bubble: BUBBLE,
    });
    expect(composer).toBeUndefined();
    expect(bubble?.side).toBe("below");
  });
});

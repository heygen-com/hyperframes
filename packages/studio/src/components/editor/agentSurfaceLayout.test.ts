import { describe, expect, it } from "vitest";
import { layoutAgentSurfaces } from "./agentSurfaceLayout";
import type { OverlayRect } from "./domEditOverlayGeometry";

const CANVAS = { width: 900, height: 600 };
const COMPOSER = { width: 320, height: 84 };
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
  it("puts the composer under the element and the answer above it", () => {
    const { composer, bubble } = layoutAgentSurfaces({
      rect: rect(),
      canvas: CANVAS,
      composer: COMPOSER,
      bubble: BUBBLE,
    });
    expect(composer?.side).toBe("below");
    expect(bubble?.side).toBe("above");
    expect(overlaps({ ...composer!, ...COMPOSER }, { ...bubble!, ...BUBBLE })).toBe(false);
  });

  it("stacks them on one side when only that side has room", () => {
    // An element near the top: nothing fits above it, so both go below.
    const { composer, bubble } = layoutAgentSurfaces({
      rect: rect({ top: 12 }),
      canvas: CANVAS,
      composer: COMPOSER,
      bubble: BUBBLE,
    });
    expect(composer?.side).toBe("below");
    expect(bubble?.top).toBeGreaterThan(composer!.top);
    expect(overlaps({ ...composer!, ...COMPOSER }, { ...bubble!, ...BUBBLE })).toBe(false);
  });

  it("never overlaps, wherever the element sits", () => {
    for (const top of [0, 40, 120, 260, 400, 520, 580]) {
      for (const left of [-120, 0, 200, 500, 860]) {
        const { composer, bubble } = layoutAgentSurfaces({
          rect: rect({ top, left }),
          canvas: CANVAS,
          composer: COMPOSER,
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

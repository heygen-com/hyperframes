import { describe, expect, it } from "vitest";
import type { GestureState } from "./domEditOverlayGestures";
import { sealedResizeAnchor } from "./resizeDraft";

const gesture = (resizeGrow?: GestureState["resizeGrow"]) =>
  ({
    actualWidth: 240,
    actualHeight: 160,
    editScaleX: 0.5,
    editScaleY: 0.5,
    resizeGrow,
  }) as GestureState;
const written = { width: 340, height: 220 };

describe("a sealed resize's centre pin", () => {
  it("takes back only as much as the frame measured the centre moving", () => {
    const plain = sealedResizeAnchor(gesture({ a: 0.25, b: 0, c: 0, d: 0.25 }), written);
    expect(plain).toEqual({ dx: -25, dy: -15 });
    const centred = sealedResizeAnchor(gesture({ a: 0, b: 0, c: 0, d: 0 }), written);
    expect([centred.dx, centred.dy].map(Math.abs)).toEqual([0, 0]);
  });

  it("pins half the growth when the frame did not measure it", () => {
    expect(sealedResizeAnchor(gesture(), written)).toEqual({ dx: -25, dy: -15 });
  });
});

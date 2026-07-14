// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  LAYER_REVEAL_LIFT_Z,
  liftElementToTop,
  restoreLiftedElement,
} from "./useLayerRevealOverride";
import { readEffectiveZIndex } from "./canvasContextMenuZOrder";
import { getElementZIndex } from "../../player/lib/layerOrdering";
import {
  LAYER_REVEAL_PRIOR_Z_ATTR,
  readTimelineElementZIndex,
} from "../../player/lib/timelineElementHelpers";

function makeEl(zIndex?: string, position?: string): HTMLElement {
  const el = document.createElement("div");
  if (zIndex != null) el.style.zIndex = zIndex;
  if (position != null) el.style.position = position;
  document.body.appendChild(el);
  return el;
}

describe("liftElementToTop / restoreLiftedElement", () => {
  it("paints on top but every z reader keeps reporting the TRUE z", () => {
    const el = makeEl("6", "absolute");
    const lift = liftElementToTop(el);
    expect(lift).not.toBeNull();
    // The renderer sees the lifted value…
    expect(el.style.zIndex).toBe(LAYER_REVEAL_LIFT_Z);
    // …every studio reader sees the true z.
    expect(readEffectiveZIndex(el)).toBe(6);
    expect(getElementZIndex(el)).toBe(6);
    expect(readTimelineElementZIndex(el)).toBe(6);

    restoreLiftedElement(el, lift!);
    expect(el.style.zIndex).toBe("6");
    expect(el.hasAttribute(LAYER_REVEAL_PRIOR_Z_ATTR)).toBe(false);
  });

  it("gives a static element a temporary position:relative and restores it", () => {
    const el = makeEl();
    const lift = liftElementToTop(el)!;
    expect(el.style.position).toBe("relative");
    expect(lift.positionLifted).toBe(true);
    restoreLiftedElement(el, lift);
    expect(el.style.position).toBe("");
    expect(el.style.zIndex).toBe("");
  });

  it("a z-reorder commit consumes the lift: restore becomes a no-op", () => {
    const el = makeEl("3", "absolute");
    const lift = liftElementToTop(el)!;
    // Simulate handleDomZIndexReorderCommit: real z written, attrs removed.
    el.removeAttribute(LAYER_REVEAL_PRIOR_Z_ATTR);
    el.style.zIndex = "8";
    restoreLiftedElement(el, lift);
    expect(el.style.zIndex).toBe("8"); // the commit's value survives
    expect(readEffectiveZIndex(el)).toBe(8);
  });

  it("does not clobber a z someone else wrote while lifted", () => {
    const el = makeEl("3", "absolute");
    const lift = liftElementToTop(el)!;
    el.style.zIndex = "42"; // e.g. a GSAP seek or manual edit
    restoreLiftedElement(el, lift);
    expect(el.style.zIndex).toBe("42");
  });
});

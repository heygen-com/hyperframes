import { describe, expect, it } from "vitest";
import {
  MIN_PREVIEW_H,
  MIN_PREVIEW_W,
  MIN_TIMELINE_H,
  RAIL_W,
  defaultPanelWidths,
  fitPanelWidths,
  fitTimelineHeight,
} from "./fitPanels";

function fitAt(viewportWidth: number) {
  return fitPanelWidths(viewportWidth, defaultPanelWidths(viewportWidth));
}

describe("defaultPanelWidths", () => {
  // Frozen literals, deliberately NOT compared against the live hook: the hook
  // now delegates here, so asserting against it would be circular and would
  // silently stop guarding the "wide windows are untouched" promise.
  it.each([
    [1680, 384, 424],
    [1512, 384, 424],
    [1280, 329, 364],
  ])("keeps %ipx identical to the pre-change defaults", (vw, left, right) => {
    expect(defaultPanelWidths(vw)).toEqual({ left, right });
  });
});

describe("fitPanelWidths", () => {
  it.each([1680, 1512, 1280])("leaves %ipx untouched by reconciliation", (vw) => {
    const preferred = defaultPanelWidths(vw);
    const fitted = fitPanelWidths(vw, preferred);
    expect(fitted.left).toBe(preferred.left);
    expect(fitted.right).toBe(preferred.right);
    expect(fitted.autoCollapseLeft).toBe(false);
    expect(fitted.autoCollapseRight).toBe(false);
  });

  it.each([1680, 1512, 1280, 1100, 960, 860, 760, 640, 560, 480])(
    "never starves the preview at %ipx",
    (vw) => {
      expect(fitAt(vw).preview).toBeGreaterThanOrEqual(MIN_PREVIEW_W);
    },
  );

  it("matches the projected preview widths from the plan", () => {
    const projected: Array<[number, number]> = [
      [1680, 866],
      [1512, 698],
      [1280, 581],
      [1100, 499],
      [960, 427],
      [860, 360],
      [760, 432],
      [640, 592],
      [560, 512],
      [480, 432],
    ];
    for (const [vw, preview] of projected) {
      expect({ vw, preview: fitAt(vw).preview }).toEqual({ vw, preview });
    }
  });

  it("fits everything at its minimum at exactly 860, the derived threshold", () => {
    const fitted = fitAt(860);
    expect(fitted).toMatchObject({
      left: 214,
      right: 280,
      preview: MIN_PREVIEW_W,
      autoCollapseLeft: false,
    });
  });

  it("rails the sidebar one pixel below the threshold", () => {
    expect(fitAt(860).autoCollapseLeft).toBe(false);
    expect(fitAt(859).autoCollapseLeft).toBe(true);
    expect(fitAt(859).left).toBe(RAIL_W);
  });

  it("hides the inspector one pixel below its own threshold", () => {
    expect(fitAt(700).autoCollapseRight).toBe(false);
    expect(fitAt(700).right).toBeGreaterThan(0);
    expect(fitAt(699).autoCollapseRight).toBe(true);
    expect(fitAt(699).right).toBe(0);
  });

  it("never drives an EXPANDED sidebar below its usable minimum", () => {
    // Guards the leftFloor/rightFloor split: the squeeze fallback may only reach
    // the rail width when the panel is actually railed.
    const fitted = fitPanelWidths(900, { left: 600, right: 600 });
    expect(fitted.left).toBeGreaterThanOrEqual(200);
    expect(fitted.right).toBeGreaterThanOrEqual(280);
  });

  it("caps a single panel at 40% of the window", () => {
    expect(fitPanelWidths(1600, { left: 900, right: 280 }).left).toBe(640);
  });

  it("lets the preview floor win when the cap alone is not enough", () => {
    // 40% of 1000 is 400, but 400 + 280 + 6 leaves the preview at 314.
    const fitted = fitPanelWidths(1000, { left: 900, right: 280 });
    expect(fitted.left).toBe(354);
    expect(fitted.preview).toBe(MIN_PREVIEW_W);
  });

  it("survives a viewport narrower than the preview floor alone", () => {
    const fitted = fitAt(300);
    expect(fitted.preview).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(fitted.preview)).toBe(false);
    expect(fitted.left).toBe(RAIL_W);
  });

  it("returns preferences untouched before the shell is measured", () => {
    const preferred = { left: 320, right: 400 };
    expect(fitPanelWidths(0, preferred)).toMatchObject({ ...preferred, preview: 0 });
    expect(fitPanelWidths(Number.NaN, preferred)).toMatchObject(preferred);
  });

  it("is idempotent, so a resize loop cannot oscillate", () => {
    for (const vw of [1512, 1100, 860, 760, 560]) {
      const once = fitPanelWidths(vw, defaultPanelWidths(vw));
      const twice = fitPanelWidths(vw, once);
      expect(twice).toEqual(once);
    }
  });
});

describe("fitTimelineHeight", () => {
  it("keeps a height that fits", () => {
    expect(fitTimelineHeight(717, 429)).toBe(429);
  });

  it("reclaims height for the preview when the shell shrinks", () => {
    // The measured bug: mounted at 760 tall, dragged to 520. Preview was 47px.
    expect(fitTimelineHeight(477, 429)).toBe(477 - MIN_PREVIEW_H);
    expect(477 - fitTimelineHeight(477, 429)).toBeGreaterThanOrEqual(MIN_PREVIEW_H);
  });

  it("raises a too-small preference to the timeline minimum", () => {
    expect(fitTimelineHeight(717, 10)).toBe(MIN_TIMELINE_H);
  });

  it("keeps the timeline usable when the shell is shorter than both minimums", () => {
    expect(fitTimelineHeight(120, 429)).toBe(MIN_TIMELINE_H);
  });

  it("returns the preference before the shell is measured", () => {
    expect(fitTimelineHeight(0, 429)).toBe(429);
  });

  it("is idempotent", () => {
    const once = fitTimelineHeight(477, 429);
    expect(fitTimelineHeight(477, once)).toBe(once);
  });

  it("would return the preferred height if callers kept one", () => {
    // The helper is preference-preserving; the vertical CALLER still stores the
    // clamped value, so a shrink-then-grow does not restore the old height the
    // way panel widths do. Tracked as a known asymmetry, not fixed here.
    const preferred = 429;
    expect(fitTimelineHeight(477, preferred)).toBe(277);
    expect(fitTimelineHeight(717, preferred)).toBe(429);
  });
});

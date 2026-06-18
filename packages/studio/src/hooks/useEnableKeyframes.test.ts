import { describe, expect, it } from "vitest";
import { resolveNewTweenRange } from "./useEnableKeyframes";

describe("resolveNewTweenRange", () => {
  // Regression: "add a keyframe" must land at the PLAYHEAD. The runtime auto-stamps
  // data-start="0" + data-duration=<rootDuration> on every GSAP element, so honoring
  // data-start as authored timing put the keyframe at 0. Clamping the playhead into
  // the element's range fixes it (auto-stamp's full range passes the playhead through).
  it("anchors at the playhead through the auto-stamped full-composition range", () => {
    // data-start="0", data-duration="14" (the auto-stamp), playhead 4.9 → 4.9
    expect(resolveNewTweenRange("0", "14", 4.9)).toEqual({ start: 4.9, duration: 9.1 });
  });

  it("anchors at the playhead when the element has no authored range", () => {
    expect(resolveNewTweenRange(undefined, undefined, 4)).toEqual({ start: 4, duration: 1 });
    expect(resolveNewTweenRange(undefined, undefined, 6.123456).start).toBe(6.123);
  });

  it("never returns a negative start", () => {
    expect(resolveNewTweenRange(undefined, undefined, -2).start).toBe(0);
  });

  it("clamps the playhead into a genuinely narrow authored clip", () => {
    // clip [2.5, 8]: inside → playhead; before → start; after → end
    expect(resolveNewTweenRange("2.5", "5.5", 4)).toEqual({ start: 4, duration: 4 });
    expect(resolveNewTweenRange("2.5", "5.5", 1).start).toBe(2.5);
    expect(resolveNewTweenRange("2.5", "5.5", 99).start).toBe(8);
  });
});

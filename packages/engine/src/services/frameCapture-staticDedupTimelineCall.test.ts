import { describe, it, expect, vi } from "vitest";
import { computeStaticFrameSet } from "./frameCapture.js";

/**
 * Regression lock: a GSAP `tl.call()` disqualifies a composition from
 * static-frame dedup, even though the tween walker can't see it as an
 * "animated" interval (a call() carries no property change to track).
 *
 * `tl.call()` is a zero-duration tween whose vars wire the callback as
 * `onComplete` (and `onReverseComplete` — GSAP fires the SAME forward side
 * effect on backward crossing too, there is no separate "undo"). A one-shot
 * DOM mutation driven this way (e.g. a counter's textContent) is not
 * seek-idempotent: the static-dedup verifier's own arm-time seeking can
 * permanently fire it while checking a LATER run, corrupting the page for an
 * EARLIER, unrelated run's real capture — even though each run's own
 * verification passes in isolation, so "verified" still gets logged. Real
 * incident: tools-onboarding FR render, beat-1 title card baked in beat-6's
 * counter value from frame 0 onward.
 */
describe("computeStaticFrameSet disqualifies a comp containing a tl.call()", () => {
  function makePage(evalResult: Record<string, unknown>) {
    return {
      evaluate: vi
        .fn()
        // First call: the main computeStaticFrameSet in-page scan.
        .mockResolvedValueOnce(evalResult)
        // Second call: computeClipBoundaryFrames' own [data-start] scan.
        .mockResolvedValueOnce([]),
    } as unknown as Parameters<typeof computeStaticFrameSet>[0];
  }

  it("is ineligible when a tl.call() is present, even with zero tracked tween intervals", async () => {
    const page = makePage({
      intervals: [],
      tweenCount: 1,
      duration: 10,
      hasVideo: false,
      hasCanvas: false,
      hasNonGsapAnim: false,
      hasUnresolvableClipStart: false,
      hasTimelineCall: true,
    });

    const result = await computeStaticFrameSet(page, 30);

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("tl.call()");
    expect(result.staticFrameSet.size).toBe(0);
  });

  it("stays eligible on an otherwise-identical comp with no tl.call()", async () => {
    const page = makePage({
      intervals: [],
      tweenCount: 1,
      duration: 10,
      hasVideo: false,
      hasCanvas: false,
      hasNonGsapAnim: false,
      hasUnresolvableClipStart: false,
      hasTimelineCall: false,
    });

    const result = await computeStaticFrameSet(page, 30);

    expect(result.eligible).toBe(true);
    expect(result.staticFrameSet.size).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import { computeTimelineBasisDuration, computeTimelineEffectiveDuration } from "./timelineLayout";

describe("computeTimelineBasisDuration", () => {
  it("uses the root duration when it exceeds every clip end", () => {
    expect(computeTimelineBasisDuration(12, [4, 6, 9])).toBe(12);
  });

  it("grows to the furthest committed clip end past the root duration", () => {
    expect(computeTimelineBasisDuration(12, [4, 18, 9])).toBe(18);
  });

  it("falls back to the root duration with no clips / non-finite ends", () => {
    expect(computeTimelineBasisDuration(10, [])).toBe(10);
    expect(computeTimelineBasisDuration(Number.NaN, [])).toBe(0);
  });
});

describe("computeTimelineEffectiveDuration", () => {
  it("returns the basis when there is no active preview", () => {
    expect(computeTimelineEffectiveDuration(12, [null, null])).toBe(12);
  });

  it("extends to a drag/resize preview end beyond the basis", () => {
    expect(computeTimelineEffectiveDuration(12, [20, null])).toBe(20);
    expect(computeTimelineEffectiveDuration(12, [null, 16])).toBe(16);
  });

  it("never shrinks below the basis for a preview inside the current length", () => {
    // The invariant behind the jump fix: the basis (which drives zoom) is
    // independent of the preview, and a smaller preview end can't reduce it.
    expect(computeTimelineEffectiveDuration(12, [8])).toBe(12);
  });
});

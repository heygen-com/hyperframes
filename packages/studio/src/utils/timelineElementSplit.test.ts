import { describe, it, expect } from "vitest";
import { SPLIT_BOUNDARY_EPSILON_S, isSplitTimeWithinBounds } from "./timelineElementSplit";

describe("isSplitTimeWithinBounds", () => {
  const start = 1;
  const duration = 4;
  const end = start + duration;

  it("accepts the exact lower clamp boundary", () => {
    // The timeline canvas clamps an edge click to exactly
    // start + SPLIT_BOUNDARY_EPSILON_S, so that value must be splittable.
    expect(isSplitTimeWithinBounds(start + SPLIT_BOUNDARY_EPSILON_S, start, duration)).toBe(true);
  });

  it("accepts the exact upper clamp boundary", () => {
    expect(
      isSplitTimeWithinBounds(start + duration - SPLIT_BOUNDARY_EPSILON_S, start, duration),
    ).toBe(true);
  });

  it("accepts an interior split time", () => {
    expect(isSplitTimeWithinBounds(3, start, duration)).toBe(true);
  });

  it("rejects times at or outside the clip edges", () => {
    expect(isSplitTimeWithinBounds(start, start, duration)).toBe(false);
    expect(isSplitTimeWithinBounds(end, start, duration)).toBe(false);
    expect(isSplitTimeWithinBounds(start - 1, start, duration)).toBe(false);
    expect(isSplitTimeWithinBounds(end + 1, start, duration)).toBe(false);
  });

  it("rejects times inside the epsilon margins", () => {
    expect(isSplitTimeWithinBounds(start + SPLIT_BOUNDARY_EPSILON_S / 2, start, duration)).toBe(
      false,
    );
    expect(isSplitTimeWithinBounds(end - SPLIT_BOUNDARY_EPSILON_S / 2, start, duration)).toBe(
      false,
    );
  });

  it("rejects every time on a clip shorter than two epsilons", () => {
    // Math.max(min, Math.min(max, t)) collapses to min when the clip is too
    // short for the clamp range; that collapsed value must still be rejected.
    const shortDuration = SPLIT_BOUNDARY_EPSILON_S;
    expect(isSplitTimeWithinBounds(start + SPLIT_BOUNDARY_EPSILON_S, start, shortDuration)).toBe(
      false,
    );
    expect(isSplitTimeWithinBounds(start + shortDuration / 2, start, shortDuration)).toBe(false);
  });
});

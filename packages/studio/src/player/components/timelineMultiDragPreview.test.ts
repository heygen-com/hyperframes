import { describe, it, expect } from "vitest";
import { clampGroupMoveDelta } from "./timelineMultiDragPreview";

describe("clampGroupMoveDelta (rigid group move)", () => {
  it("passes a rightward delta through unchanged (no right wall)", () => {
    expect(clampGroupMoveDelta(3, [2, 5, 9])).toBe(3);
    expect(clampGroupMoveDelta(1000, [0, 4])).toBe(1000);
  });

  it("passes a leftward delta through when no member would cross 0", () => {
    // Leftmost member at 5, moving left by 3 → 2 ≥ 0, so unclamped.
    expect(clampGroupMoveDelta(-3, [5, 8, 12])).toBe(-3);
  });

  it("clamps a leftward delta so the leftmost member stops exactly at 0", () => {
    // Leftmost at 2 → the furthest left the group can move is -2 (that member → 0).
    // A pointer asking for -5 is clamped to -2: the grabbed clip stops with the
    // formation instead of out-running it.
    expect(clampGroupMoveDelta(-5, [2, 6, 10])).toBe(-2);
  });

  it("is bounded by the MOST-constrained (leftmost) member, not the grabbed one", () => {
    // Grabbed clip is at 10; a passenger at 1 is the constraint. Max left = -1.
    expect(clampGroupMoveDelta(-8, [10, 1, 4])).toBe(-1);
  });

  it("already-at-0 member forbids any leftward move", () => {
    expect(clampGroupMoveDelta(-4, [0, 3, 7])).toBe(0);
    // rightward still allowed
    expect(clampGroupMoveDelta(2, [0, 3, 7])).toBe(2);
  });

  it("returns the raw delta for an empty formation", () => {
    expect(clampGroupMoveDelta(-9, [])).toBe(-9);
  });
});

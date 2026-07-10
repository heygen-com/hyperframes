import { describe, it, expect } from "vitest";
import {
  clampGroupMoveDelta,
  isMultiDragActive,
  isMultiDragPassenger,
  multiDragDeltaSeconds,
  multiDragPassengerOffsetPx,
  type MultiDragPreviewInput,
} from "./timelineMultiDragPreview";

const base = (over: Partial<MultiDragPreviewInput> = {}): MultiDragPreviewInput => ({
  dragStarted: true,
  draggedKey: "a",
  draggedOriginStart: 2,
  draggedPreviewStart: 5,
  selectedKeys: new Set(["a", "b", "c"]),
  ...over,
});

describe("isMultiDragActive", () => {
  it("is active when a started drag's clip is part of a 2+ selection", () => {
    expect(isMultiDragActive(base())).toBe(true);
  });

  it("is inactive before the drag starts", () => {
    expect(isMultiDragActive(base({ dragStarted: false }))).toBe(false);
  });

  it("is inactive for a single-clip selection (single-drag behavior)", () => {
    expect(isMultiDragActive(base({ selectedKeys: new Set(["a"]) }))).toBe(false);
  });

  it("is inactive when the dragged clip is not itself selected", () => {
    expect(isMultiDragActive(base({ draggedKey: "z" }))).toBe(false);
  });
});

describe("multiDragDeltaSeconds (the one formation delta)", () => {
  it("is the grabbed clip's preview − origin start when active", () => {
    // The preview start is already group-clamped upstream, so this delta is the
    // clamped delta every member (ghost + passengers) moves by.
    expect(multiDragDeltaSeconds(base())).toBe(3);
  });

  it("supports a leftward (negative) delta", () => {
    expect(multiDragDeltaSeconds(base({ draggedPreviewStart: 0.5 }))).toBeCloseTo(-1.5);
  });

  it("is zero when no multi-drag is active", () => {
    expect(multiDragDeltaSeconds(base({ selectedKeys: new Set(["a"]) }))).toBe(0);
  });
});

describe("isMultiDragPassenger", () => {
  it("marks a selected non-dragged clip as a passenger", () => {
    expect(isMultiDragPassenger("b", base())).toBe(true);
    expect(isMultiDragPassenger("c", base())).toBe(true);
  });

  it("never marks the dragged clip itself (it is the free ghost)", () => {
    expect(isMultiDragPassenger("a", base())).toBe(false);
  });

  it("never marks an unselected clip", () => {
    expect(isMultiDragPassenger("d", base())).toBe(false);
  });

  it("marks nothing when the drag is a single-drag", () => {
    const single = base({ selectedKeys: new Set(["a"]) });
    expect(isMultiDragPassenger("b", single)).toBe(false);
  });
});

describe("multiDragPassengerOffsetPx (rigid: every passenger shares the delta)", () => {
  it("converts the one formation delta to pixels for every passenger", () => {
    // Both passengers move by the SAME 3s × 100pps = 300px — spacing locked.
    expect(multiDragPassengerOffsetPx("b", 100, base())).toBe(300);
    expect(multiDragPassengerOffsetPx("c", 100, base())).toBe(300);
  });

  it("is zero for the dragged clip and for non-passengers", () => {
    expect(multiDragPassengerOffsetPx("a", 100, base())).toBe(0);
    expect(multiDragPassengerOffsetPx("d", 100, base())).toBe(0);
  });

  it("is zero for a non-finite pps", () => {
    expect(multiDragPassengerOffsetPx("b", Number.NaN, base())).toBe(0);
  });

  it("follows a leftward delta", () => {
    expect(multiDragPassengerOffsetPx("c", 50, base({ draggedPreviewStart: 0 }))).toBe(-100);
  });
});

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

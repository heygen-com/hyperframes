import { describe, it, expect } from "vitest";
import {
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

describe("multiDragDeltaSeconds", () => {
  it("is preview − origin start when active", () => {
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

describe("multiDragPassengerOffsetPx", () => {
  it("converts the delta to pixels for a passenger", () => {
    expect(multiDragPassengerOffsetPx("b", 100, base())).toBe(300);
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

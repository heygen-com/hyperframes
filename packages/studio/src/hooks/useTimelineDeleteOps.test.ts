import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../player";
import { applyRippleShifts } from "./useTimelineDeleteOps";

function el(id: string, start: number, duration: number, track = 0): TimelineElement {
  return { id, tag: "video", start, duration, track, domId: id };
}

describe("applyRippleShifts", () => {
  it("returns survivors unchanged when there are no changes", () => {
    const survivors = [el("a", 0, 2), el("c", 8, 1)];
    expect(applyRippleShifts(survivors, null)).toBe(survivors);
  });

  it("rewrites only the starts named by the changes", () => {
    const survivors = [el("a", 0, 2), el("c", 8, 1)];
    const result = applyRippleShifts(survivors, [{ element: survivors[1], start: 2 }]);
    expect(result).toEqual([el("a", 0, 2), el("c", 2, 1)]);
    expect(result[0]).toBe(survivors[0]);
  });
});

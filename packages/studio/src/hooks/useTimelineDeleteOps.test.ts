import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../player";
import { applyRippleShifts, buildRippleMoveChanges } from "./useTimelineDeleteOps";

function el(id: string, start: number, duration: number, track = 0): TimelineElement {
  return { id, tag: "video", start, duration, track, domId: id };
}

describe("buildRippleMoveChanges", () => {
  it("maps each shift to its surviving element and new start", () => {
    const survivors = [el("a", 0, 2), el("c", 8, 1)];
    const changes = buildRippleMoveChanges(survivors, [{ key: "c", newStart: 2 }]);
    expect(changes).toEqual([{ element: survivors[1], start: 2 }]);
  });

  it("resolves by key when present, falling back to id", () => {
    const withKey: TimelineElement = { ...el("a", 0, 2), key: "a-key" };
    const changes = buildRippleMoveChanges([withKey], [{ key: "a-key", newStart: 5 }]);
    expect(changes).toEqual([{ element: withKey, start: 5 }]);
  });
});

describe("applyRippleShifts", () => {
  it("returns survivors unchanged when there are no shifts", () => {
    const survivors = [el("a", 0, 2), el("c", 8, 1)];
    expect(applyRippleShifts(survivors, null)).toBe(survivors);
  });

  it("rewrites only the starts named by the shifts", () => {
    const survivors = [el("a", 0, 2), el("c", 8, 1)];
    const result = applyRippleShifts(survivors, [{ key: "c", newStart: 2 }]);
    expect(result).toEqual([el("a", 0, 2), el("c", 2, 1)]);
    expect(result[0]).toBe(survivors[0]);
  });
});

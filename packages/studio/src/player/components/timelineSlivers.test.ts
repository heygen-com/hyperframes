import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { withoutHiddenSlivers } from "./timelineSlivers";

const clip = (id: string, start: number, duration: number): TimelineElement =>
  ({ id, key: id, tag: "video", start, duration, track: 0 }) as TimelineElement;

const ids = (els: readonly TimelineElement[]) => els.map((el) => el.id);

describe("withoutHiddenSlivers", () => {
  it("keeps one clip per drawn box of a dense run, and the run's last clip", () => {
    // 1 px per second: twenty 0.5 s clips back to back, each drawn at the 4 px minimum.
    const run = Array.from({ length: 20 }, (_, i) => clip(`c${i}`, i * 0.5, 0.5));
    expect(ids(withoutHiddenSlivers(run, 1, () => false))).toEqual(["c0", "c8", "c16", "c19"]);
  });

  it("keeps every clip wide enough to be seen", () => {
    const wide = [clip("a", 0, 10), clip("b", 10, 10), clip("c", 20, 10)];
    expect(withoutHiddenSlivers(wide, 1, () => false)).toBe(wide);
  });

  it("keeps a clip the caller needs even when it is hidden", () => {
    const run = Array.from({ length: 6 }, (_, i) => clip(`c${i}`, i * 0.5, 0.5));
    expect(ids(withoutHiddenSlivers(run, 1, (el) => el.id === "c2"))).toEqual(["c0", "c2", "c5"]);
  });

  it("keeps the caller's order", () => {
    const run = [clip("late", 1, 0.5), clip("early", 0, 0.5), clip("mid", 0.5, 0.5)];
    expect(ids(withoutHiddenSlivers(run, 1, () => false))).toEqual(["late", "early"]);
  });

  it("keeps a wide clip that starts inside another, as one an author's shared transition label overlaps", () => {
    const overlapped = [clip("A", 0, 10), clip("B", 9, 10), clip("C", 18, 10)];
    expect(withoutHiddenSlivers(overlapped, 100, () => false)).toBe(overlapped);
  });
});

import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { createTimelineClipIndex, queryTimelineClipIndex } from "./timelineClipIndex";

function clip(
  id: string,
  start: number,
  duration: number,
  track = 1,
  hidden = false,
): TimelineElement {
  return { id, tag: "div", start, duration, track, hidden };
}

function ids(elements: readonly TimelineElement[]): string[] {
  return elements.map((element) => element.key ?? element.id);
}

describe("timelineClipIndex", () => {
  it("finds a long predecessor spanning the window", () => {
    const index = createTimelineClipIndex([[1, [clip("long", 0, 100), clip("late", 80, 1)]]]);
    expect(ids(queryTimelineClipIndex(index, 1, { start: 50, end: 51 }))).toEqual(["long"]);
  });

  it("uses half-open render boundaries and retains zero-duration points", () => {
    const index = createTimelineClipIndex([
      [
        1,
        [
          clip("left", 0, 2),
          clip("right", 2, 2),
          clip("point", 3, 0),
          clip("negative", 3.5, -2),
          clip("micro", 4, 1e-9),
        ],
      ],
    ]);
    expect(ids(queryTimelineClipIndex(index, 1, { start: 2, end: 4 }))).toEqual([
      "right",
      "point",
      "negative",
    ]);
    expect(ids(queryTimelineClipIndex(index, 1, { start: 4, end: 5 }))).toEqual(["micro"]);
  });

  it("preserves projection order after overlap and pin union", () => {
    const index = createTimelineClipIndex([
      [1, [clip("pinned", 10, 1), clip("visible-b", 2, 1), clip("visible-a", 1, 3)]],
    ]);
    expect(
      ids(queryTimelineClipIndex(index, 1, { start: 1.5, end: 2.5 }, new Set(["pinned"]))),
    ).toEqual(["pinned", "visible-b", "visible-a"]);
  });

  it("keeps duplicate identities deterministic and ignores stale pins", () => {
    const index = createTimelineClipIndex([
      [1, [clip("duplicate", 10, 1), clip("duplicate", 20, 1), clip("hidden", 30, 1, 1, true)]],
      [2, [clip("duplicate", 40, 1, 2)]],
    ]);
    expect(
      ids(queryTimelineClipIndex(index, 1, { start: 0, end: 1 }, new Set(["duplicate", "stale"]))),
    ).toEqual(["duplicate", "duplicate"]);
    expect(
      ids(queryTimelineClipIndex(index, 2, { start: 0, end: 1 }, new Set(["duplicate"]))),
    ).toEqual(["duplicate"]);
  });

  it("keeps an immutable interval snapshot when the source projection array changes", () => {
    const source = [clip("first", 0, 2), clip("second", 5, 2)];
    const index = createTimelineClipIndex([[1, source]]);
    source.splice(0, source.length, clip("replacement", 0, 20));
    expect(ids(queryTimelineClipIndex(index, 1, { start: 0, end: 1 }))).toEqual(["first"]);
  });

  it("excludes clips with non-finite timing", () => {
    const index = createTimelineClipIndex([
      [1, [clip("bad-start", Number.NaN, 1), clip("bad-duration", 0, Number.POSITIVE_INFINITY)]],
    ]);
    expect(ids(queryTimelineClipIndex(index, 1, { start: 0, end: 1 }))).toEqual([]);
  });

  it("indexes synthetic fractional display rows independently", () => {
    const index = createTimelineClipIndex([
      [1, [clip("host", 0, 1)]],
      [1.5, [clip("child", 10, 1, 1.5)]],
    ]);
    expect(ids(queryTimelineClipIndex(index, 1.5, { start: 10, end: 11 }))).toEqual(["child"]);
    expect(ids(queryTimelineClipIndex(index, 1, { start: 10, end: 11 }))).toEqual([]);
  });
});

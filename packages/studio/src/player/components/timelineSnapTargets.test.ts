import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import {
  buildTimelineSnapTargets,
  snapEdgesToTargets,
  snapResizeEdgeToTargets,
} from "./timelineSnapTargets";

function timelineElement(input: {
  id: string;
  key?: string;
  start: number;
  duration: number;
}): TimelineElement {
  return {
    id: input.id,
    key: input.key,
    tag: "div",
    start: input.start,
    duration: input.duration,
    track: 0,
  };
}

describe("buildTimelineSnapTargets", () => {
  it("excludes the dragged clip's own edges", () => {
    const dragged = timelineElement({
      id: "dragged-id",
      key: "dragged-key",
      start: 1,
      duration: 2,
    });
    const other = timelineElement({ id: "other", start: 4, duration: 2 });

    const targets = buildTimelineSnapTargets({
      elements: [dragged, other],
      excludedKeys: new Set(["dragged-key"]),
      playhead: 8,
      compDuration: 10,
      beats: [1.5],
    });

    const times = targets.map((target) => target.time);
    expect(times).not.toContain(1);
    expect(times).not.toContain(3);
    expect(times).toContain(4);
    expect(times).toContain(6);
  });

  it("excludes every moving group member, not just the grabbed clip", () => {
    const a = timelineElement({ id: "a", start: 1, duration: 1 });
    const b = timelineElement({ id: "b", start: 3, duration: 1 });
    const other = timelineElement({ id: "other", start: 6, duration: 1 });

    const targets = buildTimelineSnapTargets({
      elements: [a, b, other],
      excludedKeys: new Set(["a", "b"]),
      playhead: 9,
      compDuration: 10,
      beats: [],
    });

    const times = targets.map((target) => target.time);
    // Both group members' edges are excluded; the non-member's edges remain.
    expect(times).not.toContain(1);
    expect(times).not.toContain(2);
    expect(times).not.toContain(3);
    expect(times).not.toContain(4);
    expect(times).toContain(6);
    expect(times).toContain(7);
  });

  it("dedupes near-equal times from different sources", () => {
    const dragged = timelineElement({ id: "dragged", start: 2, duration: 2 });
    const other = timelineElement({ id: "other", start: 0.0004, duration: 10 });

    const targets = buildTimelineSnapTargets({
      elements: [dragged, other],
      excludedKeys: new Set(["dragged"]),
      playhead: 5,
      compDuration: 10,
      beats: [0.0002, 10.0002],
    });

    expect(targets.filter((target) => Math.abs(target.time) < 0.001)).toHaveLength(1);
    expect(targets.filter((target) => Math.abs(target.time - 10) < 0.001)).toHaveLength(1);
  });
});

describe("snapEdgesToTargets", () => {
  it("snaps the start edge to another clip's end", () => {
    const snap = snapEdgesToTargets(3.95, 2, [{ time: 4, kind: "edge" }], 100);

    expect(snap).toEqual({ start: 4, snapTime: 4, snapKind: "edge" });
  });

  it("snaps the end edge to another clip's start", () => {
    const snap = snapEdgesToTargets(2.96, 2, [{ time: 5, kind: "edge" }], 100);

    expect(snap).toEqual({ start: 3, snapTime: 5, snapKind: "edge" });
  });

  it("snaps to the playhead", () => {
    const snap = snapEdgesToTargets(2.94, 1, [{ time: 3, kind: "playhead" }], 100);

    expect(snap).toEqual({ start: 3, snapTime: 3, snapKind: "playhead" });
  });

  it("snaps the start edge to the lower composition bound", () => {
    const snap = snapEdgesToTargets(0.04, 1, [{ time: 0, kind: "bound" }], 100);

    expect(snap).toEqual({ start: 0, snapTime: 0, snapKind: "bound" });
  });

  it("snaps the end edge to the upper composition bound", () => {
    const snap = snapEdgesToTargets(7.96, 2, [{ time: 10, kind: "bound" }], 100);

    expect(snap).toEqual({ start: 8, snapTime: 10, snapKind: "bound" });
  });

  it("does not snap when targets are beyond the pixel threshold", () => {
    const snap = snapEdgesToTargets(3.9, 1, [{ time: 4, kind: "edge" }], 100);

    expect(snap).toEqual({ start: 3.9, snapTime: null, snapKind: null });
  });
});

describe("snapResizeEdgeToTargets", () => {
  it("does not apply end-edge snaps past maxEnd or below minDuration", () => {
    expect(
      snapResizeEdgeToTargets("end", 4, 2.95, [{ time: 7.01, kind: "edge" }], 100, {
        minDuration: 0.05,
        maxEnd: 7,
      }),
    ).toEqual({ start: 4, duration: 2.95, snapTime: null, snapKind: null });

    expect(
      snapResizeEdgeToTargets("end", 4, 0.1, [{ time: 4.03, kind: "edge" }], 100, {
        minDuration: 0.05,
        maxEnd: 10,
      }),
    ).toEqual({ start: 4, duration: 0.1, snapTime: null, snapKind: null });
  });
});

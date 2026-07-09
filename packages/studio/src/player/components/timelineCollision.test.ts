import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import {
  buildTrackInsert,
  isLaneFree,
  resolveInsertRow,
  resolvePlacement,
  snapClearOfClips,
  timeRangesOverlap,
} from "./timelineCollision";

function el(id: string, track: number, start: number, duration: number): TimelineElement {
  return { id, tag: "video", start, duration, track };
}

describe("timeRangesOverlap", () => {
  it("detects overlap and treats touching edges as free (half-open)", () => {
    expect(timeRangesOverlap(0, 2, 1, 3)).toBe(true);
    expect(timeRangesOverlap(0, 2, 2, 4)).toBe(false); // touching at 2
    expect(timeRangesOverlap(2, 4, 0, 2)).toBe(false);
  });
});

describe("isLaneFree", () => {
  const els = [el("a", 0, 0, 5), el("b", 1, 2, 3)];

  it("is free when nothing overlaps on the track", () => {
    expect(isLaneFree(els, 2, 0, 5, null)).toBe(true);
    expect(isLaneFree(els, 0, 6, 8, null)).toBe(true); // same track, no time overlap
  });

  it("is occupied when a clip overlaps on the same track", () => {
    expect(isLaneFree(els, 0, 1, 3, null)).toBe(false);
  });

  it("ignores the excluded (dragged) clip", () => {
    expect(isLaneFree(els, 0, 1, 3, "a")).toBe(true);
  });
});

describe("resolvePlacement", () => {
  const trackOrder = [0, 1, 2, 3];

  it("keeps the desired lane when it is free", () => {
    const els = [el("a", 2, 0, 4)];
    expect(
      resolvePlacement({
        elements: els,
        desiredTrack: 1,
        start: 0,
        duration: 4,
        trackOrder,
        excludeKey: null,
      }),
    ).toEqual({
      track: 1,
      needsInsert: false,
    });
  });

  it("pushes up to the nearest free lane above when the target is occupied", () => {
    // desired = 2 occupied; 1 free above → land on 1
    const els = [el("blocker", 2, 0, 4)];
    expect(
      resolvePlacement({
        elements: els,
        desiredTrack: 2,
        start: 1,
        duration: 2,
        trackOrder,
        excludeKey: null,
      }),
    ).toEqual({ track: 1, needsInsert: false });
  });

  it("prefers up even when a lane below is also free", () => {
    // desired 2 occupied; both 1 (up) and 3 (down) free → up wins
    const els = [el("blocker", 2, 0, 5)];
    expect(
      resolvePlacement({
        elements: els,
        desiredTrack: 2,
        start: 0,
        duration: 3,
        trackOrder,
        excludeKey: null,
      }),
    ).toEqual({ track: 1, needsInsert: false });
  });

  it("falls to a lane below when every lane above is occupied", () => {
    // desired 1 occupied; 0 occupied above; 2 free below → land on 2
    const els = [el("x", 0, 0, 5), el("y", 1, 0, 5)];
    expect(
      resolvePlacement({
        elements: els,
        desiredTrack: 1,
        start: 1,
        duration: 2,
        trackOrder,
        excludeKey: null,
      }),
    ).toEqual({ track: 2, needsInsert: false });
  });

  it("signals needsInsert when no lane is free", () => {
    const els = [el("a", 0, 0, 9), el("b", 1, 0, 9), el("c", 2, 0, 9), el("d", 3, 0, 9)];
    expect(
      resolvePlacement({
        elements: els,
        desiredTrack: 2,
        start: 1,
        duration: 2,
        trackOrder,
        excludeKey: null,
      }),
    ).toEqual({ track: 2, needsInsert: true });
  });

  it("placeholder-scenario excludes the dragged clip so it does not collide with itself", () => {
    const els = [el("self", 1, 0, 5)];
    expect(
      resolvePlacement({
        elements: els,
        desiredTrack: 1,
        start: 0,
        duration: 5,
        trackOrder,
        excludeKey: "self",
      }),
    ).toEqual({ track: 1, needsInsert: false });
  });
});

describe("snapClearOfClips", () => {
  const lane = [el("a", 0, 0, 2), el("b", 0, 2, 2)]; // two flush clips: [0,2) [2,4)

  it("leaves a non-overlapping start untouched", () => {
    expect(snapClearOfClips(lane, 5, 1, null)).toBe(5);
  });

  it("butts flush after the clip it overlaps, cascading past a run", () => {
    expect(snapClearOfClips(lane, 1, 1, null)).toBe(4); // overlaps [0,2)→2, then [2,4)→4
    expect(snapClearOfClips(lane, 3, 1, null)).toBe(4); // overlaps [2,4)→4
  });

  it("ignores the dragged clip itself", () => {
    expect(snapClearOfClips([el("self", 0, 0, 5)], 1, 2, "self")).toBe(1);
  });
});

describe("buildTrackInsert", () => {
  it("inserts above the top lane by shifting everyone down (indices stay ≥ 0)", () => {
    const els = [el("a", 0, 0, 5), el("b", 1, 0, 5)];
    expect(buildTrackInsert(els, [0, 1], 0, null)).toEqual({
      draggedTrack: 0,
      shifts: [
        { key: "a", toTrack: 1 },
        { key: "b", toTrack: 2 },
      ],
    });
  });

  it("inserts below the bottom lane with no shifts", () => {
    const els = [el("a", 0, 0, 5), el("b", 1, 0, 5)];
    expect(buildTrackInsert(els, [0, 1], 2, null)).toEqual({ draggedTrack: 2, shifts: [] });
  });

  it("slots into an existing integer gap without moving anyone", () => {
    const els = [el("a", 0, 0, 5), el("b", 2, 0, 5), el("c", 5, 0, 5)];
    // insert between rows 0 (track 0) and 1 (track 2): gap 2-0 ≥ 2 → track 1, no shifts
    expect(buildTrackInsert(els, [0, 2, 5], 1, null)).toEqual({ draggedTrack: 1, shifts: [] });
  });

  it("bumps clips below when lanes are consecutive", () => {
    const els = [el("a", 0, 0, 5), el("b", 1, 0, 5), el("c", 2, 0, 5)];
    // insert between rows 1 (track 1) and 2 (track 2): consecutive → dragged takes 2,
    // every clip on track ≥ 2 bumps down one lane.
    expect(buildTrackInsert(els, [0, 1, 2], 2, null)).toEqual({
      draggedTrack: 2,
      shifts: [{ key: "c", toTrack: 3 }],
    });
  });

  it("excludes the dragged clip from the shift set", () => {
    const els = [el("a", 0, 0, 5), el("dragged", 1, 0, 5), el("c", 2, 0, 5)];
    // insert at row 1 (between track 0 and 1), consecutive → bump ≥1, but skip dragged
    const plan = buildTrackInsert(els, [0, 1, 2], 1, "dragged");
    expect(plan.draggedTrack).toBe(1);
    expect(plan.shifts).toEqual([{ key: "c", toTrack: 3 }]);
  });
});

describe("resolveInsertRow", () => {
  const n = 3; // three lanes: rows 0,1,2

  it("targets the lane (null) when over its middle band", () => {
    expect(resolveInsertRow(1.5, n, 0.22)).toBe(null); // dead center of lane 1
  });

  it("inserts at the top boundary of a lane when near its top edge", () => {
    expect(resolveInsertRow(1.1, n, 0.22)).toBe(1); // just into lane 1 → boundary above it
  });

  it("inserts at the bottom boundary of a lane when near its bottom edge", () => {
    expect(resolveInsertRow(1.9, n, 0.22)).toBe(2); // near bottom of lane 1 → boundary below
  });

  it("inserts above the top lane when the pointer is above everything", () => {
    expect(resolveInsertRow(-0.5, n, 0.22)).toBe(0);
  });

  it("inserts below the bottom lane when the pointer is past the last lane", () => {
    expect(resolveInsertRow(3.4, n, 0.22)).toBe(3);
  });
});

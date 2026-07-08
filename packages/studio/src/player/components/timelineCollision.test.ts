import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { isLaneFree, resolvePlacement, timeRangesOverlap } from "./timelineCollision";

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

  it("excludes the dragged clip so it does not collide with itself", () => {
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

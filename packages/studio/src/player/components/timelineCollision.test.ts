import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import {
  clampTrackToZone,
  isInsertAllowedForZone,
  isLaneFree,
  resolveInsertRow,
  resolvePlacement,
  resolveZoneDropPlacement,
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

describe("clampTrackToZone", () => {
  // trackOrder [0,1,2,3]: rows 0,1 = visual; rows 2,3 = audio (audioRow = 2).
  const order = [0, 1, 2, 3];

  it("is a no-op when there is no audio zone", () => {
    expect(clampTrackToZone(3, order, -1, false)).toBe(3);
  });

  it("keeps a visual clip in the visual zone", () => {
    expect(clampTrackToZone(1, order, 2, false)).toBe(1); // already visual
    expect(clampTrackToZone(3, order, 2, false)).toBe(1); // in audio → last visual lane
  });

  it("keeps an audio clip in the audio zone", () => {
    expect(clampTrackToZone(2, order, 2, true)).toBe(2); // already audio
    expect(clampTrackToZone(0, order, 2, true)).toBe(2); // in visual → first audio lane
  });
});

describe("isInsertAllowedForZone", () => {
  // audioRow = 2
  it("allows any insert when there is no audio zone", () => {
    expect(isInsertAllowedForZone(0, -1, false)).toBe(true);
    expect(isInsertAllowedForZone(3, -1, true)).toBe(true);
  });

  it("allows a visual insert only at/above the audio zone top", () => {
    expect(isInsertAllowedForZone(0, 2, false)).toBe(true);
    expect(isInsertAllowedForZone(2, 2, false)).toBe(true); // bottom of the visual zone
    expect(isInsertAllowedForZone(3, 2, false)).toBe(false); // inside the audio zone
  });

  it("allows an audio insert only at/below the audio zone top (audio clips make audio tracks)", () => {
    expect(isInsertAllowedForZone(2, 2, true)).toBe(true);
    expect(isInsertAllowedForZone(4, 2, true)).toBe(true); // below the bottom
    expect(isInsertAllowedForZone(1, 2, true)).toBe(false); // inside the visual zone
  });
});

describe("resolveZoneDropPlacement (the whole drop decision, no same-track overlap)", () => {
  // order [0,1,2] visual + [3] audio. audioRow = 3.
  const order = [0, 1, 2, 3];
  const audioTracks = new Set([3]);
  const base = {
    order,
    audioTracks,
    deliberateInsertRow: null as number | null,
    start: 2,
    duration: 2,
    dragKey: "x",
    isAudio: false,
  };

  it("lands on the aimed track when it is free at that time", () => {
    expect(
      resolveZoneDropPlacement({ ...base, elements: [el("a", 1, 10, 3)], desiredTrack: 1 }),
    ).toEqual({ track: 1, insertRow: null });
  });

  it("relocates UP to the nearest free track when the aimed spot overlaps a clip", () => {
    expect(
      resolveZoneDropPlacement({ ...base, elements: [el("a", 1, 0, 5)], desiredTrack: 1 }),
    ).toEqual({ track: 0, insertRow: null });
  });

  it("relocates DOWN when the tracks above are also occupied", () => {
    expect(
      resolveZoneDropPlacement({
        ...base,
        elements: [el("a", 0, 0, 5), el("b", 1, 0, 5)],
        desiredTrack: 1,
      }),
    ).toEqual({ track: 2, insertRow: null });
  });

  it("auto-creates a new track when EVERY lane in the zone is occupied at that time", () => {
    expect(
      resolveZoneDropPlacement({
        ...base,
        elements: [el("a", 0, 0, 5), el("b", 1, 0, 5), el("c", 2, 0, 5)],
        desiredTrack: 1,
      }),
    ).toEqual({ track: 1, insertRow: 2 });
  });

  it("shares a track for sequential (non-overlapping) clips", () => {
    expect(
      resolveZoneDropPlacement({
        ...base,
        elements: [el("a", 1, 0, 2)],
        desiredTrack: 1,
        start: 2,
      }),
    ).toEqual({ track: 1, insertRow: null });
  });

  it("clamps a visual clip OUT of the audio zone before placing", () => {
    expect(resolveZoneDropPlacement({ ...base, elements: [], desiredTrack: 3 })).toEqual({
      track: 2,
      insertRow: null,
    });
  });

  it("clamps an audio clip INTO the audio zone before placing", () => {
    expect(
      resolveZoneDropPlacement({ ...base, elements: [], desiredTrack: 0, isAudio: true }),
    ).toEqual({ track: 3, insertRow: null });
  });

  it("honors a deliberate boundary insert in the clip's own zone", () => {
    expect(
      resolveZoneDropPlacement({ ...base, elements: [], desiredTrack: 1, deliberateInsertRow: 1 }),
    ).toEqual({ track: 1, insertRow: 1 });
  });

  it("ignores a deliberate insert that lands in the WRONG zone (visual into audio)", () => {
    expect(
      resolveZoneDropPlacement({ ...base, elements: [], desiredTrack: 1, deliberateInsertRow: 4 }),
    ).toEqual({ track: 1, insertRow: null });
  });

  it("lets an AUDIO clip create a new audio track via a boundary insert", () => {
    expect(
      resolveZoneDropPlacement({
        ...base,
        elements: [],
        desiredTrack: 3,
        isAudio: true,
        deliberateInsertRow: 4,
      }),
    ).toEqual({ track: 3, insertRow: 4 });
  });
});

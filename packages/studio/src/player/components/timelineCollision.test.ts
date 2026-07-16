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
import { INSERT_BOUNDARY_BAND } from "./timelineLayout";

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

  it("signals needsInsert when the desired track is occupied but absent from the zone's lanes (#2195)", () => {
    // desiredTrack 5 is occupied yet not in trackOrder (its kind-zone has no lane
    // here). Landing on it would overlap, so the empty-zone branch must insert —
    // not silently land on the occupied track (the placement hole).
    const els = [el("blocker", 5, 0, 5)];
    expect(
      resolvePlacement({
        elements: els,
        desiredTrack: 5,
        start: 1,
        duration: 2,
        trackOrder: [],
        excludeKey: null,
      }),
    ).toEqual({ track: 5, needsInsert: true });
  });

  it("signals needsInsert when the desired track is FREE but absent from the zone's lanes (#2195 free-span hole)", () => {
    // desiredTrack 5 is FREE (no overlap) yet not in trackOrder — its kind-zone has
    // no lane here. The old code short-circuited on isLaneFree and landed on the
    // foreign-zone lane; the zone check must win and signal an insert.
    const els = [el("elsewhere", 9, 0, 5)];
    expect(
      resolvePlacement({
        elements: els,
        desiredTrack: 5,
        start: 1,
        duration: 2,
        trackOrder: [],
        excludeKey: null,
      }),
    ).toEqual({ track: 5, needsInsert: true });
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

describe("resolveInsertRow — production band only arms in the inter-clip gutter (UX rule 1)", () => {
  // The production band equals the clip inset (CLIP_Y / TRACK_H): a clip body fills
  // [band, 1 − band] of its row, so an insert must ONLY arm in the thin gutter that
  // straddles a boundary — never while the pointer is over a clip body. This is the
  // regression for the plain-horizontal-drag misfire (the old 0.32 band armed an
  // insert across ~64% of every row).
  const n = 3;
  const b = INSERT_BOUNDARY_BAND;

  it("the band is the clip inset (3/48), not the old feel-tuned 0.32", () => {
    expect(b).toBeCloseTo(3 / 48, 10);
    expect(b).toBeLessThan(0.1);
  });

  it("returns null across the WHOLE clip body of every lane (no insert = move-to-lane)", () => {
    // Sweep each lane's body [band+ε, 1−band−ε] in fine steps → always a move.
    for (let lane = 0; lane < n; lane++) {
      for (let frac = b + 0.01; frac <= 1 - b - 0.01 + 1e-9; frac += 0.02) {
        expect(resolveInsertRow(lane + frac, n, b)).toBeNull();
      }
    }
  });

  it("arms an insert in the gutter straddling every internal boundary (dead-zone-free)", () => {
    // Just under a boundary → insert BELOW the upper lane; just over → ABOVE the
    // lower lane. Both resolve to the same boundary row, so the gutter has no dead
    // spot that neither moves nor inserts.
    expect(resolveInsertRow(1 - b / 2, n, b)).toBe(1); // bottom gutter of lane 0
    expect(resolveInsertRow(1 + b / 2, n, b)).toBe(1); // top gutter of lane 1
    expect(resolveInsertRow(2 - b / 2, n, b)).toBe(2);
    expect(resolveInsertRow(2 + b / 2, n, b)).toBe(2);
  });

  it("still arms a top / bottom insert above the first / below the last lane", () => {
    expect(resolveInsertRow(b / 2, n, b)).toBe(0); // top gutter of lane 0 → insert above top
    expect(resolveInsertRow(-0.4, n, b)).toBe(0); // in the top breathing pad
    expect(resolveInsertRow(n - b / 2, n, b)).toBe(n); // bottom gutter of last lane
    expect(resolveInsertRow(n + 0.4, n, b)).toBe(n); // in the bottom breathing pad
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

  // Every visual lane (0,1,2) occupied across the drop span → no free lane exists.
  const allVisualOccupied = () => [el("a", 0, 0, 10), el("b", 1, 0, 10), el("c", 2, 0, 10)];

  it("occupied aim with NO free lane creates an adjacent track — never snaps back (UX rule 3)", () => {
    // The clip must NOT return to its origin; it gets a fresh track adjacent to the
    // aim. Default bias = below the aimed row.
    const result = resolveZoneDropPlacement({
      ...base,
      elements: allVisualOccupied(),
      desiredTrack: 1,
    });
    expect(result.insertRow).not.toBeNull(); // a track is created, not an origin snap-back
    expect(result).toEqual({ track: 1, insertRow: 2 }); // adjacent, below the aimed row
  });

  it("opens the new adjacent track ABOVE the aimed row when the pointer is in its upper half (UX rule 3)", () => {
    expect(
      resolveZoneDropPlacement({
        ...base,
        elements: allVisualOccupied(),
        desiredTrack: 1,
        preferInsertAbove: true,
      }),
    ).toEqual({ track: 1, insertRow: 1 }); // boundary ABOVE lane 1
    // Same aim, pointer in the lower half → the track opens BELOW the aimed row.
    expect(
      resolveZoneDropPlacement({
        ...base,
        elements: allVisualOccupied(),
        desiredTrack: 1,
        preferInsertAbove: false,
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

  it("upward create-drag off the top lane inserts at the TOP of the visual zone, never below audio (reviewer repro)", () => {
    // 3-visual + 1-audio timeline. Dragging a top-lane visual clip up past the
    // create threshold emits the sentinel desiredTrack = minTrack-1 = -1. The
    // old hoist did order.indexOf(-1) = -1 and fell to below = order.length = 4,
    // creating the new track BELOW the audio zone — repro {track:-1, insertRow:4}.
    // It must now anchor to the top boundary of the visual zone.
    expect(
      resolveZoneDropPlacement({ ...base, elements: allVisualOccupied(), desiredTrack: -1 }),
    ).toEqual({ track: -1, insertRow: 0 });
  });

  it("downward create-drag off the bottom visual lane inserts at the audio boundary, never below it", () => {
    // Sentinel desiredTrack = maxTrack+1 = 4 for a downward create-drag. A visual
    // clip must land at the bottom of the visual zone (row 3 = just above audio),
    // not past the audio lanes.
    expect(
      resolveZoneDropPlacement({ ...base, elements: allVisualOccupied(), desiredTrack: 4 }),
    ).toEqual({ track: 4, insertRow: 3 });
  });

  it("audio create-drag with an out-of-range aim inserts inside the audio zone", () => {
    // An audio clip aimed above its zone (sentinel below its own min lane) anchors
    // to the audio zone's top boundary (row 3), not into the visual zone.
    expect(
      resolveZoneDropPlacement({
        ...base,
        elements: [el("a", 3, 0, 10)],
        desiredTrack: -1,
        isAudio: true,
      }),
    ).toEqual({ track: -1, insertRow: 3 });
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

  it("Abhai repro: audio dropped on a visual-only timeline over an occupied span → insert, no overlap (#2195)", () => {
    // No audio zone exists yet (audioTracks empty). The audio clip is aimed at the
    // sole visual lane, which is occupied at the drop time. The zone-drop must
    // create the audio zone's first lane (insertRow set) rather than stacking the
    // audio clip onto the occupied visual track — the no-overlap invariant.
    const result = resolveZoneDropPlacement({
      order: [0],
      audioTracks: new Set<number>(),
      elements: [el("v", 0, 0, 5)],
      desiredTrack: 0,
      deliberateInsertRow: null,
      start: 1,
      duration: 2,
      dragKey: "audio",
      isAudio: true,
    });
    expect(result.insertRow).not.toBeNull();
    expect(result).toEqual({ track: 0, insertRow: 1 });
  });

  it("free-span repro: audio dropped on a FREE stretch of a visual-only timeline → insert, not a visual lane (#2195)", () => {
    // Same visual-only timeline, but the audio clip is aimed at a stretch the sole
    // visual lane is FREE at. The zone check must still fire an insert (create the
    // audio zone) rather than short-circuiting on isLaneFree and dropping the audio
    // clip onto the visual lane — the kind-zone hole where the free-lane fast path
    // beat the wrong-zone check.
    const result = resolveZoneDropPlacement({
      order: [0],
      audioTracks: new Set<number>(),
      elements: [el("v", 0, 0, 5)],
      desiredTrack: 0,
      deliberateInsertRow: null,
      start: 10, // past the visual clip's end → the visual lane is FREE here
      duration: 2,
      dragKey: "audio",
      isAudio: true,
    });
    expect(result.insertRow).not.toBeNull();
    expect(result).toEqual({ track: 0, insertRow: 1 });
  });
});

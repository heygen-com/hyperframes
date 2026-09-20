import { describe, expect, it } from "vitest";
import { placeClip, type PlacementClip, type PlacementMode } from "./timelinePlacement";

const clips: PlacementClip[] = [
  { key: "a", start: 0, duration: 4 },
  { key: "b", start: 4, duration: 4 },
];
const place = (
  start: number,
  duration: number,
  mode: PlacementMode = "overwrite",
  on: PlacementClip[] = clips,
) => placeClip({ clips: on, start, duration, mode });

describe("placeClip overwrite", () => {
  it("leaves an abutting neighbour alone", () => {
    expect(place(8, 2).cuts).toEqual([]);
  });

  it("removes a clip the drop fully covers", () => {
    expect(place(3.5, 5).cuts).toEqual([
      { kind: "trim-tail", key: "a", duration: 3.5 },
      { kind: "remove", key: "b" },
    ]);
  });

  it("trims the tail of a clip the drop starts inside", () => {
    expect(place(6, 4).cuts).toEqual([{ kind: "trim-tail", key: "b", duration: 2 }]);
  });

  it("trims the head of a clip the drop ends inside and reports the source shift", () => {
    expect(place(2, 3).cuts).toEqual([
      { kind: "trim-tail", key: "a", duration: 2 },
      { kind: "trim-head", key: "b", start: 5, duration: 3, sourceShift: 1 },
    ]);
  });

  it("splits a clip the drop lands in the middle of", () => {
    expect(place(1, 2, "overwrite", [clips[0]]).cuts).toEqual([
      { kind: "split", key: "a", headDuration: 1, tail: { start: 3, duration: 1, sourceShift: 3 } },
    ]);
  });

  it("shifts nothing", () => {
    const r = place(2, 3);
    expect(r.shifts).toEqual([]);
  });

  it("clamps a negative start to zero", () => {
    expect(place(-1, 2).start).toBe(0);
  });
});

describe("placeClip insert", () => {
  it("pushes every clip at or after the drop point by the clip length", () => {
    expect(place(4, 2, "insert").shifts).toEqual([{ key: "b", start: 6 }]);
  });

  it("splits a clip straddling the drop point and pushes its tail past the new clip", () => {
    const r = place(6, 2, "insert");
    expect(r.cuts).toEqual([
      { kind: "split", key: "b", headDuration: 2, tail: { start: 8, duration: 2, sourceShift: 2 } },
    ]);
    expect(r.shifts).toEqual([]);
  });

  it("leaves clips wholly before the drop point alone", () => {
    const r = place(8, 2, "insert");
    expect(r.cuts).toEqual([]);
    expect(r.shifts).toEqual([]);
  });
});

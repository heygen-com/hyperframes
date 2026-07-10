import { describe, expect, it } from "vitest";
import { computeStackingPatches, laneIsAbove, type StackingElement } from "./timelineStackingSync";

function el(
  key: string,
  track: number,
  start: number,
  duration: number,
  zIndex: number,
  isAudio = false,
): StackingElement {
  return { key, track, start, duration, zIndex, isAudio };
}

function patchMap(elements: StackingElement[], edited: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of computeStackingPatches(elements, edited)) out[p.key] = p.zIndex;
  return out;
}

describe("laneIsAbove", () => {
  it("lower track renders above (top of timeline wins)", () => {
    expect(laneIsAbove({ track: 0 }, { track: 1 })).toBe(true);
    expect(laneIsAbove({ track: 2 }, { track: 1 })).toBe(false);
    expect(laneIsAbove({ track: 1 }, { track: 1 })).toBe(false);
  });
});

describe("computeStackingPatches", () => {
  it("no overlapping clips → no patch", () => {
    // a (0..5 on track 0) and b (10..15 on track 1) never overlap in time.
    const elements = [el("a", 0, 0, 5, 10), el("b", 1, 10, 5, 5)];
    expect(patchMap(elements, ["a"])).toEqual({});
  });

  it("edited clip moved to a HIGHER lane (top) but z too low → raised above the below-neighbour", () => {
    // a on top lane (0) overlaps b on lane 1; a.z=1 is below b.z=5 → wrong.
    const elements = [el("a", 0, 0, 10, 1), el("b", 1, 0, 10, 5)];
    // Only a is edited → only a gets a patch, lifting it above b (5) → 6.
    expect(patchMap(elements, ["a"])).toEqual({ a: 6 });
  });

  it("edited clip moved to a LOWER lane (bottom) but z too high → lowered below the above-neighbour", () => {
    // a on lane 2 (bottom) overlaps b on lane 0 (top); a.z=9 above b.z=5 → wrong.
    const elements = [el("a", 2, 0, 10, 9), el("b", 0, 0, 10, 5)];
    expect(patchMap(elements, ["a"])).toEqual({ a: 4 });
  });

  it("edited clip already correctly ordered → no patch (authored z preserved)", () => {
    // a on top lane already has higher z than the lower-lane b it overlaps.
    const elements = [el("a", 0, 0, 10, 8), el("b", 1, 0, 10, 3)];
    expect(patchMap(elements, ["a"])).toEqual({});
  });

  it("untouched clips never get a patch even when they overlap the edit", () => {
    // b is out of order relative to a, but a is the only edited clip.
    const elements = [el("a", 0, 0, 10, 1), el("b", 1, 0, 10, 5), el("c", 2, 0, 10, 9)];
    const patches = computeStackingPatches(elements, ["a"]);
    expect(patches.map((p) => p.key)).toEqual(["a"]);
  });

  it("sits strictly between neighbours when there is integer room", () => {
    // edited a on middle lane 1 between below-lane-2 (z=2) and above-lane-0 (z=10).
    const elements = [el("a", 1, 0, 10, 0), el("below", 2, 0, 10, 2), el("above", 0, 0, 10, 10)];
    // Between 2 and 10 → floor((2+10)/2)=6.
    expect(patchMap(elements, ["a"])).toEqual({ a: 6 });
  });

  it("adjacent neighbours (no integer gap) → lands just above the lower neighbour", () => {
    // below z=4, above z=5 (adjacent). Edited must go above 4 → 5 (still < nothing to fit).
    const elements = [el("a", 1, 0, 10, 0), el("below", 2, 0, 10, 4), el("above", 0, 0, 10, 5)];
    expect(patchMap(elements, ["a"])).toEqual({ a: 5 });
  });

  it("audio clips are excluded — an audio edit yields no patch", () => {
    const elements = [el("music", 3, 0, 10, 0, true), el("v", 0, 0, 10, 5)];
    expect(patchMap(elements, ["music"])).toEqual({});
  });

  it("audio clips are excluded as neighbours — a visual edit ignores overlapping audio", () => {
    // The only overlapping clip is audio → treated as no visual overlap → no patch.
    const elements = [el("v", 0, 0, 10, 3), el("music", 3, 0, 10, 99, true)];
    expect(patchMap(elements, ["v"])).toEqual({});
  });

  it("only-below neighbours → maxBelow + 1", () => {
    const elements = [el("a", 0, 0, 10, 0), el("b", 1, 0, 10, 3), el("c", 2, 0, 10, 7)];
    // a on top overlaps b(3) and c(7), both below → 7+1=8.
    expect(patchMap(elements, ["a"])).toEqual({ a: 8 });
  });

  it("only-above neighbours → minAbove - 1 (clamped ≥ 0)", () => {
    const elements = [el("a", 2, 0, 10, 9), el("b", 0, 0, 10, 1), el("c", 1, 0, 10, 4)];
    // a on bottom overlaps b(1) and c(4), both above → min(1)-1=0.
    expect(patchMap(elements, ["a"])).toEqual({ a: 0 });
  });

  it("partial time overlap still counts", () => {
    // a: 0..6, b: 5..15 overlap in [5,6).
    const elements = [el("a", 0, 0, 6, 1), el("b", 1, 5, 10, 5)];
    expect(patchMap(elements, ["a"])).toEqual({ a: 6 });
  });

  it("touching-but-not-overlapping intervals do NOT count", () => {
    // a ends exactly where b starts (t=5) → half-open, no overlap.
    const elements = [el("a", 0, 0, 5, 1), el("b", 1, 5, 5, 5)];
    expect(patchMap(elements, ["a"])).toEqual({});
  });

  it("multi-clip edit: two dragged clips resolve consistently against the region", () => {
    // Drag a (lane 0) and b (lane 1) onto a region already holding c (lane 2, z=5).
    // Both overlap c. Lower-lane b resolves first (above c → 6), then a (above b → 7).
    const elements = [el("a", 0, 0, 10, 0), el("b", 1, 0, 10, 0), el("c", 2, 0, 10, 5)];
    expect(patchMap(elements, ["a", "b"])).toEqual({ a: 7, b: 6 });
  });

  it("multi-clip edit skips a member that is already correctly ordered", () => {
    const elements = [el("a", 0, 0, 10, 20), el("b", 1, 0, 10, 0), el("c", 2, 0, 10, 5)];
    // a(20) already above everything → no patch. b (lane 1) sits between
    // below-neighbour c(5) and above-neighbour a(20) → floor((5+20)/2)=12.
    expect(patchMap(elements, ["a", "b"])).toEqual({ b: 12 });
  });

  it("empty edited set → no patches", () => {
    const elements = [el("a", 0, 0, 10, 1), el("b", 1, 0, 10, 5)];
    expect(computeStackingPatches(elements, [])).toEqual([]);
  });
});

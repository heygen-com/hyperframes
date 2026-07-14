import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { computeZOverrideKeys } from "./timelineZOverride";

// Elements are listed in discovery order — the array index is the DOM document
// position (the equal-z tie-break input), matching the production caller.
function el(
  id: string,
  track: number,
  zIndex: number | undefined,
  extra: Partial<TimelineElement> = {},
): TimelineElement {
  return { id, key: id, tag: "video", start: 0, duration: 10, track, domId: id, zIndex, ...extra };
}

describe("computeZOverrideKeys", () => {
  it("no badge when paint order matches lane order", () => {
    // top lane (0) has the higher z — consistent.
    const top = el("top", 0, 5);
    const bottom = el("bottom", 1, 2);
    expect(computeZOverrideKeys([top, bottom]).size).toBe(0);
  });

  it("marks BOTH ends of a strict contradiction (either listing direction)", () => {
    // top lane paints BELOW the bottom lane — both clips carry the badge.
    const top = el("top", 0, 1);
    const bottom = el("bottom", 1, 9);
    expect(computeZOverrideKeys([top, bottom])).toEqual(new Set(["top", "bottom"]));
    // Same pair discovered in the other DOM order — same verdict (z is strict,
    // so domIndex never enters).
    expect(computeZOverrideKeys([bottom, top])).toEqual(new Set(["top", "bottom"]));
  });

  it("equal z resolves by DOM order: later-in-DOM paints on top", () => {
    // Consistent: the top-lane clip is later in the DOM, so at equal z it paints
    // on top — exactly what its lane says.
    const bottom = el("bottom", 1, 3);
    const top = el("top", 0, 3);
    expect(computeZOverrideKeys([bottom, top]).size).toBe(0);
    // Contradiction: the top-lane clip is EARLIER in the DOM, so at equal z it
    // paints below — both ends marked.
    expect(computeZOverrideKeys([top, bottom])).toEqual(new Set(["top", "bottom"]));
  });

  it("non-overlapping clips never contradict", () => {
    const top = el("top", 0, 1);
    const bottom = el("bottom", 1, 9, { start: 20, duration: 5 });
    expect(computeZOverrideKeys([top, bottom]).size).toBe(0);
  });

  it("abutting clips (epsilon half-open spans) do not overlap", () => {
    const a = el("a", 0, 1);
    const b = el("b", 1, 9, { start: 10, duration: 5 }); // starts exactly at a's end
    expect(computeZOverrideKeys([a, b]).size).toBe(0);
  });

  it("clips in different stacking contexts are never compared", () => {
    const a = el("a", 0, 1, { stackingContextId: "ctx-1" });
    const b = el("b", 1, 9, { stackingContextId: "ctx-2" });
    expect(computeZOverrideKeys([a, b]).size).toBe(0);
    // null and undefined both mean the root context — those DO compare.
    const c = el("c", 0, 1, { stackingContextId: null });
    const d = el("d", 1, 9, { stackingContextId: undefined });
    expect(computeZOverrideKeys([c, d])).toEqual(new Set(["c", "d"]));
  });

  it("audio clips and unresolved-z clips are excluded", () => {
    const visual = el("v", 1, 9);
    const music = el("m", 0, 1, { tag: "audio" }); // would contradict if compared
    const unknownZ = el("u", 0, undefined); // unresolved z never fabricates a contradiction
    const nanZ = el("n", 0, Number.NaN);
    expect(computeZOverrideKeys([music, unknownZ, nanZ, visual]).size).toBe(0);
  });

  it("zero-duration clips are excluded", () => {
    const ghost = el("g", 0, 1, { duration: 0 });
    const solid = el("s", 1, 9);
    expect(computeZOverrideKeys([ghost, solid]).size).toBe(0);
  });

  it("marks only the contradicting pair in a mixed stack", () => {
    // Lanes 0/1/2 with z 9/1/5: (top,mid) contradicts (1 < ... wait — top z9
    // beats both, consistent; mid z1 vs low z5 contradicts (mid is the upper
    // lane but paints below) → mid + low marked, top clean.
    const top = el("top", 0, 9);
    const mid = el("mid", 1, 1);
    const low = el("low", 2, 5);
    expect(computeZOverrideKeys([top, mid, low])).toEqual(new Set(["mid", "low"]));
  });
});

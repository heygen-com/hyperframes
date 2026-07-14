import { describe, expect, it } from "vitest";
import { computeStackingPatches, laneIsAbove, type StackingElement } from "./timelineStackingSync";

function el(
  key: string,
  track: number,
  start: number,
  duration: number,
  zIndex: number,
  isAudio = false,
  domIndex?: number,
): StackingElement {
  return { key, track, start, duration, zIndex, isAudio, domIndex };
}

function patchMap(elements: StackingElement[], edited: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of computeStackingPatches(elements, edited)) out[p.key] = p.zIndex;
  return out;
}

describe("stacking-context partitioning", () => {
  it("never compares or patches across stacking contexts", () => {
    // X lives in sub-comp context "scene-1" with a high leaf z; Y is a root clip
    // with a lower leaf z, overlapping in time. Their leaf z values are NOT
    // comparable (the ancestors' z decides paint order), so moving X's lane above
    // Y must not reason on Y or patch either based on the 10-vs-5 comparison.
    const x: StackingElement = {
      key: "x",
      track: 0,
      start: 0,
      duration: 5,
      zIndex: 10,
      isAudio: false,
      stackingContextId: "scene-1",
    };
    const y: StackingElement = {
      key: "y",
      track: 1,
      start: 0,
      duration: 5,
      zIndex: 5,
      isAudio: false,
      stackingContextId: null,
    };
    // X edited: only same-context neighbours participate — none here, so X keeps
    // its z (nothing to fix WITHIN its context) and Y is never touched.
    expect(patchMap([x, y], ["x"])).toEqual({});
  });

  it("still resolves within the edited clip's own context", () => {
    const a: StackingElement = {
      key: "a",
      track: 1,
      start: 0,
      duration: 5,
      zIndex: 1,
      isAudio: false,
      stackingContextId: "scene-1",
    };
    const b: StackingElement = {
      key: "b",
      track: 0,
      start: 0,
      duration: 5,
      zIndex: 5,
      isAudio: false,
      stackingContextId: "scene-1",
    };
    // 'a' moved BELOW b's lane... a (track 1) is under b (track 0): a's z (1)
    // is already below b's (5) — consistent, no patch. Move a ABOVE (track -1
    // relative ordering) is covered by existing suites; here we just prove the
    // same-context pair still participates (no patch ≠ no participation: verify
    // by flipping z so a MUST be lifted).
    const aWrong = { ...a, track: 0, zIndex: 1 };
    const bLow = { ...b, track: 1, zIndex: 5 };
    const patches = patchMap([aWrong, bLow], ["a"]);
    expect(patches.a).toBeGreaterThan(5);
  });
});

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

  it("adjacent neighbours (no integer gap) → edited lands above lower, upper is bumped", () => {
    // below z=4, above z=5 (adjacent). There is no integer strictly between 4 and
    // 5, so the old single-patch a=5 left `a` TIED with `above` — and with no DOM
    // order to break the tie, `above` no longer paints strictly above `a` (the
    // under-patch bug). Tie-aware cascade: a→5 (above below's 4) AND above→6 so it
    // stays strictly on top. Minimal: only the two overlapping neighbours move.
    const elements = [el("a", 1, 0, 10, 0), el("below", 2, 0, 10, 4), el("above", 0, 0, 10, 5)];
    expect(patchMap(elements, ["a"])).toEqual({ a: 5, above: 6 });
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

  it("item 13: an unresolved neighbour (non-finite z) is EXCLUDED, not treated as z=0", () => {
    // `ghost` is an overlapping upper-lane clip whose live node could not be
    // resolved, so its z came back NaN. If it were fabricated to 0 it would be a
    // real above-neighbour at the z-floor and drag the edited clip's cascade down.
    // Excluded, the only real overlap is below-neighbour b(3) → a rises to 4.
    const elements = [
      el("a", 1, 0, 10, 0),
      el("b", 2, 0, 10, 3),
      el("ghost", 0, 0, 10, Number.NaN),
    ];
    expect(patchMap(elements, ["a"])).toEqual({ a: 4 });
  });

  it("item 13: an edited clip whose own z is unresolved (non-finite) yields no patch", () => {
    // The edited clip itself couldn't be resolved → it is dropped from the working
    // set and produces nothing (no fabricated-0 self-patch).
    const elements = [el("a", 0, 0, 10, Number.NaN), el("b", 1, 0, 10, 5)];
    expect(patchMap(elements, ["a"])).toEqual({});
  });
});

describe("computeStackingPatches — tie-aware cascade (lane move always realisable)", () => {
  it("drag below an overlapping z=0 neighbour → cascade bumps the neighbour, edit→0", () => {
    // edited `v` (z=2) dragged to the BOTTOM lane, overlapping `r` (z=0) which is
    // now on the upper lane. No z ≥ 0 fits strictly below 0, so the old resolver
    // clamped v to 0 (tied with r) and nothing changed on canvas — the reported
    // bug. Tie-aware: v→0 AND r bumped to 1 so r paints strictly above v.
    const elements = [el("v", 1, 0, 10, 2), el("r", 0, 0, 10, 0)];
    expect(patchMap(elements, ["v"])).toEqual({ v: 0, r: 1 });
  });

  it("equal-z + domIndex: dragging the LATER-in-DOM clip below is realised via a bump", () => {
    // Two equal-z clips; `v` is later in DOM (domIndex 1) so it currently paints
    // ON TOP of `r` (domIndex 0). User drags v to the lower lane (track 1). With
    // domIndex the sync SEES that v is currently above r and must be lowered:
    // v→0 (already 0, stays) then r bumped to 1 so r wins. Without domIndex the
    // equal z would look already-correct and under-patch.
    const elements = [el("r", 0, 0, 10, 0, false, 0), el("v", 1, 0, 10, 0, false, 1)];
    expect(patchMap(elements, ["v"])).toEqual({ r: 1 });
  });

  it("equal-z without domIndex is ambiguous → conservatively bumps to guarantee order", () => {
    // Same shape but NO domIndex: equal z is ambiguous, so the resolver cannot
    // prove v is already below r and patches to make the order explicit (r above).
    const elements = [el("r", 0, 0, 10, 0), el("v", 1, 0, 10, 0)];
    const out = patchMap(elements, ["v"]);
    // r must end up strictly above v (higher z) regardless of the exact numbers.
    const vz = out.v ?? 0;
    const rz = out.r ?? 0;
    expect(rz).toBeGreaterThan(vz);
  });

  it("#2198 (Abhai repro): a lift cascades transitively so an UNTOUCHED pair never inverts", () => {
    // m (z1, lane0, dom0), n (z0, lane1, dom1), e (z2, lane2, dom2, edited).
    // e overlaps n [5,10); n overlaps m [12,15); e does NOT overlap m.
    // Dragging e to the bottom lane forces n up to paint above e. A naive lift sets
    // n→1, which TIES m (z1) and — n being later in the DOM — paints n above m,
    // inverting the untouched (m,n) pair (which the next normalize would reshuffle).
    // The transitive cascade lifts m too (→2) so m stays strictly above n.
    const elements = [
      el("m", 0, 12, 8, 1, false, 0),
      el("n", 1, 5, 10, 0, false, 1),
      el("e", 2, 0, 10, 2, false, 2),
    ];
    expect(patchMap(elements, ["e"])).toEqual({ e: 0, n: 1, m: 2 });
  });

  it("cascade patches as FEW clips as possible (only the blockers move)", () => {
    // v dragged to bottom under r(z0) and s(z0) both on higher lanes; a distant
    // non-overlapping clip x is never touched.
    const elements = [
      el("v", 2, 0, 10, 5),
      el("r", 0, 0, 10, 0),
      el("s", 1, 0, 10, 0),
      el("x", 3, 50, 10, 0), // no time overlap → untouched
    ];
    const out = patchMap(elements, ["v"]);
    expect("x" in out).toBe(false);
    // v below both r and s.
    expect(out.v).toBeLessThan(out.r ?? 0);
    expect(out.v).toBeLessThan(out.s ?? 0);
  });
});

describe("computeStackingPatches — DOM tie-break gates the cascade (item 12)", () => {
  it("tie ACCEPTABLE: edited may sit AT minAbove when the above-neighbour is later in DOM → single patch, no neighbour bump", () => {
    // below b (z3, lane2, dom0), edited e (lane1, dom1), above a (z4, lane0, dom2).
    // e must paint above b and below a. There is no integer strictly between 3 and
    // 4, but a is LATER in the DOM, so e=4 ties a and a still paints on top by DOM
    // order — a valid SINGLE patch. The old gap<2 rule cascaded and needlessly
    // bumped a's authored z (the over-patch). Only e changes here.
    const elements = [
      el("b", 2, 0, 10, 3, false, 0),
      el("e", 1, 0, 10, 0, false, 1),
      el("a", 0, 0, 10, 4, false, 2),
    ];
    expect(patchMap(elements, ["e"])).toEqual({ e: 4 });
  });

  it("tie INVERTING: edited tying minAbove would paint ABOVE it (earlier in DOM) → cascade bumps the neighbour", () => {
    // Same z's, but a is EARLIER in the DOM than e (dom0 vs dom2). Now e=4 would
    // tie a AND paint on top (e later in DOM), violating the lane order, so the
    // tie-break can't save it: e→4 and a is bumped to 5.
    const elements = [
      el("a", 0, 0, 10, 4, false, 0),
      el("b", 2, 0, 10, 3, false, 1),
      el("e", 1, 0, 10, 0, false, 2),
    ];
    expect(patchMap(elements, ["e"])).toEqual({ e: 4, a: 5 });
  });
});

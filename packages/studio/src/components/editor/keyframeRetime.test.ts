import { describe, expect, it } from "vitest";
import { resolveKeyframeRetime, type RetimeKeyframe } from "./keyframeRetime";

// Tween window [2, 6] (start 2s, duration 4s). Keyframes at tween-% 0/50/100 →
// absolute times 2 / 4 / 6. First + last carry an ease to prove it's preserved.
const KEYFRAMES: RetimeKeyframe[] = [
  { percentage: 0, properties: { x: 0 }, ease: "power1.out" },
  { percentage: 50, properties: { x: 50 } },
  { percentage: 100, properties: { x: 100 }, ease: "power2.in" },
];
const WINDOW = { tweenStart: 2, tweenDuration: 4 };

describe("resolveKeyframeRetime — move (within the tween window)", () => {
  it("re-keys an interior keyframe to the tween-% of the drop", () => {
    const r = resolveKeyframeRetime({
      ...WINDOW,
      keyframes: KEYFRAMES,
      draggedTweenPct: 50,
      dropAbsTime: 3, // (3-2)/4 = 25%
    });
    expect(r.kind).toBe("move");
    expect(r.toTweenPct).toBeCloseTo(25, 5);
  });

  it("no-ops a drop that resolves onto the source keyframe", () => {
    const r = resolveKeyframeRetime({
      ...WINDOW,
      keyframes: KEYFRAMES,
      draggedTweenPct: 50,
      dropAbsTime: 4, // exactly 50%
    });
    expect(r.kind).toBe("noop");
  });

  it("moves a flat (keyframe-less) tween without needing the keyframes array", () => {
    const r = resolveKeyframeRetime({
      ...WINDOW,
      keyframes: [],
      draggedTweenPct: 100,
      dropAbsTime: 5, // (5-2)/4 = 75%
    });
    expect(r.kind).toBe("move");
    expect(r.toTweenPct).toBeCloseTo(75, 5);
  });
});

describe("resolveKeyframeRetime — resize (past the tween boundary)", () => {
  it("extends the LAST keyframe past the end, keeping others' absolute times", () => {
    const r = resolveKeyframeRetime({
      ...WINDOW,
      keyframes: KEYFRAMES,
      draggedTweenPct: 100,
      dropAbsTime: 8, // past end (6) → grow duration
    });
    expect(r.kind).toBe("resize");
    expect(r.position).toBeCloseTo(2, 5); // start unchanged
    expect(r.duration).toBeCloseTo(6, 5); // 8 - 2
    // abs 2/4/8 over the new [2,8] window → 0 / 33.3 / 100. pctRemap carries each
    // existing keyframe's old→new tween-%; the commit re-keys in place (value +
    // ease + _auto preserved by round-tripping the source node, not re-emitted here).
    expect(r.pctRemap).toEqual([
      { from: 0, to: 0 },
      { from: 50, to: 33.3 },
      { from: 100, to: 100 },
    ]);
  });

  it("extends the FIRST keyframe before the start, shifting position earlier", () => {
    const r = resolveKeyframeRetime({
      ...WINDOW,
      keyframes: KEYFRAMES,
      draggedTweenPct: 0,
      dropAbsTime: 0.5, // before start (2) → move position back + grow duration
    });
    expect(r.kind).toBe("resize");
    expect(r.position).toBeCloseTo(0.5, 5);
    expect(r.duration).toBeCloseTo(5.5, 5); // 6 - 0.5
    // abs 0.5/4/6 over [0.5,6] → 0 / 63.6 / 100.
    expect(r.pctRemap).toEqual([
      { from: 0, to: 0 },
      { from: 50, to: 63.6 },
      { from: 100, to: 100 },
    ]);
  });
});

describe("resolveKeyframeRetime — single keyframe (both first and last)", () => {
  const lone: RetimeKeyframe[] = [{ percentage: 100, properties: { x: 9 } }];

  it("resizes right past the end", () => {
    const r = resolveKeyframeRetime({
      ...WINDOW, // lone keyframe sits at abs 6
      keyframes: lone,
      draggedTweenPct: 100,
      dropAbsTime: 9,
    });
    expect(r.kind).toBe("resize");
    expect(r.position).toBeCloseTo(2, 5);
    expect(r.duration).toBeCloseTo(7, 5);
    expect(r.pctRemap).toEqual([{ from: 100, to: 100 }]);
  });

  it("resizes left before the start", () => {
    const r = resolveKeyframeRetime({
      ...WINDOW,
      keyframes: lone,
      draggedTweenPct: 100,
      dropAbsTime: 0.5,
    });
    expect(r.kind).toBe("resize");
    expect(r.position).toBeCloseTo(0.5, 5);
    expect(r.duration).toBeCloseTo(5.5, 5);
    expect(r.pctRemap).toEqual([{ from: 100, to: 0 }]);
  });
});

describe("resolveKeyframeRetime — guards", () => {
  it("no-ops a zero-duration tween", () => {
    expect(
      resolveKeyframeRetime({
        tweenStart: 2,
        tweenDuration: 0,
        keyframes: KEYFRAMES,
        draggedTweenPct: 50,
        dropAbsTime: 3,
      }).kind,
    ).toBe("noop");
  });

  it("no-ops a boundary drop on a flat tween (nothing to remap)", () => {
    expect(
      resolveKeyframeRetime({
        ...WINDOW,
        keyframes: [],
        draggedTweenPct: 100,
        dropAbsTime: 8,
      }).kind,
    ).toBe("noop");
  });
});

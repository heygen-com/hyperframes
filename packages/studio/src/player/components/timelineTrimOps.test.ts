import { describe, expect, it } from "vitest";
import {
  applyTrimDelta,
  clampTrimDelta,
  resolveTrimDeltaBounds,
  resolveTrimPlan,
  trimPlanKeys,
  trimSnapAnchor,
  type TrimClip,
  type TrimPlan,
} from "./timelineTrimOps";

/** A, B, C butted together: 0-4, 4-6, 6-9. B and C carry source media. */
const LANE: TrimClip[] = [
  { key: "a", start: 0, duration: 4, playbackStart: 0, sourceDuration: 10 },
  { key: "b", start: 4, duration: 2, playbackStart: 3, sourceDuration: 12, sourceWindow: true },
  { key: "c", start: 6, duration: 3 },
];

const planOf = (
  grabbed: string,
  mode: Parameters<typeof resolveTrimPlan>[2],
  edge: Parameters<typeof resolveTrimPlan>[3] = "end",
  lane: TrimClip[] = LANE,
): TrimPlan => {
  const plan = resolveTrimPlan(lane, grabbed, mode, edge);
  if (!plan) throw new Error(`expected a ${mode} plan for ${grabbed}`);
  return plan;
};

const byKey = (changes: ReturnType<typeof applyTrimDelta>) =>
  Object.fromEntries(changes.map((c) => [c.key, c]));

describe("resolveTrimPlan", () => {
  it("returns null for a clip that is not on the lane", () => {
    expect(resolveTrimPlan(LANE, "nope", "ripple", "end")).toBeNull();
  });

  it("collects only the clips after the grabbed one as ripple followers", () => {
    const plan = planOf("b", "ripple");
    expect(plan.mode === "ripple" && plan.followers.map((f) => f.key)).toEqual(["c"]);
  });

  it("refuses a roll with no clip across the edit point", () => {
    expect(resolveTrimPlan(LANE, "c", "roll", "end")).toBeNull();
    expect(resolveTrimPlan(LANE, "a", "roll", "start")).toBeNull();
  });

  it("pairs a roll with the neighbour on the grabbed side", () => {
    const fromEnd = planOf("a", "roll", "end");
    expect(fromEnd.mode === "roll" && [fromEnd.left.key, fromEnd.right.key]).toEqual(["a", "b"]);
    const fromStart = planOf("b", "roll", "start");
    expect(fromStart.mode === "roll" && [fromStart.left.key, fromStart.right.key]).toEqual([
      "a",
      "b",
    ]);
  });

  it("refuses a slip on a clip with no source window", () => {
    expect(resolveTrimPlan(LANE, "c", "slip", "end")).toBeNull();
  });

  it("only lets ADJACENT neighbours absorb a slide", () => {
    const gapped: TrimClip[] = [
      { key: "a", start: 0, duration: 4 },
      { key: "b", start: 5, duration: 2 },
      { key: "c", start: 7, duration: 3 },
    ];
    const plan = planOf("b", "slide", "end", gapped);
    expect(plan.mode === "slide" && [plan.prev?.key ?? null, plan.next?.key ?? null]).toEqual([
      null,
      "c",
    ]);
  });
});

describe("ripple", () => {
  it("extends the out point and pushes every later clip by the same amount", () => {
    const changes = byKey(applyTrimDelta(planOf("b", "ripple", "end"), 1.5));
    expect(changes.b).toMatchObject({ start: 4, duration: 3.5 });
    expect(changes.c).toMatchObject({ start: 7.5, duration: 3 });
  });

  it("keeps the clip's START when the head is trimmed, and pulls the lane in", () => {
    const changes = byKey(applyTrimDelta(planOf("b", "ripple", "start"), 0.5));
    // Start pinned, duration and in point absorb the trim, lane closes behind it.
    expect(changes.b).toMatchObject({ start: 4, duration: 1.5, playbackStart: 3.5 });
    expect(changes.c).toMatchObject({ start: 5.5 });
  });

  it("leaves no gap or overlap on the lane for either edge", () => {
    for (const [edge, delta] of [
      ["end", 1.5],
      ["end", -0.7],
      ["start", 0.5],
      ["start", -1],
    ] as const) {
      const plan = planOf("b", "ripple", edge);
      const changes = byKey(applyTrimDelta(plan, clampTrimDelta(plan, delta)));
      expect(changes.b.start + changes.b.duration).toBeCloseTo(changes.c.start, 6);
    }
  });

  it("stops the out point at the end of the available source media", () => {
    // b: in point 3 of a 12s source ⇒ 9s of media left, 2s already used.
    expect(resolveTrimDeltaBounds(planOf("b", "ripple", "end")).maxDelta).toBeCloseTo(7, 6);
    expect(clampTrimDelta(planOf("b", "ripple", "end"), 99)).toBeCloseTo(7, 6);
  });

  it("lets a source-free clip extend without limit", () => {
    expect(resolveTrimDeltaBounds(planOf("c", "ripple", "end")).maxDelta).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("never shrinks a clip past the minimum duration", () => {
    const plan = planOf("b", "ripple", "end");
    const changes = byKey(applyTrimDelta(plan, clampTrimDelta(plan, -99)));
    expect(changes.b.duration).toBeCloseTo(0.1, 6);
  });

  it("cannot rewind the in point past the start of the source media", () => {
    // b's in point is 3s ⇒ 3s of head to reveal.
    expect(clampTrimDelta(planOf("b", "ripple", "start"), -99)).toBeCloseTo(-3, 6);
  });

  it("scales the in-point shift by the clip's playback rate", () => {
    const lane: TrimClip[] = [
      {
        key: "x",
        start: 0,
        duration: 4,
        playbackStart: 4,
        playbackRate: 2,
        sourceDuration: 20,
        sourceWindow: true,
      },
    ];
    const changes = byKey(applyTrimDelta(planOf("x", "ripple", "start", lane), 1));
    expect(changes.x).toMatchObject({ start: 0, duration: 3, playbackStart: 6 });
  });
});

describe("roll", () => {
  it("moves the edit point without moving anything downstream", () => {
    const changes = byKey(applyTrimDelta(planOf("a", "roll", "end"), 1));
    expect(changes.a).toMatchObject({ start: 0, duration: 5 });
    expect(changes.b).toMatchObject({ start: 5, duration: 1, playbackStart: 4 });
    expect(changes.a.start + changes.a.duration).toBeCloseTo(changes.b.start, 6);
    expect(changes.b.start + changes.b.duration).toBeCloseTo(6, 6); // c never moves
  });

  it("is bounded by the outgoing clip's remaining media and the incoming clip's head", () => {
    // a: 4s used of 10s ⇒ 6s of tail. b: 2s long, 0.1s floor ⇒ 1.9s it can give up.
    expect(resolveTrimDeltaBounds(planOf("a", "roll", "end")).maxDelta).toBeCloseTo(1.9, 6);
    // Rolling left: a must keep 0.1s; b has 3s of head to reveal.
    expect(resolveTrimDeltaBounds(planOf("a", "roll", "end")).minDelta).toBeCloseTo(-3, 6);
  });
});

describe("slip", () => {
  it("moves the source window only — position and duration are untouched", () => {
    const changes = byKey(applyTrimDelta(planOf("b", "slip"), 1));
    expect(changes.b).toEqual({ key: "b", start: 4, duration: 2, playbackStart: 2 });
  });

  it("is bounded by both ends of the source media", () => {
    // b: in point 3 (3s of head), 12s source with 2s used from 3 ⇒ 7s of tail.
    const bounds = resolveTrimDeltaBounds(planOf("b", "slip"));
    expect(bounds.maxDelta).toBeCloseTo(3, 6);
    expect(bounds.minDelta).toBeCloseTo(-7, 6);
  });
});

describe("slide", () => {
  it("moves the clip while the neighbours absorb it", () => {
    const changes = byKey(applyTrimDelta(planOf("b", "slide"), 1));
    expect(changes.a).toMatchObject({ start: 0, duration: 5 });
    expect(changes.b).toMatchObject({ start: 5, duration: 2 });
    expect(changes.c).toMatchObject({ start: 7, duration: 2 });
    // Total lane length is unchanged and the lane stays butted.
    expect(changes.a.start + changes.a.duration).toBeCloseTo(changes.b.start, 6);
    expect(changes.b.start + changes.b.duration).toBeCloseTo(changes.c.start, 6);
    expect(changes.c.start + changes.c.duration).toBeCloseTo(9, 6);
  });

  it("is bounded by the previous clip's media and the next clip's minimum duration", () => {
    const bounds = resolveTrimDeltaBounds(planOf("b", "slide"));
    expect(bounds.maxDelta).toBeCloseTo(2.9, 6); // c: 3s − 0.1s floor
    expect(bounds.minDelta).toBeCloseTo(-3.9, 6); // a: 4s − 0.1s floor
  });

  it("keeps a clip with no previous neighbour at or after the lane floor", () => {
    expect(clampTrimDelta(planOf("a", "slide"), -99)).toBe(0);
  });
});

describe("gesture plumbing helpers", () => {
  it("reports zero delta rather than inverting an exhausted clamp", () => {
    const lane: TrimClip[] = [{ key: "tiny", start: 0, duration: 0.05 }];
    expect(clampTrimDelta(planOf("tiny", "ripple", "end", lane), 5)).toBeCloseTo(5, 6);
    expect(clampTrimDelta(planOf("tiny", "ripple", "end", lane), -5)).toBeCloseTo(0.05, 6);
  });

  it("produces no changes at all for a zero delta", () => {
    expect(applyTrimDelta(planOf("b", "ripple", "end"), 0)).toEqual([]);
  });

  it("anchors the snap on the edge that actually moves", () => {
    expect(trimSnapAnchor(planOf("b", "ripple", "end"))).toEqual({ time: 6, sign: 1 });
    expect(trimSnapAnchor(planOf("b", "ripple", "start"))).toEqual({ time: 6, sign: -1 });
    expect(trimSnapAnchor(planOf("a", "roll", "end"))).toEqual({ time: 4, sign: 1 });
    expect(trimSnapAnchor(planOf("b", "slide"))).toEqual({ time: 4, sign: 1 });
    expect(trimSnapAnchor(planOf("b", "slip"))).toBeNull();
  });

  it("lists every clip a plan may rewrite so the snap pass can ignore them", () => {
    expect([...trimPlanKeys(planOf("b", "ripple", "end"))].sort()).toEqual(["b", "c"]);
    expect([...trimPlanKeys(planOf("b", "slide"))].sort()).toEqual(["a", "b", "c"]);
  });
});

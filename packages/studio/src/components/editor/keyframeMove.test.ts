import { describe, it, expect } from "vitest";
import { pickKeyframeTween, computeKeyframeMovePlan } from "./keyframeMove";

const flat = (id: string, target: string, position: number, duration: number, group?: string) => ({
  id,
  targetSelector: target,
  position,
  duration,
  resolvedStart: position,
  propertyGroup: group,
});

const el = { start: 0, duration: 10, domId: "box", selector: "#box" };

describe("pickKeyframeTween", () => {
  it("matches by the element's selector", () => {
    const anims = [flat("a", "#other", 0, 5), flat("b", "#box", 2, 3)];
    expect(pickKeyframeTween(anims, el, 3, undefined)?.id).toBe("b");
  });

  it("prefers the dragged keyframe's property group", () => {
    const anims = [flat("pos", "#box", 0, 8, "position"), flat("vis", "#box", 0, 8, "visual")];
    expect(pickKeyframeTween(anims, el, 1, "visual")?.id).toBe("vis");
  });

  it("among same-group tweens picks the one whose window contains the original time", () => {
    const fadeIn = flat("in", "#box", 1, 1, "visual");
    const fadeOut = flat("out", "#box", 8, 1, "visual");
    expect(pickKeyframeTween([fadeIn, fadeOut], el, 8.5, "visual")?.id).toBe("out");
    expect(pickKeyframeTween([fadeIn, fadeOut], el, 1.2, "visual")?.id).toBe("in");
  });

  it("returns undefined when there are no tweens", () => {
    expect(pickKeyframeTween([], el, 1, undefined)).toBeUndefined();
  });

  it("returns undefined rather than editing another element on a selector mismatch", () => {
    const anims = [flat("a", "#other", 0, 5), flat("b", ".unrelated", 2, 3)];
    expect(pickKeyframeTween(anims, el, 3, undefined)).toBeUndefined();
  });
});

describe("computeKeyframeMovePlan — flat tween", () => {
  const anim = flat("t", "#box", 2, 4); // window [2, 6]

  it("start point trims the front, keeping the end fixed", () => {
    // newPct 30% → abs 3 → start moves to 3, duration shrinks to 3.
    const plan = computeKeyframeMovePlan(anim, 0, el, 30);
    expect(plan.meta).toEqual({ position: 3, duration: 3 });
    expect(plan.removes).toEqual([]);
  });

  it("end point resizes, keeping the start", () => {
    // tweenOldPct 100 (end) → newPct 80% → abs 8 → duration 6, start unchanged.
    const plan = computeKeyframeMovePlan(anim, 100, el, 80);
    expect(plan.meta).toEqual({ position: 2, duration: 6 });
  });
});

describe("computeKeyframeMovePlan — keyframe-array tween", () => {
  const anim = {
    id: "k",
    targetSelector: "#box",
    position: 0,
    duration: 10,
    resolvedStart: 0,
    keyframes: {
      keyframes: [
        { percentage: 0, properties: { x: 0 } },
        { percentage: 50, properties: { x: 50 } },
        { percentage: 100, properties: { x: 100 } },
      ],
    },
  };

  it("moves an intermediate keyframe without touching the tween or others", () => {
    // mid keyframe (tweenPct 50) → newPct 70% → abs 7 → 70% of the tween.
    const plan = computeKeyframeMovePlan(anim, 50, el, 70);
    expect(plan.meta).toBeUndefined();
    expect(plan.removes).toEqual([50]);
    expect(plan.adds).toEqual([{ pct: 70, properties: { x: 50 } }]);
  });

  it("start move remaps intermediates to preserve their absolute times", () => {
    // start (tweenPct 0) → newPct 20% → abs 2 → window [2,10]. The 50% keyframe
    // was at abs 5 → now (5-2)/8 = 37.5%.
    const plan = computeKeyframeMovePlan(anim, 0, el, 20);
    expect(plan.meta).toEqual({ position: 2, duration: 8 });
    expect(plan.removes).toContain(50);
    const mid = plan.adds.find((a) => a.properties.x === 50);
    expect(mid?.pct).toBeCloseTo(37.5, 1);
  });

  it("is a no-op when the dragged keyframe can't be located (stale cache)", () => {
    // tweenOldPct 33 matches no keyframe (0/50/100) → must NOT resize the tween.
    const plan = computeKeyframeMovePlan(anim, 33, el, 70);
    expect(plan.meta).toBeUndefined();
    expect(plan.removes).toEqual([]);
    expect(plan.adds).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { resolveKeyframeDrag, previewClipPct, KEYFRAME_DRAG_THRESHOLD_PX } from "./keyframeDrag";

// A tween that starts partway through the element and is shorter than it:
// the clip→tween map is linear with tween% = (clip% - 20) * 2.5 over [20, 60].
const KEYFRAMES = [
  { percentage: 20, tweenPercentage: 0 },
  { percentage: 40, tweenPercentage: 50 },
  { percentage: 60, tweenPercentage: 100 },
];

describe("resolveKeyframeDrag — click vs drag threshold", () => {
  const base = {
    clipWidthPx: 200,
    draggedClipPct: 40,
    draggedTweenPct: 50,
    keyframes: KEYFRAMES,
  };

  it("treats sub-threshold movement as a click", () => {
    const r = resolveKeyframeDrag({
      ...base,
      pointerDownX: 100,
      pointerUpX: 100 + (KEYFRAME_DRAG_THRESHOLD_PX - 1),
    });
    expect(r.kind).toBe("click");
  });

  it("treats movement at/over the threshold as a drag", () => {
    const r = resolveKeyframeDrag({
      ...base,
      pointerDownX: 100,
      pointerUpX: 100 + KEYFRAME_DRAG_THRESHOLD_PX + 1,
    });
    expect(r.kind).toBe("move");
  });

  it("guards a zero-width clip (no division blowup) → click", () => {
    const r = resolveKeyframeDrag({ ...base, clipWidthPx: 0, pointerDownX: 0, pointerUpX: 50 });
    expect(r.kind).toBe("click");
  });
});

describe("resolveKeyframeDrag — clip% → tween% conversion", () => {
  // 200px wide clip → 2px per clip-%. Dragged diamond at clip 40% (tween 50%),
  // pointer-down anchored at its pixel position (80px) for a clean delta.
  const base = {
    clipWidthPx: 200,
    draggedClipPct: 40,
    draggedTweenPct: 50,
    keyframes: KEYFRAMES,
    pointerDownX: 80,
  };

  it("maps a rightward drag through the linear clip→tween map", () => {
    // +20px → +10 clip% → clip 50% → tween (50-20)*2.5 = 75%.
    const r = resolveKeyframeDrag({ ...base, pointerUpX: 100 });
    expect(r.kind).toBe("move");
    expect(r.toTweenPct).toBeCloseTo(75, 5);
  });

  it("maps a leftward drag", () => {
    // -20px → -10 clip% → clip 30% → tween (30-20)*2.5 = 25%.
    const r = resolveKeyframeDrag({ ...base, pointerUpX: 60 });
    expect(r.toTweenPct).toBeCloseTo(25, 5);
  });

  it("clamps the dropped tween% to [0,100] when dragged off the clip", () => {
    // Drag far right past clip 100% → tween clamps at 100.
    const r = resolveKeyframeDrag({ ...base, pointerUpX: 5000 });
    expect(r.toTweenPct).toBe(100);
    // Drag far left past clip 0% → tween clamps at 0.
    const l = resolveKeyframeDrag({ ...base, pointerUpX: -5000 });
    expect(l.toTweenPct).toBe(0);
  });

  it("no-ops a past-threshold drag that resolves to the source percentage", () => {
    // Over the px threshold, but on a huge clip the 5px maps to ~0.00125 tween%
    // away — under the noop epsilon, so don't commit a churn write.
    const r = resolveKeyframeDrag({
      ...base,
      clipWidthPx: 1_000_000,
      pointerUpX: base.pointerDownX + KEYFRAME_DRAG_THRESHOLD_PX + 1,
    });
    expect(r.kind).toBe("noop");
  });
});

describe("previewClipPct", () => {
  it("follows the pointer in clip-% and clamps to the clip", () => {
    expect(
      previewClipPct({ pointerDownX: 80, pointerMoveX: 100, clipWidthPx: 200, draggedClipPct: 40 }),
    ).toBeCloseTo(50, 5);
    expect(
      previewClipPct({
        pointerDownX: 80,
        pointerMoveX: 5000,
        clipWidthPx: 200,
        draggedClipPct: 40,
      }),
    ).toBe(100);
    expect(
      previewClipPct({
        pointerDownX: 80,
        pointerMoveX: -5000,
        clipWidthPx: 200,
        draggedClipPct: 40,
      }),
    ).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { GsapDragCommitCallbacks } from "./gsapDragCommit";
import { commitWholePropertyOffset } from "./gsapWholePropertyOffsetCommit";

// Regression (#1808): with auto-keyframe recording off, a manual edit on an
// element that already has a keyframed tween must shift every keyframe by
// the edit's delta (preserving the animation's shape) instead of inserting
// or updating a keyframe at the playhead.

const selection = (): DomEditSelection => ({ id: "box", selector: "#box" }) as DomEditSelection;

function recordingCallbacks(): {
  mutations: Array<Record<string, unknown>>;
  callbacks: GsapDragCommitCallbacks;
} {
  const mutations: Array<Record<string, unknown>> = [];
  return {
    mutations,
    callbacks: {
      commitMutation: async (_sel, mutation) => {
        mutations.push(mutation);
      },
    },
  };
}

describe("commitWholePropertyOffset", () => {
  it("shifts every keyframe of a keyframed tween by the delta at the nearest keyframe", async () => {
    const anim = {
      id: "#box-rotate",
      targetSelector: "#box",
      method: "to",
      resolvedStart: 0,
      duration: 2,
      keyframes: {
        keyframes: [
          { percentage: 0, properties: { rotation: 10 } },
          { percentage: 50, properties: { rotation: 20 } },
          { percentage: 100, properties: { rotation: 40 } },
        ],
      },
    } as unknown as GsapAnimation;

    const { mutations, callbacks } = recordingCallbacks();
    // currentPct=48 lands nearest the 50% keyframe (rotation 20) — dragging to
    // 30 is a +10 delta, applied to every keyframe.
    await commitWholePropertyOffset(
      selection(),
      anim,
      { rotation: 30 },
      48,
      null,
      callbacks,
      "Rotate",
    );

    expect(mutations).toHaveLength(1);
    const mutation = mutations[0]!;
    expect(mutation.type).toBe("replace-with-keyframes");
    const keyframes = mutation.keyframes as Array<{
      percentage: number;
      properties: Record<string, number>;
    }>;
    expect(keyframes.map((k) => k.percentage)).toEqual([0, 50, 100]);
    expect(keyframes.map((k) => k.properties.rotation)).toEqual([20, 30, 50]);
  });

  it("materializes a flat tween into a 2-point range before shifting", async () => {
    const anim = {
      id: "#box-fade",
      targetSelector: "#box",
      method: "fromTo",
      resolvedStart: 0,
      duration: 1,
      properties: { opacity: 1 },
      fromProperties: { opacity: 0 },
    } as unknown as GsapAnimation;

    const { mutations, callbacks } = recordingCallbacks();
    // Nearest keyframe to pct=100 is the synthesized 100% stop (opacity 1) —
    // dragging opacity to 0.5 is a -0.5 delta, applied to both stops.
    await commitWholePropertyOffset(
      selection(),
      anim,
      { opacity: 0.5 },
      100,
      null,
      callbacks,
      "Fade",
    );

    expect(mutations).toHaveLength(1);
    const keyframes = mutations[0]!.keyframes as Array<{
      percentage: number;
      properties: Record<string, number>;
    }>;
    expect(keyframes).toEqual([
      { percentage: 0, properties: { opacity: -0.5 } },
      { percentage: 100, properties: { opacity: 0.5 } },
    ]);
  });

  it("preserves keyframes' other properties and per-keyframe ease untouched", async () => {
    const anim = {
      id: "#box-move",
      targetSelector: "#box",
      method: "to",
      resolvedStart: 0,
      duration: 1,
      keyframes: {
        keyframes: [
          { percentage: 0, properties: { x: 0, opacity: 1 }, ease: "power1.in" },
          { percentage: 100, properties: { x: 100, opacity: 0.5 } },
        ],
      },
    } as unknown as GsapAnimation;

    const { mutations, callbacks } = recordingCallbacks();
    await commitWholePropertyOffset(selection(), anim, { x: 120 }, 100, null, callbacks, "Move");

    const keyframes = mutations[0]!.keyframes as Array<{
      percentage: number;
      properties: Record<string, number>;
      ease?: string;
    }>;
    // Delta is +20 (120 - 100 at the nearest, 100%, keyframe).
    expect(keyframes[0]).toEqual({
      percentage: 0,
      properties: { x: 20, opacity: 1 },
      ease: "power1.in",
    });
    expect(keyframes[1]).toEqual({ percentage: 100, properties: { x: 120, opacity: 0.5 } });
  });

  it("persists a flat update instead of crashing when the tween has no synthesizable shape", async () => {
    // Regression: removeAllKeyframesFromScript collapses a keyframed tween into a
    // zero-duration immediateRender hold — synthesizeFlatTweenKeyframes treats that
    // as a static hold (returns null), so `kfs` is empty. Resizing this element with
    // auto-keyframe off used to call `kfs.reduce(...)` with no initial value, which
    // throws "Reduce of empty array with no initial value".
    const anim = {
      id: "#box-hold",
      targetSelector: "#box",
      method: "to",
      resolvedStart: 0,
      duration: 0,
      properties: { width: 200 },
      extras: { immediateRender: "__raw:true" },
    } as unknown as GsapAnimation;

    const { mutations, callbacks } = recordingCallbacks();
    await expect(
      commitWholePropertyOffset(selection(), anim, { width: 300 }, 0, null, callbacks, "Resize"),
    ).resolves.toBeUndefined();

    expect(mutations).toEqual([
      { type: "update-properties", animationId: "#box-hold", properties: { width: 300 } },
    ]);
  });
});

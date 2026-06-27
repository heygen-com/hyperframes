import { describe, expect, it } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import {
  animatedProps,
  buildExtendedKeyframes,
  isPlayheadWithinTween,
  promoteSetToKeyframes,
  resolveNewTweenRange,
  type EnableKeyframesSession,
} from "./useEnableKeyframes";

function anim(overrides: Partial<GsapAnimation>): GsapAnimation {
  return {
    id: "#el-to-0-position",
    targetSelector: "#el",
    method: "to",
    position: 0,
    properties: {},
    ...overrides,
  };
}

describe("resolveNewTweenRange", () => {
  // Regression: "add a keyframe" must land at the PLAYHEAD. The runtime auto-stamps
  // data-start="0" + data-duration=<rootDuration> on every GSAP element, so honoring
  // data-start as authored timing put the keyframe at 0. Clamping the playhead into
  // the element's range fixes it (auto-stamp's full range passes the playhead through).
  it("anchors at the playhead through the auto-stamped full-composition range", () => {
    // data-start="0", data-duration="14" (the auto-stamp), playhead 4.9 → 4.9
    expect(resolveNewTweenRange("0", "14", 4.9)).toEqual({ start: 4.9, duration: 9.1 });
  });

  it("anchors at the playhead when the element has no authored range", () => {
    expect(resolveNewTweenRange(undefined, undefined, 4)).toEqual({ start: 4, duration: 1 });
    expect(resolveNewTweenRange(undefined, undefined, 6.123456).start).toBe(6.123);
  });

  it("never returns a negative start", () => {
    expect(resolveNewTweenRange(undefined, undefined, -2).start).toBe(0);
  });

  it("clamps the playhead into a genuinely narrow authored clip", () => {
    // clip [2.5, 8]: inside → playhead; before → start; after → end
    expect(resolveNewTweenRange("2.5", "5.5", 4)).toEqual({ start: 4, duration: 4 });
    expect(resolveNewTweenRange("2.5", "5.5", 1).start).toBe(2.5);
    expect(resolveNewTweenRange("2.5", "5.5", 99).start).toBe(8);
  });
});

describe("animatedProps", () => {
  it("uses top-level properties when present (flat tween)", () => {
    expect(animatedProps(anim({ properties: { x: -260 } }))).toEqual(["x"]);
  });

  it("derives props from keyframe stops when top-level properties is empty (array form)", () => {
    // Regression: array-form `keyframes: [{x,y},…]` leaves `properties` empty, so
    // add-keyframe read an empty prop list → empty position → silent no-op.
    const a = anim({
      properties: {},
      keyframes: {
        format: "object-array",
        keyframes: [
          { percentage: 0, properties: { x: 0, y: 0 } },
          { percentage: 100, properties: { x: -460, y: -20 } },
        ],
      },
    });
    expect(animatedProps(a).sort()).toEqual(["x", "y"]);
  });

  it("falls back to x/y for a null anim or one with no resolvable props", () => {
    expect(animatedProps(null)).toEqual(["x", "y"]);
    expect(animatedProps(anim({ properties: {} }))).toEqual(["x", "y"]);
  });
});

describe("isPlayheadWithinTween", () => {
  const tween = anim({ position: 1.0, duration: 3.4 }); // range [1.0, 4.4]

  it("is true inside the range (incl. boundaries)", () => {
    expect(isPlayheadWithinTween(tween, 3.0)).toBe(true);
    expect(isPlayheadWithinTween(tween, 1.0)).toBe(true);
    expect(isPlayheadWithinTween(tween, 4.4)).toBe(true);
  });

  it("is false outside the tween range", () => {
    expect(isPlayheadWithinTween(tween, 5.767)).toBe(false);
    expect(isPlayheadWithinTween(tween, 0.5)).toBe(false);
  });

  it("does not block when the start can't be resolved", () => {
    expect(isPlayheadWithinTween(anim({ position: "+=1" }), 99)).toBe(true);
  });
});

describe("buildExtendedKeyframes", () => {
  // puck-b: tween [1.0, 4.4], four evenly-distributed stops.
  const kfAnim = anim({
    position: 1.0,
    duration: 3.4,
    keyframes: {
      format: "object-array",
      keyframes: [
        { percentage: 0, properties: { x: 0, y: 0 } },
        { percentage: 33.3, properties: { x: -180, y: -60 } },
        { percentage: 66.7, properties: { x: -320, y: 40 } },
        { percentage: 100, properties: { x: -460, y: -20 } },
      ],
    },
  });

  it("extends the end and rescales existing stops to keep their absolute timing", () => {
    const out = buildExtendedKeyframes(kfAnim, 5.767, { x: -460, y: -20 });
    expect(out.position).toBe(1.0); // start unchanged
    expect(out.duration).toBe(4.767); // grown to reach the playhead
    // old end (abs 4.4) is no longer 100% — it slid back inside the longer range
    const last = out.keyframes[out.keyframes.length - 1]!;
    expect(last.percentage).toBe(100); // the new keyframe sits at the new end
    expect(last.properties).toEqual({ x: -460, y: -20 });
    expect(out.keyframes[0]!.percentage).toBe(0); // old start still anchors 0%
    expect(out.keyframes.some((k) => k.percentage > 0 && k.percentage < 100)).toBe(true);
  });

  it("extends the start when the playhead precedes the tween", () => {
    const out = buildExtendedKeyframes(kfAnim, 0, { x: 0, y: 0 });
    expect(out.position).toBe(0); // start moved back to the playhead
    expect(out.duration).toBe(4.4); // end (abs 4.4) unchanged
    expect(out.keyframes[0]).toEqual({ percentage: 0, properties: { x: 0, y: 0 } });
    // the old first stop (abs 1.0) is now partway in: 1.0 / 4.4 ≈ 22.7%
    expect(out.keyframes[1]!.percentage).toBeCloseTo(22.7, 1);
  });
});

describe("promoteSetToKeyframes — auto endpoint", () => {
  it("marks the 0% (held start) as `auto`, leaving the 100% (playhead) fixed", async () => {
    let committed: Record<string, unknown> | undefined;
    const session = {
      commitMutation: async (mutation: Record<string, unknown>) => {
        committed = mutation;
      },
    } as unknown as EnableKeyframesSession;
    const sel = {
      id: "card",
      selector: "#card",
      sourceFile: "index.html",
      element: { isConnected: true } as unknown as HTMLElement,
    } as unknown as DomEditSelection;
    // readElementPosition reads gsap.getProperty off the iframe window.
    const iframe = {
      contentWindow: { gsap: { getProperty: () => -74 } },
    } as unknown as HTMLIFrameElement;
    const setAnim = anim({
      id: "#card-set-0-position",
      targetSelector: "#card",
      method: "set",
      global: true,
      resolvedStart: 0,
      properties: { x: -74, y: -469 },
    });

    await promoteSetToKeyframes(session, sel, setAnim, 1, iframe);

    const kfs = committed?.keyframes as Array<{ percentage: number; auto?: boolean }>;
    expect(committed?.type).toBe("replace-with-keyframes");
    expect(kfs[0]).toMatchObject({ percentage: 0, auto: true });
    expect(kfs[1].percentage).toBe(100);
    expect(kfs[1].auto).toBeUndefined();
  });

  it("playhead AT the set (t <= setStart) drops a single 0% keyframe, not a no-op", async () => {
    // Regression: enabling keyframes on a `gsap.set` element at t=0 (set start 0)
    // returned early (`t <= setStart`) → nothing created. Must give a 0% keyframe.
    let committed: Record<string, unknown> | undefined;
    const session = {
      commitMutation: async (mutation: Record<string, unknown>) => {
        committed = mutation;
      },
    } as unknown as EnableKeyframesSession;
    const sel = {
      id: "box",
      selector: "#box",
      sourceFile: "index.html",
      element: { isConnected: true } as unknown as HTMLElement,
    } as unknown as DomEditSelection;
    const iframe = {
      contentWindow: { gsap: { getProperty: () => -1091 } },
    } as unknown as HTMLIFrameElement;
    const setAnim = anim({
      id: "#box-set-0-position",
      targetSelector: "#box",
      method: "set",
      global: true,
      resolvedStart: 0,
      properties: { x: -1091, y: 280 },
    });

    await promoteSetToKeyframes(session, sel, setAnim, 0, iframe);

    const kfs = committed?.keyframes as Array<{ percentage: number }>;
    expect(committed?.type).toBe("replace-with-keyframes");
    expect(kfs).toHaveLength(1);
    expect(kfs[0].percentage).toBe(0);
  });
});

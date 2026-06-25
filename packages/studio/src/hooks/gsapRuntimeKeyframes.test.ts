import { describe, expect, it } from "vitest";
import {
  arcPathFromMotionPathValue,
  hasNonHoldTweenForElement,
  readRuntimeKeyframes,
} from "./gsapRuntimeKeyframes";

// Build a fake preview iframe whose runtime timeline holds the given child tweens
// and resolves `selector` to `el`.
function fakeIframe(el: { id: string }, children: unknown[], now?: number): HTMLIFrameElement {
  const timeline = {
    getChildren: () => children,
    duration: () => 14.6,
    ...(now != null ? { time: () => now } : {}),
  };
  return {
    contentWindow: { __timelines: { "index.html": timeline } },
    contentDocument: { querySelector: (sel: string) => (sel === `#${el.id}` ? el : null) },
  } as unknown as HTMLIFrameElement;
}

describe("readRuntimeKeyframes — zero-duration set must not shadow the keyframed tween", () => {
  const el = { id: "puck-b" };
  const holdSet = {
    targets: () => [el],
    // `data` is the STUDIO_HOLD_MARKER sentinel ("hf-hold") from core's gsapParser.
    // TODO(core follow-up): re-export STUDIO_HOLD_MARKER via the @hyperframes/core/
    // gsap-parser subpath so this fixture can import the const instead of the literal.
    vars: { x: 0, y: 0, data: "hf-hold" },
    duration: () => 0,
    startTime: () => 0,
  };
  const kfTween = {
    targets: () => [el],
    vars: {
      keyframes: [
        { x: 0, y: 0 },
        { x: -180, y: -60 },
        { x: -320, y: 40 },
        { x: -460, y: -20 },
      ],
      duration: 3.4,
      ease: "power1.inOut",
    },
    duration: () => 3.4,
    startTime: () => 1.0,
  };

  it("reads all 4 keyframes from the to() even when a hold-set precedes it", () => {
    const read = readRuntimeKeyframes(fakeIframe(el, [holdSet, kfTween]), "#puck-b");
    expect(read?.keyframes).toHaveLength(4);
  });

  it("returns null when the element only has a zero-duration set (no real motion)", () => {
    expect(readRuntimeKeyframes(fakeIframe(el, [holdSet]), "#puck-b")).toBeNull();
  });
});

describe("readRuntimeKeyframes — multiple tweens pick the one under the playhead", () => {
  const el = { id: "puck-a" };
  // Two non-overlapping gesture recordings → two separate keyframed tweens.
  const gestureA = {
    targets: () => [el],
    vars: {
      keyframes: [
        { x: 0, y: 0 },
        { x: -100, y: 50 },
      ],
      duration: 2.03,
    },
    duration: () => 2.03,
    startTime: () => 1.033, // range [1.033, 3.063]
  };
  const gestureB = {
    targets: () => [el],
    vars: {
      keyframes: [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
        { x: 30, y: 30 },
      ],
      duration: 1.129,
    },
    duration: () => 1.129,
    startTime: () => 3.342, // range [3.342, 4.471]
  };

  it("playhead inside the SECOND tween reads the second tween (not the first)", () => {
    const read = readRuntimeKeyframes(fakeIframe(el, [gestureA, gestureB], 3.373), "#puck-a");
    expect(read?.keyframes).toHaveLength(3); // gestureB
  });

  it("playhead inside the FIRST tween reads the first tween", () => {
    const read = readRuntimeKeyframes(fakeIframe(el, [gestureA, gestureB], 2.0), "#puck-a");
    expect(read?.keyframes).toHaveLength(2); // gestureA
  });

  it("playhead outside every range falls back to the first keyframed tween", () => {
    const read = readRuntimeKeyframes(fakeIframe(el, [gestureA, gestureB], 9.0), "#puck-a");
    expect(read?.keyframes).toHaveLength(2); // gestureA (first)
  });
});

describe("readRuntimeKeyframes — requireChannels keeps the motion path on the positional tween", () => {
  // An animated element with a position tween AND a (longer) size tween, both at
  // start 0 — the shape the per-keyframe size resize produces.
  const el = { id: "dot-a" };
  const positionTween = {
    targets: () => [el],
    vars: {
      keyframes: [
        { x: -1252, y: -394 },
        { x: 244, y: -316 },
      ],
      duration: 2.4,
    },
    duration: () => 2.4,
    startTime: () => 0, // range [0, 2.4]
  };
  const sizeTween = {
    targets: () => [el],
    vars: {
      keyframes: [
        { width: 120, height: 96 },
        { width: 325, height: 300 },
      ],
      duration: 3.243,
    },
    duration: () => 3.243,
    startTime: () => 0, // range [0, 3.243] — outlives the position tween
  };

  it("playhead past the position range (2.4–3.243s) still returns the position tween, not size", () => {
    // Without the filter the size tween (the only one containing the playhead)
    // would win and blank the path.
    const read = readRuntimeKeyframes(
      fakeIframe(el, [positionTween, sizeTween], 3.0),
      "#dot-a",
      undefined,
      ["x", "y"],
    );
    expect(read?.keyframes[0]?.properties).toHaveProperty("x");
  });

  it("without requireChannels the size tween shadows the path past the position range (documents the bug)", () => {
    const read = readRuntimeKeyframes(fakeIframe(el, [positionTween, sizeTween], 3.0), "#dot-a");
    expect(read?.keyframes[0]?.properties).toHaveProperty("width");
  });
});

describe("hasNonHoldTweenForElement — strict live-tween existence (drag stale-parse guard)", () => {
  const el = { id: "puck-b" };
  const holdSet = {
    targets: () => [el],
    vars: { x: 0, y: 0, data: "hf-hold" },
    duration: () => 0,
    startTime: () => 0,
  };
  const liveTween = {
    targets: () => [el],
    vars: { x: -120, y: 40, duration: 1 },
    duration: () => 1,
    startTime: () => 1,
  };

  it("true when a non-hold tween targets the element", () => {
    expect(hasNonHoldTweenForElement(fakeIframe(el, [liveTween]), "#puck-b")).toBe(true);
  });

  it("false when only a zero-duration hold/set remains (post delete-all)", () => {
    expect(hasNonHoldTweenForElement(fakeIframe(el, [holdSet]), "#puck-b")).toBe(false);
  });

  it("false when the element has no tweens at all", () => {
    expect(hasNonHoldTweenForElement(fakeIframe(el, []), "#puck-b")).toBe(false);
  });
});

describe("arcPathFromMotionPathValue", () => {
  it("builds arc config from object form { path, curviness }", () => {
    const arc = arcPathFromMotionPathValue({
      path: [
        { x: 0, y: 0 },
        { x: 100, y: -50 },
        { x: 200, y: 0 },
        { x: 300, y: 80 },
      ],
      curviness: 2,
    });
    expect(arc?.enabled).toBe(true);
    expect(arc?.segments).toHaveLength(3); // 4 waypoints → 3 segments
    expect(arc?.segments.every((s) => s.curviness === 2)).toBe(true);
  });

  it("builds arc config from bare array form (default curviness 1)", () => {
    const arc = arcPathFromMotionPathValue([
      { x: 0, y: 0 },
      { x: 50, y: 50 },
    ]);
    expect(arc?.enabled).toBe(true);
    expect(arc?.segments).toHaveLength(1);
    expect(arc?.segments[0]!.curviness).toBe(1);
  });

  it("carries autoRotate", () => {
    const arc = arcPathFromMotionPathValue({
      path: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      autoRotate: true,
    });
    expect(arc?.autoRotate).toBe(true);
  });

  it("returns undefined for fewer than 2 points, missing path, or string path", () => {
    expect(arcPathFromMotionPathValue({ path: [{ x: 0, y: 0 }] })).toBeUndefined();
    expect(arcPathFromMotionPathValue({ curviness: 2 })).toBeUndefined();
    expect(arcPathFromMotionPathValue({ path: "M0 0 L10 10" })).toBeUndefined();
    expect(arcPathFromMotionPathValue(null)).toBeUndefined();
  });
});

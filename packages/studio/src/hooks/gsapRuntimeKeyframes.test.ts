import { describe, expect, it } from "vitest";
import { arcPathFromMotionPathValue, readRuntimeKeyframes } from "./gsapRuntimeKeyframes";

// Build a fake preview iframe whose runtime timeline holds the given child tweens
// and resolves `selector` to `el`.
function fakeIframe(el: { id: string }, children: unknown[]): HTMLIFrameElement {
  const timeline = { getChildren: () => children, duration: () => 14.6 };
  return {
    contentWindow: { __timelines: { "index.html": timeline } },
    contentDocument: { querySelector: (sel: string) => (sel === `#${el.id}` ? el : null) },
  } as unknown as HTMLIFrameElement;
}

describe("readRuntimeKeyframes — zero-duration set must not shadow the keyframed tween", () => {
  const el = { id: "puck-b" };
  const holdSet = {
    targets: () => [el],
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

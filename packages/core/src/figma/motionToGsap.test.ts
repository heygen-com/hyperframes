// @vitest-environment node
import { describe, expect, it } from "vitest";
import { motionToGsap, motionToTimeline } from "./motionToGsap";
import type { MotionDoc } from "./types";

const headline: MotionDoc = {
  selector: "#hero-headline",
  tracks: [
    {
      property: "opacity",
      values: [0, 0, 1, 1, 0],
      times: [0, 0.0686, 0.2273, 0.9999, 1],
      ease: ["linear", [0.539, 0, 0.312, 0.995], "linear", [0.539, 0, 0.312, 0.995]],
      duration: 2,
      repeat: Infinity,
    },
  ],
};

describe("motionToGsap", () => {
  it("derives a finite, paused-timeline spec from the captured Headline payload", () => {
    const spec = motionToGsap(headline);
    expect(spec.timelineId).toBe("figma-hero-headline");
    expect(spec.tweens).toHaveLength(1);

    const t = spec.tweens[0];
    expect(t?.selector).toBe("#hero-headline");
    expect(t?.property).toBe("opacity");
    expect(t?.initial).toBe(0);
    // 4 segments for 5 keyframes
    expect(t?.steps).toHaveLength(4);
    // clamps Infinity -> 0 (single play) for determinism
    expect(t?.repeat).toBe(0);
  });

  it("computes per-segment durations from times * duration", () => {
    const t = motionToGsap(headline).tweens[0];
    // segment 0: (0.0686 - 0) * 2 = 0.1372
    expect(t?.steps[0]?.duration).toBeCloseTo(0.1372, 4);
    // segment 1: (0.2273 - 0.0686) * 2 = 0.3174
    expect(t?.steps[1]?.duration).toBeCloseTo(0.3174, 4);
  });

  it("registers a CustomEase per bezier segment and names it in the step", () => {
    const spec = motionToGsap(headline);
    expect(spec.customEases).toHaveLength(2);
    expect(spec.customEases[0]?.bezier).toEqual([0.539, 0, 0.312, 0.995]);
    // step 0 ease is linear -> none; step 1 ease is the first bezier
    expect(spec.tweens[0]?.steps[0]?.ease).toBe("none");
    expect(spec.tweens[0]?.steps[1]?.ease).toBe(spec.customEases[0]?.name);
  });

  it("throws when times and values lengths disagree", () => {
    expect(() =>
      motionToGsap({
        selector: "#x",
        tracks: [{ property: "x", values: [0, 1], times: [0], ease: ["linear"], duration: 1 }],
      }),
    ).toThrow();
  });
});

describe("motionToTimeline", () => {
  it("derives an anime.js timeline spec with mapped named and custom eases", () => {
    const spec = motionToTimeline({
      selector: "#card",
      tracks: [
        {
          property: "x",
          values: [0, 40, 80],
          times: [0, 0.5, 1],
          ease: ["easeOut", [0.539, 0, 0.312, 0.995]],
          duration: 2,
          repeat: Infinity,
        },
      ],
    });

    expect(spec.timelineId).toBe("figma-card");
    expect(spec.tweens[0]?.steps[0]?.duration).toBe(1);
    expect(spec.tweens[0]?.steps[0]?.ease).toBe("outCubic");
    expect(spec.customEases).toHaveLength(1);
    expect(spec.tweens[0]?.steps[1]?.ease).toBe(spec.customEases[0]?.name);
    expect(spec.customEases[0]?.ease).toBe("anime.cubicBezier(0.539, 0, 0.312, 0.995)");
    expect(spec.customEases[0]?.ease).not.toContain("M0,0");
    expect(spec.tweens[0]?.repeat).toBe(0);
  });
});

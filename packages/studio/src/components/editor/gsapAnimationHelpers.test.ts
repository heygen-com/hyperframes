import { describe, expect, it } from "vitest";
import { buildTweenSummary } from "./gsapAnimationHelpers";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";

function anim(overrides: Partial<GsapAnimation>): GsapAnimation {
  return {
    id: "a1",
    method: "to",
    targetSelector: "#box",
    properties: {},
    position: 0,
    duration: 1,
    ease: "power2.out",
    ...overrides,
  } as GsapAnimation;
}

describe("buildTweenSummary", () => {
  it("describes a to tween", () => {
    const s = buildTweenSummary(anim({ properties: { opacity: 1, x: 100 } }));
    expect(s).toContain("#box");
    expect(s).toContain("opacity");
    expect(s).toContain("move x");
  });

  it("describes a from tween", () => {
    const s = buildTweenSummary(anim({ method: "from", properties: { opacity: 0 } }));
    expect(s).toContain("enters from");
    expect(s).toContain("opacity");
  });

  it("describes a set tween", () => {
    const s = buildTweenSummary(anim({ method: "set", properties: { opacity: 0 } }));
    expect(s).toMatch(/^At 0s, instantly set/);
    expect(s).toContain("opacity");
  });

  it("describes a fromTo tween with both from and to sections", () => {
    const s = buildTweenSummary(
      anim({
        method: "fromTo",
        fromProperties: { opacity: 0, x: -50 },
        properties: { opacity: 1, x: 0 },
        position: 0.5,
        duration: 1.5,
        ease: "expo.out",
      }),
    );
    expect(s).toContain("animates from");
    expect(s).toContain("[opacity 0%");
    expect(s).toContain("move x -50px");
    expect(s).toContain("opacity to 100%");
    expect(s).toContain("very snappy stop");
  });

  it("handles fromTo with empty fromProperties", () => {
    const s = buildTweenSummary(
      anim({ method: "fromTo", fromProperties: {}, properties: { scale: 2 } }),
    );
    expect(s).toContain("from [—]");
  });

  it("handles no properties", () => {
    const s = buildTweenSummary(anim({ properties: {} }));
    expect(s).toContain("no properties yet");
  });
});

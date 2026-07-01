// @vitest-environment node
import { describe, expect, it } from "vitest";
import { emitTimelineScript } from "./emitTimelineScript";
import { motionToGsap } from "./motionToGsap";
import type { MotionDoc } from "./types";

const doc: MotionDoc = {
  selector: "#hero-headline",
  tracks: [
    {
      property: "opacity",
      values: [0, 1, 0],
      times: [0, 0.5, 1],
      ease: ["linear", [0.539, 0, 0.312, 0.995]],
      duration: 2,
      repeat: Infinity,
    },
  ],
};

describe("emitTimelineScript", () => {
  const script = emitTimelineScript(motionToGsap(doc));

  it("creates a paused timeline and never emits repeat:-1", () => {
    expect(script).toContain("gsap.timeline({ paused: true })");
    expect(script).not.toContain("repeat: -1");
  });
  it("registers under a string-literal __timelines key", () => {
    expect(script).toContain('window.__timelines["figma-hero-headline"] = tl;');
  });
  it("uses string-literal selectors and sets the initial value", () => {
    expect(script).toContain('tl.set("#hero-headline", { opacity: 0 }, 0);');
    expect(script).toContain('tl.to("#hero-headline", { keyframes: [');
  });
  it("registers a CustomEase for the bezier segment", () => {
    expect(script).toContain('CustomEase.create("hfCe0", "M0,0 C0.539,0 0.312,0.995 1,1");');
  });
});

describe("emitTimelineScript runtime guard", () => {
  it("wraps the script in an IIFE that warns when gsap/CustomEase are missing", () => {
    const script = emitTimelineScript(motionToGsap(doc));
    expect(script).toContain('typeof gsap === "undefined"');
    expect(script).toContain("console.warn");
    expect(script.startsWith("(function () {")).toBe(true);
    expect(script.endsWith("})();")).toBe(true);
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { emitAnimeTimelineScript, emitTimelineScript } from "./emitTimelineScript";
import { motionToGsap, motionToTimeline } from "./motionToGsap";
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

function expectIifeGuard(script: string): void {
  expect(script).toContain("console.warn");
  expect(script.startsWith("(function () {")).toBe(true);
  expect(script.endsWith("})();")).toBe(true);
}

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
    expectIifeGuard(script);
  });
});

describe("emitAnimeTimelineScript", () => {
  const script = emitAnimeTimelineScript(motionToTimeline(doc));

  it("creates a paused anime.js timeline and registers with HyperFrames", () => {
    expect(script).toContain("anime.createTimeline({ autoplay: false })");
    expect(script).toContain(
      'hyperframesAnime.register("figma-hero-headline", tl, { labels: {} });',
    );
    expect(script).not.toContain("window.__timelines");
    expect(script).not.toContain("gsap.timeline");
  });

  it("sets the initial value at 0ms and emits duration-based keyframes in milliseconds", () => {
    expect(script).toContain('tl.set("#hero-headline", { opacity: 0 }, 0);');
    expect(script).toContain('tl.add("#hero-headline", { keyframes: [');
    expect(script).toContain('{ opacity: 1, duration: 1000, ease: "linear" }');
  });

  it("realizes custom bezier eases as anime ease values", () => {
    expect(script).toContain('const hfCe0 = "M0,0');
    expect(script).toContain("ease: hfCe0");
    expect(script).not.toContain("CustomEase.create");
  });

  it("guards on anime and hyperframesAnime being available", () => {
    expect(script).toContain('typeof anime === "undefined"');
    expect(script).toContain('typeof hyperframesAnime === "undefined"');
    expectIifeGuard(script);
  });
});

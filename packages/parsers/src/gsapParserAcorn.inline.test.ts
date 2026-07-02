import { describe, it, expect } from "vitest";
import { parseGsapScriptAcorn } from "./gsapParserAcorn.js";

// U1+U2: the editor must read timelines authored inline as
// `window.__timelines["id"] = gsap.timeline()` — not just the canonical
// `const tl = gsap.timeline(); window.__timelines[id] = tl` form.

const wrap = (decl: string, tweens: string) =>
  `window.__timelines = window.__timelines || {};\n${decl}\n${tweens}`;

describe("inline timeline assignment — read", () => {
  it("reads tweens from a double-quoted inline timeline", () => {
    const src = wrap(
      `window.__timelines["scene"] = gsap.timeline({ paused: true });`,
      `window.__timelines["scene"].to("#a", { x: 100, duration: 1 }, 0);\n` +
        `window.__timelines["scene"].to("#b", { y: 50, duration: 1 }, 0.5);`,
    );
    const parsed = parseGsapScriptAcorn(src);
    expect(parsed.unsupportedTimelinePattern).toBeFalsy();
    expect(parsed.animations).toHaveLength(2);
    expect(parsed.animations[0]!.targetSelector).toBe("#a");
    expect(parsed.animations[1]!.targetSelector).toBe("#b");
  });

  it("reads a single-quoted inline timeline", () => {
    const src = wrap(
      `window.__timelines['scene'] = gsap.timeline();`,
      `window.__timelines['scene'].to('#a', { x: 10, duration: 1 }, 0);`,
    );
    const parsed = parseGsapScriptAcorn(src);
    expect(parsed.unsupportedTimelinePattern).toBeFalsy();
    expect(parsed.animations).toHaveLength(1);
    expect(parsed.animations[0]!.targetSelector).toBe("#a");
  });

  it("reads a static dot-access inline timeline", () => {
    const src = wrap(
      `window.__timelines.scene = gsap.timeline();`,
      `window.__timelines.scene.to("#a", { x: 10, duration: 1 }, 0);`,
    );
    const parsed = parseGsapScriptAcorn(src);
    expect(parsed.unsupportedTimelinePattern).toBeFalsy();
    expect(parsed.animations).toHaveLength(1);
  });

  it("flags a computed-key timeline as unsupported (cannot statically resolve)", () => {
    const src = wrap(
      `const id = "scene";\nwindow.__timelines[id] = gsap.timeline();`,
      `window.__timelines[id].to("#a", { x: 10, duration: 1 }, 0);`,
    );
    const parsed = parseGsapScriptAcorn(src);
    expect(parsed.unsupportedTimelinePattern).toBe(true);
  });

  it("does not cross-attribute tweens of a different member slot", () => {
    const src = wrap(
      `window.__timelines["a"] = gsap.timeline();\nwindow.__timelines["b"] = gsap.timeline();`,
      `window.__timelines["a"].to("#a", { x: 1, duration: 1 }, 0);\n` +
        `window.__timelines["b"].to("#b", { x: 2, duration: 1 }, 0);`,
    );
    const parsed = parseGsapScriptAcorn(src);
    // First detected timeline is "a"; only its tween should be attributed here.
    expect(parsed.multipleTimelines).toBe(true);
    expect(parsed.animations.some((a) => a.targetSelector === "#a")).toBe(true);
    expect(parsed.animations.every((a) => a.targetSelector !== "#b")).toBe(true);
  });

  it("leaves the canonical const form working", () => {
    const src = `const tl = gsap.timeline();\nwindow.__timelines["scene"] = tl;\ntl.to("#a", { x: 5, duration: 1 }, 0);`;
    const parsed = parseGsapScriptAcorn(src);
    expect(parsed.unsupportedTimelinePattern).toBeFalsy();
    expect(parsed.animations).toHaveLength(1);
    expect(parsed.timelineVar).toBe("tl");
  });
});

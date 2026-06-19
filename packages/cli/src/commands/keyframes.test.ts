import { beforeAll, describe, expect, it } from "vitest";
import { ensureDOMParser } from "../utils/dom.js";
import { surfaceComposition } from "./keyframes.js";

beforeAll(() => ensureDOMParser());

const wrap = (script: string) =>
  `<!doctype html><html><body><div id="root" data-composition-id="main" data-duration="4"><div id="dot" class="clip"></div></div><script>${script}</script></body></html>`;

describe("keyframes multi-stroke traces", () => {
  it("composites ≥2 position strokes on one element into a single trace", () => {
    const html = wrap(`
      const tl = gsap.timeline({ paused: true });
      tl.to("#dot", { keyframes: { "0%": { x: -100, y: -150 }, "100%": { x: 80, y: -120 } }, duration: 1 });
      tl.to("#dot", { keyframes: { "0%": { x: 80, y: 120 }, "100%": { x: 85, y: 140 } }, duration: 1 });
      window.__timelines = [tl];
    `);
    const { traces } = surfaceComposition(html, "index.html", "index.html");
    expect(traces).toHaveLength(1);
    expect(traces[0]!.target).toBe("#dot");
    expect(traces[0]!.strokes).toHaveLength(2);
  });

  it("treats a 0-duration set() between strokes as a pen-up jump, not a drawn stroke", () => {
    const html = wrap(`
      const tl = gsap.timeline({ paused: true });
      tl.to("#dot", { keyframes: { "0%": { x: 0, y: 0 }, "100%": { x: 100, y: 0 } }, duration: 1 });
      tl.set("#dot", { x: 200, y: 200 });
      tl.to("#dot", { keyframes: { "0%": { x: 200, y: 200 }, "100%": { x: 250, y: 250 } }, duration: 1 });
      window.__timelines = [tl];
    `);
    const { traces } = surfaceComposition(html, "index.html", "index.html");
    expect(traces).toHaveLength(1);
    // two DRAWN strokes; the set() is the pen-up gap and is excluded
    expect(traces[0]!.strokes).toHaveLength(2);
  });

  it("leaves a single-stroke element untraced (normal per-tween output)", () => {
    const html = wrap(`
      const tl = gsap.timeline({ paused: true });
      tl.to("#dot", { keyframes: { "0%": { x: 0, y: 0 }, "50%": { x: 200, y: -100 }, "100%": { x: 0, y: 0 } }, duration: 3 });
      window.__timelines = [tl];
    `);
    const { traces, tweens } = surfaceComposition(html, "index.html", "index.html");
    expect(traces).toHaveLength(0);
    expect(tweens.length).toBeGreaterThan(0);
  });
});

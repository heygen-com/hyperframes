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

describe("keyframes composed-ancestor surfacing (nested elements)", () => {
  const nested = (script: string) =>
    `<!doctype html><html><body><div id="root" data-composition-id="main" data-duration="4"><div id="stage"><div id="hero"><div id="core" class="clip"></div></div></div></div><script>${script}</script></body></html>`;

  it("annotates a child tween with its animated ANCESTOR's motion", () => {
    const html = nested(`
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", { keyframes: { "0%": { x: -300, y: 0 }, "100%": { x: 300, y: 0 } }, duration: 4 }, 0);
      tl.to("#core", { keyframes: { "0%": { scale: 1 }, "100%": { scale: 1.5 } }, duration: 4 }, 0);
      window.__timelines = [tl];
    `);
    const { tweens } = surfaceComposition(html, "index.html", "index.html");
    const core = tweens.find((t) => t.target === "#core");
    expect(core?.composedWith?.map((a) => a.selector)).toContain("#hero");
    // and the ancestor's path EXTENT is summarised (range, not endpoints — so a
    // closed loop still reveals its travel)
    expect(core?.composedWith?.[0]!.summary).toMatch(/x -300\.\.300/);
  });

  it("does not annotate when the parent isn't animated", () => {
    const html = nested(`
      const tl = gsap.timeline({ paused: true });
      tl.to("#core", { keyframes: { "0%": { scale: 1 }, "100%": { scale: 1.5 } }, duration: 4 }, 0);
      window.__timelines = [tl];
    `);
    const { tweens } = surfaceComposition(html, "index.html", "index.html");
    expect(tweens.find((t) => t.target === "#core")?.composedWith).toBeUndefined();
  });
});

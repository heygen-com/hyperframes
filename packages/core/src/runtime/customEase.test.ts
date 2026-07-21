import { describe, expect, it, vi } from "vitest";
import { installStudioCustomEase } from "./customEase";

describe("installStudioCustomEase", () => {
  it("resolves wiggle while preserving hold, spring, custom, and named eases", () => {
    const namedEase = (progress: number) => progress * progress;
    const originalParseEase = vi.fn(() => namedEase);
    const gsap = { parseEase: originalParseEase };

    expect(installStudioCustomEase(gsap)).toBe(true);

    const wiggleEase = gsap.parseEase("wiggle(6,easeInOut)");
    expect(wiggleEase).toBeTypeOf("function");
    const samples = Array.from({ length: 401 }, (_, index) => wiggleEase(index / 400));
    expect(samples[0]).toBe(0);
    expect(samples.at(-1)).toBe(1);
    expect(samples).toEqual(Array.from({ length: 401 }, (_, index) => wiggleEase(index / 400)));
    const directions = samples
      .slice(1)
      .map((value, index) => Math.sign(value - samples[index]!))
      .filter((direction) => direction !== 0);
    expect(
      directions.filter((direction, index) => index > 0 && direction !== directions[index - 1])
        .length,
    ).toBeGreaterThanOrEqual(8);

    expect(gsap.parseEase("hold")(0.5)).toBe(0);
    expect(gsap.parseEase("spring(0.5)")(0)).toBe(0);
    expect(gsap.parseEase("custom(M0,0 C0.25,0.1 0.25,1 1,1)")(1)).toBe(1);
    expect(gsap.parseEase("power2.out")).toBe(namedEase);
    expect(originalParseEase).toHaveBeenCalledTimes(1);
  });

  it("registers custom eases in GSAP's internal ease map for keyframe-segment resolution", () => {
    // GSAP resolves keyframe SEGMENT eases via its internal _parseEase/_easeMap,
    // not the public parseEase — so the eases must be registered there too, else
    // a custom ease inside `keyframes:{...}` resolves to undefined and throws
    // "_ease is not a function" on first render.
    const easeMap = new Map<string, ((progress: number) => number) & { config?: unknown }>();
    const gsap = {
      parseEase: vi.fn((ease: unknown) => (typeof ease === "function" ? ease : null)),
      registerEase: (name: string, ease: (progress: number) => number) => easeMap.set(name, ease),
    };

    expect(installStudioCustomEase(gsap)).toBe(true);

    // Bare hold registers directly and holds at 0 until the end.
    expect(easeMap.get("hold")?.(0.5)).toBe(0);
    expect(easeMap.get("hold")?.(1)).toBe(1);

    // GSAP calls a configurable ease's `.config` with the parenthesized params
    // comma-split (custom's bezier path splits into several parts). The config
    // must rejoin them and resolve a real ease.
    const springConfig = easeMap.get("spring")?.config as (
      ...p: unknown[]
    ) => (n: number) => number;
    expect(springConfig(0.5)(0)).toBe(0);

    const customConfig = easeMap.get("custom")?.config as (
      ...p: unknown[]
    ) => (n: number) => number;
    // "custom(M0,0 C0.25,0.1 0.25,1 1,1)" → params split on "," by GSAP:
    const customEase = customConfig("M0", "0 C0.25", "0.1 0.25", "1 1", 1);
    expect(customEase(0)).toBe(0);
    expect(customEase(1)).toBe(1);
  });
});

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
});

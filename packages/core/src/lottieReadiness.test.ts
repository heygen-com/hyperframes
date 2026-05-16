import { describe, expect, it } from "vitest";
import { isLottieAnimationLoaded } from "./lottieReadiness.js";

describe("isLottieAnimationLoaded", () => {
  it("does not block on unknown shapes", () => {
    expect(isLottieAnimationLoaded(null)).toBe(true);
    expect(isLottieAnimationLoaded("not-an-animation")).toBe(true);
  });

  it("supports lottie-web isLoaded", () => {
    expect(isLottieAnimationLoaded({ isLoaded: true })).toBe(true);
    expect(isLottieAnimationLoaded({ isLoaded: false })).toBe(false);
  });

  it("supports dotLottie totalFrames readiness", () => {
    expect(isLottieAnimationLoaded({ totalFrames: 12 })).toBe(true);
    expect(isLottieAnimationLoaded({ totalFrames: 0 })).toBe(false);
  });
});

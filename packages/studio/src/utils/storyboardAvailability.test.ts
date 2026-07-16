import { describe, expect, it } from "vitest";
import { shouldFallbackToTimeline } from "./storyboardAvailability";

describe("shouldFallbackToTimeline", () => {
  it("falls back only when storyboard mode resolves without storyboard data", () => {
    expect(shouldFallbackToTimeline("storyboard", false, false)).toBe(true);
    expect(shouldFallbackToTimeline("storyboard", true, false)).toBe(false);
    expect(shouldFallbackToTimeline("storyboard", false, true)).toBe(false);
    expect(shouldFallbackToTimeline("timeline", false, false)).toBe(false);
  });
});

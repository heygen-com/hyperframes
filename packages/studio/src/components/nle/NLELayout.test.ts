import { describe, expect, it } from "vitest";
import { shouldDisableTimelineWhileCompositionLoading } from "./NLELayout";

describe("timeline loading disable state", () => {
  it("disables the timeline while the composition loading overlay is visible", () => {
    expect(shouldDisableTimelineWhileCompositionLoading(true)).toBe(true);
  });

  it("reenables the timeline after composition loading finishes", () => {
    expect(shouldDisableTimelineWhileCompositionLoading(false)).toBe(false);
  });
});

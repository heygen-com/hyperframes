import { describe, it, expect } from "vitest";
import { quantizeTimeToFrame, MEDIA_VISUAL_STYLE_PROPERTIES } from "./parityContract.js";

describe("quantizeTimeToFrame", () => {
  it("quantizes a time to the nearest frame boundary at 30fps", () => {
    // 1.5s at 30fps = frame 45 => 45/30 = 1.5
    expect(quantizeTimeToFrame(1.5, 30)).toBe(1.5);
  });

  it("floors to the previous frame boundary", () => {
    // 1.51s at 30fps: floor(1.51*30 + 1e-9) = floor(45.3) = 45 => 45/30 = 1.5
    expect(quantizeTimeToFrame(1.51, 30)).toBe(1.5);
  });

  it("handles exact frame boundaries", () => {
    // 1.0s at 24fps: floor(1.0*24 + 1e-9) = 24 => 24/24 = 1.0
    expect(quantizeTimeToFrame(1.0, 24)).toBe(1.0);
  });

  it("returns 0 for zero time", () => {
    expect(quantizeTimeToFrame(0, 30)).toBe(0);
  });

  it("returns 0 for negative time", () => {
    expect(quantizeTimeToFrame(-1, 30)).toBe(0);
  });

  it("defaults to 30fps for invalid fps", () => {
    // When fps is invalid, safeFps falls back to 30
    // quantizeTimeToFrame(1, 0) => floor(1*30+eps)/30 = 1
    expect(quantizeTimeToFrame(1, 0)).toBe(1);
    expect(quantizeTimeToFrame(1, NaN)).toBe(1);
    expect(quantizeTimeToFrame(1, -10)).toBe(1);
  });

  it("handles NaN time gracefully", () => {
    expect(quantizeTimeToFrame(NaN, 30)).toBe(0);
  });

  it("handles 60fps correctly", () => {
    // 0.5s at 60fps: floor(0.5*60 + 1e-9) = 30 => 30/60 = 0.5
    expect(quantizeTimeToFrame(0.5, 60)).toBe(0.5);
  });
});

describe("MEDIA_VISUAL_STYLE_PROPERTIES", () => {
  it("is a non-empty readonly array", () => {
    expect(MEDIA_VISUAL_STYLE_PROPERTIES.length).toBeGreaterThan(0);
  });

  it("includes core layout properties", () => {
    expect(MEDIA_VISUAL_STYLE_PROPERTIES).toContain("width");
    expect(MEDIA_VISUAL_STYLE_PROPERTIES).toContain("height");
    expect(MEDIA_VISUAL_STYLE_PROPERTIES).toContain("transform");
    expect(MEDIA_VISUAL_STYLE_PROPERTIES).toContain("opacity");
  });
});

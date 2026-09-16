import { describe, expect, it } from "vitest";
import {
  motionBlurSampleTimes,
  motionBlurFrameIsStatic,
  parseMotionBlurSettings,
} from "./motionBlur.js";

describe("motion blur shutter", () => {
  it("leaves capture disabled unless multiple samples are requested", () => {
    for (const value of [null, "0", "1"]) {
      expect(parseMotionBlurSettings(value, null, null)).toBeUndefined();
    }
  });

  it("samples the midpoint of each equal-width shutter interval", () => {
    const settings = parseMotionBlurSettings("2", null, null);
    expect(settings).toEqual({ samples: 2, shutterAngle: 180, shutterPhase: -90 });
    if (!settings) throw new Error("expected motion blur settings");
    expect(motionBlurSampleTimes(1, 30, 2, settings)).toEqual([1 - 1 / 240, 1 + 1 / 240]);
  });

  it("holds the endpoint when the shutter crosses the composition boundary", () => {
    const settings = { samples: 2, shutterAngle: 180, shutterPhase: -90 };
    expect(motionBlurSampleTimes(0, 30, 2, settings)[0]).toBe(0);
    expect(motionBlurSampleTimes(2, 30, 2, settings)[1]).toBe(2);
  });

  it.each(["", "-1", "1.5", "65", "NaN"])("rejects invalid sample count %s", (samples) => {
    expect(() => parseMotionBlurSettings(samples, null, null)).toThrow();
  });

  it("rejects a non-finite or unbounded shutter", () => {
    expect(parseMotionBlurSettings("8", "720", null)?.shutterAngle).toBe(720);
    expect(() => parseMotionBlurSettings("8", "Infinity", null)).toThrow();
    expect(() => parseMotionBlurSettings("8", "0", null)).toThrow();
    expect(() => parseMotionBlurSettings("8", "721", null)).toThrow();
    expect(() => parseMotionBlurSettings("8", null, "-361")).toThrow();
  });
});

describe("motion blur static holds", () => {
  const settings = { samples: 8, shutterAngle: 180, shutterPhase: -90 };
  const staticFrames = new Set(Array.from({ length: 20 }, (_, i) => i + 10));
  it("reuses only when both shutters remain inside a verified hold", () => {
    expect(motionBlurFrameIsStatic(staticFrames, 15, settings, true)).toBe(true);
    expect(motionBlurFrameIsStatic(staticFrames, 12, settings, true)).toBe(false);
    expect(motionBlurFrameIsStatic(staticFrames, 28, settings, true)).toBe(false);
  });
  it("does not use nominal-frame dedup at a shutter boundary or without proof", () => {
    expect(motionBlurFrameIsStatic(new Set([15]), 15, settings)).toBe(false);
    expect(motionBlurFrameIsStatic(undefined, 15, settings)).toBe(false);
    expect(motionBlurFrameIsStatic(staticFrames, 12, settings)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  MOTION_BLUR_ATTR,
  type MotionBlurSettings,
  motionBlurAttributeEdits,
  readMotionBlurSettings,
} from "./motionBlurSettings";

const read = (attrs: Record<string, string>) => readMotionBlurSettings((n) => attrs[n] ?? null);

describe("readMotionBlurSettings", () => {
  it("is off, 240 degrees, auto samples, auto tier and no events when nothing is set", () => {
    expect(read({})).toEqual({
      enabled: false,
      shutterDeg: 240,
      samples: null,
      events: false,
      tier: "auto",
    });
  });

  it("reads each attribute", () => {
    expect(
      read({
        "data-motion-blur": "on",
        "data-motion-blur-shutter": "360",
        "data-motion-blur-samples": "48",
        "data-motion-blur-events": "on",
        "data-motion-blur-tier": "capture",
      }),
    ).toEqual({ enabled: true, shutterDeg: 360, samples: 48, events: true, tier: "capture" });
  });

  it("clamps the shutter and the samples, and rounds the samples", () => {
    expect(read({ "data-motion-blur-shutter": "9000" }).shutterDeg).toBe(720);
    expect(read({ "data-motion-blur-shutter": "-5" }).shutterDeg).toBe(0);
    expect(read({ "data-motion-blur-samples": "1000" }).samples).toBe(64);
    expect(read({ "data-motion-blur-samples": "0" }).samples).toBe(2);
    expect(read({ "data-motion-blur-samples": "10.6" }).samples).toBe(11);
  });

  it("falls back to the defaults for text that is not a number or a known tier", () => {
    const s = read({
      "data-motion-blur-shutter": "wide",
      "data-motion-blur-samples": "",
      "data-motion-blur-tier": "sideways",
    });
    expect(s).toMatchObject({ shutterDeg: 240, samples: null, tier: "auto" });
  });

  it("is only on for exactly on", () => {
    expect(read({ "data-motion-blur": "true" }).enabled).toBe(false);
    expect(read({ "data-motion-blur": "off" }).enabled).toBe(false);
  });
});

describe("motionBlurAttributeEdits", () => {
  const custom: MotionBlurSettings = {
    enabled: true,
    shutterDeg: 360,
    samples: 48,
    events: true,
    tier: "filter",
  };

  it("sets what differs from the defaults and removes what does not", () => {
    expect(motionBlurAttributeEdits(custom)).toEqual({
      "data-motion-blur": "on",
      "data-motion-blur-shutter": "360",
      "data-motion-blur-samples": "48",
      "data-motion-blur-events": "on",
      "data-motion-blur-tier": "filter",
    });
    expect(
      motionBlurAttributeEdits({
        enabled: false,
        shutterDeg: 240,
        samples: null,
        events: false,
        tier: "auto",
      }),
    ).toEqual({
      "data-motion-blur": null,
      "data-motion-blur-shutter": null,
      "data-motion-blur-samples": null,
      "data-motion-blur-events": null,
      "data-motion-blur-tier": null,
    });
  });

  it("writes only attributes the reader knows", () => {
    expect(Object.keys(motionBlurAttributeEdits(custom)).sort()).toEqual(
      Object.values(MOTION_BLUR_ATTR).sort(),
    );
  });

  it("round-trips: what it writes reads back as the same settings", () => {
    for (const s of [
      custom,
      { ...custom, shutterDeg: 240, samples: null, tier: "auto" as const },
    ]) {
      const written = motionBlurAttributeEdits(s);
      const back = readMotionBlurSettings((n) => written[n] ?? null);
      expect(back).toEqual(s);
    }
  });
});

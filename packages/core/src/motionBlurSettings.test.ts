import { describe, expect, it } from "vitest";
import {
  MOTION_BLUR_ATTR,
  type MotionBlurSettings,
  elementMotionBlurAttributeEdits,
  motionBlurAttributeEdits,
  readElementMotionBlurSettings,
  readMotionBlurSettings,
  resolveMoverSettings,
} from "./motionBlurSettings";

const read = (attrs: Record<string, string>) => readMotionBlurSettings((n) => attrs[n] ?? null);

describe("readMotionBlurSettings", () => {
  it("is off, 240 degrees, auto samples, auto tier and no events when nothing is set", () => {
    expect(read({})).toEqual({
      enabled: false,
      shutterDeg: 240,
      phaseDeg: null,
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
        "data-motion-blur-phase": "-90",
        "data-motion-blur-samples": "48",
        "data-motion-blur-events": "on",
        "data-motion-blur-tier": "capture",
      }),
    ).toEqual({
      enabled: true,
      shutterDeg: 360,
      phaseDeg: -90,
      samples: 48,
      events: true,
      tier: "capture",
    });
  });

  it("clamps the phase to a full turn either way", () => {
    expect(read({ "data-motion-blur-phase": "720" }).phaseDeg).toBe(360);
    expect(read({ "data-motion-blur-phase": "-720" }).phaseDeg).toBe(-360);
    expect(read({ "data-motion-blur-phase": "360" }).phaseDeg).toBe(360);
  });

  it("keeps a phase of 0: it opens the shutter on the frame, which is not centred", () => {
    expect(read({ "data-motion-blur-phase": "0" }).phaseDeg).toBe(0);
  });

  it("treats a missing, empty or unreadable phase as centred", () => {
    expect(read({}).phaseDeg).toBeNull();
    expect(read({ "data-motion-blur-phase": "" }).phaseDeg).toBeNull();
    expect(read({ "data-motion-blur-phase": "late" }).phaseDeg).toBeNull();
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
    phaseDeg: 0,
    samples: 48,
    events: true,
    tier: "filter",
  };

  it("sets what differs from the defaults and removes what does not", () => {
    expect(motionBlurAttributeEdits(custom)).toEqual({
      "data-motion-blur": "on",
      "data-motion-blur-shutter": "360",
      "data-motion-blur-phase": "0",
      "data-motion-blur-samples": "48",
      "data-motion-blur-events": "on",
      "data-motion-blur-tier": "filter",
    });
    expect(
      motionBlurAttributeEdits({
        enabled: false,
        shutterDeg: 240,
        phaseDeg: null,
        samples: null,
        events: false,
        tier: "auto",
      }),
    ).toEqual({
      "data-motion-blur": null,
      "data-motion-blur-shutter": null,
      "data-motion-blur-phase": null,
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
      { ...custom, shutterDeg: 240, phaseDeg: null, samples: null, tier: "auto" as const },
    ]) {
      const written = motionBlurAttributeEdits(s);
      const back = readMotionBlurSettings((n) => written[n] ?? null);
      expect(back).toEqual(s);
    }
  });
});

describe("per-element motion blur settings", () => {
  it("reads mode, shutter, and samples overrides with root limits", () => {
    const read = (attrs: Record<string, string>) =>
      readElementMotionBlurSettings((n) => attrs[n] ?? null);
    expect(read({})).toEqual({ mode: "inherit", shutterDeg: null, samples: null });
    expect(read({ "data-motion-blur": "on", "data-motion-blur-shutter": "900" })).toEqual({
      mode: "on",
      shutterDeg: 720,
      samples: null,
    });
    expect(read({ "data-motion-blur": "off", "data-motion-blur-samples": "1" })).toEqual({
      mode: "off",
      shutterDeg: null,
      samples: 2,
    });
  });

  it("resolves mover overrides against root settings", () => {
    const root = { shutterDeg: 240, phaseDeg: -90, samples: 32 };
    expect(resolveMoverSettings(() => null, root)).toEqual(root);
    expect(
      resolveMoverSettings(
        (n) => (n === "data-motion-blur-shutter" ? "480" : n === "data-motion-blur-samples" ? "16" : null),
        root,
      ),
    ).toEqual({ shutterDeg: 480, phaseDeg: -90, samples: 16 });
  });

  it("writes only non-inherited element attributes", () => {
    expect(
      elementMotionBlurAttributeEdits({ mode: "inherit", shutterDeg: null, samples: null }),
    ).toEqual({
      "data-motion-blur": null,
      "data-motion-blur-shutter": null,
      "data-motion-blur-samples": null,
    });
    expect(
      elementMotionBlurAttributeEdits({ mode: "on", shutterDeg: 360, samples: 16 }),
    ).toEqual({
      "data-motion-blur": "on",
      "data-motion-blur-shutter": "360",
      "data-motion-blur-samples": "16",
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  clipFadeFilter,
  clipFadeLevelAt,
  fadeEase,
  parseClipFade,
  type HfClipFade,
} from "./clipFade";

const attrs = (record: Record<string, string>) => (name: string) => record[name] ?? null;
const FADE: HfClipFade = { fadeIn: 1, fadeOut: 2, curve: "linear" };

describe("parseClipFade", () => {
  it("returns null for a clip that declares no fade", () => {
    expect(parseClipFade(attrs({}))).toBeNull();
    expect(parseClipFade(attrs({ "data-fade-in": "0" }))).toBeNull();
  });

  it("reads either end on its own", () => {
    expect(parseClipFade(attrs({ "data-fade-in": "0.5" }))).toEqual({
      fadeIn: 0.5,
      fadeOut: 0,
      curve: "linear",
    });
    expect(parseClipFade(attrs({ "data-fade-out": "1.25" }))).toEqual({
      fadeIn: 0,
      fadeOut: 1.25,
      curve: "linear",
    });
  });

  it("falls back to a straight ramp for a curve it does not know", () => {
    const read = (curve: string) =>
      parseClipFade(attrs({ "data-fade-in": "1", "data-fade-curve": curve }))?.curve;
    expect(read("smooth")).toBe("smooth");
    expect(read("SHARP")).toBe("sharp");
    expect(read("bezier-ish")).toBe("linear");
  });

  it("ignores lengths that are not a positive number of seconds", () => {
    expect(parseClipFade(attrs({ "data-fade-in": "-1" }))).toBeNull();
    expect(parseClipFade(attrs({ "data-fade-in": "soon" }))).toBeNull();
  });
});

describe("fadeEase", () => {
  it("pins both ends whatever the shape", () => {
    for (const curve of ["linear", "smooth", "sharp"] as const) {
      expect(fadeEase(0, curve)).toBe(0);
      expect(fadeEase(1, curve)).toBe(1);
    }
  });

  it("clamps progress outside the fade", () => {
    expect(fadeEase(-5, "smooth")).toBe(0);
    expect(fadeEase(5, "smooth")).toBe(1);
  });

  it("shapes the middle the way each curve is named", () => {
    expect(fadeEase(0.5, "linear")).toBeCloseTo(0.5, 6);
    // Smooth is symmetric about the midpoint, so it also passes through it.
    expect(fadeEase(0.5, "smooth")).toBeCloseTo(0.5, 6);
    expect(fadeEase(0.25, "smooth")).toBeLessThan(0.25);
    // Sharp holds low then climbs late.
    expect(fadeEase(0.5, "sharp")).toBeCloseTo(0.25, 6);
  });
});

describe("clipFadeLevelAt", () => {
  it("is silent at the very first instant and full once the fade is done", () => {
    expect(clipFadeLevelAt(FADE, 0, 10)).toBe(0);
    expect(clipFadeLevelAt(FADE, 1, 10)).toBe(1);
    expect(clipFadeLevelAt(FADE, 5, 10)).toBe(1);
  });

  it("falls back to silence at the clip's very end", () => {
    expect(clipFadeLevelAt(FADE, 9, 10)).toBeCloseTo(0.5, 6);
    expect(clipFadeLevelAt(FADE, 10, 10)).toBe(0);
  });

  it("never reports a level outside 0..1", () => {
    for (const t of [-1, 0, 0.3, 5, 9.9, 10, 11]) {
      const level = clipFadeLevelAt(FADE, t, 10);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });

  it("shares a window too short for both fades instead of fighting over it", () => {
    // 1s in + 2s out asked of a 1.5s clip becomes 0.5s + 1s, so the two meet at
    // full level exactly once rather than overlapping into a dip.
    expect(clipFadeLevelAt(FADE, 0, 1.5)).toBe(0);
    expect(clipFadeLevelAt(FADE, 0.25, 1.5)).toBeCloseTo(0.5, 6);
    expect(clipFadeLevelAt(FADE, 0.5, 1.5)).toBe(1);
    expect(clipFadeLevelAt(FADE, 1, 1.5)).toBeCloseTo(0.5, 6);
    expect(clipFadeLevelAt(FADE, 1.5, 1.5)).toBe(0);
  });

  it("only fades in when the clip has no end to fade out of", () => {
    expect(clipFadeLevelAt(FADE, 0.5, Number.POSITIVE_INFINITY)).toBeCloseTo(0.5, 6);
    expect(clipFadeLevelAt(FADE, 5000, Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("holds a fade-out-only clip at full level until its tail", () => {
    const out: HfClipFade = { fadeIn: 0, fadeOut: 2, curve: "linear" };
    expect(clipFadeLevelAt(out, 0, 10)).toBe(1);
    expect(clipFadeLevelAt(out, 9, 10)).toBeCloseTo(0.5, 6);
  });
});

describe("clipFadeFilter", () => {
  it("leaves a clip at full level carrying exactly what its author wrote", () => {
    expect(clipFadeFilter("blur(2px)", 1)).toBe("blur(2px)");
    expect(clipFadeFilter("", 1)).toBe("");
  });

  it("composes onto the authored filter rather than replacing it", () => {
    expect(clipFadeFilter("blur(2px)", 0.5)).toBe("blur(2px) opacity(0.5000)");
    expect(clipFadeFilter("", 0.25)).toBe("opacity(0.2500)");
  });
});

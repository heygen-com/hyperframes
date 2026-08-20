import { describe, expect, it } from "vitest";
import {
  clampFadeCurve,
  clipFadeFilter,
  clipFadeLevelAt,
  fadeCurveThroughMidpoint,
  fadeEase,
  parseClipFade,
  type HfClipFade,
} from "./clipFade";

const attrs = (record: Record<string, string>) => (name: string) => record[name] ?? null;
const FADE: HfClipFade = { fadeIn: 1, fadeOut: 2, curve: 0 };

describe("parseClipFade", () => {
  it("returns null for a clip that declares no fade", () => {
    expect(parseClipFade(attrs({}))).toBeNull();
    expect(parseClipFade(attrs({ "data-fade-in": "0" }))).toBeNull();
  });

  it("reads either end on its own", () => {
    expect(parseClipFade(attrs({ "data-fade-in": "0.5" }))).toEqual({
      fadeIn: 0.5,
      fadeOut: 0,
      curve: 0,
    });
    expect(parseClipFade(attrs({ "data-fade-out": "1.25" }))).toEqual({
      fadeIn: 0,
      fadeOut: 1.25,
      curve: 0,
    });
  });

  it("reads the bend as a number, and anything else as straight", () => {
    const read = (curve: string) =>
      parseClipFade(attrs({ "data-fade-in": "1", "data-fade-curve": curve }))?.curve;
    expect(read("-0.5")).toBe(-0.5);
    expect(read("0.75")).toBe(0.75);
    // Past the limit is clamped, not rejected: an over-bent fade still fades.
    expect(read("-4")).toBe(-1);
    expect(read("4")).toBe(1);
    expect(read("smooth")).toBe(0);
    expect(read("")).toBe(0);
  });

  it("ignores lengths that are not a positive number of seconds", () => {
    expect(parseClipFade(attrs({ "data-fade-in": "-1" }))).toBeNull();
    expect(parseClipFade(attrs({ "data-fade-in": "soon" }))).toBeNull();
  });
});

describe("fadeEase", () => {
  it("pins both ends however far it is bent", () => {
    for (const curve of [-1, -0.5, 0, 0.5, 1]) {
      expect(fadeEase(0, curve)).toBe(0);
      expect(fadeEase(1, curve)).toBe(1);
    }
  });

  it("clamps progress outside the fade", () => {
    expect(fadeEase(-5, -0.5)).toBe(0);
    expect(fadeEase(5, -0.5)).toBe(1);
  });

  it("is a straight ramp at zero, and at a bend it cannot use", () => {
    expect(fadeEase(0.25, 0)).toBeCloseTo(0.25, 6);
    expect(fadeEase(0.5, 0)).toBeCloseTo(0.5, 6);
    expect(fadeEase(0.5, Number.NaN)).toBeCloseTo(0.5, 6);
  });

  it("sags below the line when bent negative and bulges above when positive", () => {
    expect(fadeEase(0.5, -0.5)).toBeCloseTo(0.25, 6);
    expect(fadeEase(0.5, 0.5)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(fadeEase(0.5, -1)).toBeLessThan(fadeEase(0.5, -0.5));
    expect(fadeEase(0.5, 1)).toBeGreaterThan(fadeEase(0.5, 0.5));
  });

  it("pairs off: bending one way exactly undoes the other", () => {
    // The two directions are inverse functions, which is what makes dragging
    // the line back through the middle land on straight instead of drifting.
    for (const p of [0.1, 0.35, 0.5, 0.8]) {
      for (const curve of [0.25, 0.5, 1]) {
        expect(fadeEase(fadeEase(p, curve), -curve)).toBeCloseTo(p, 6);
      }
    }
  });

  it("stays monotonic across the whole range, so a fade never dips", () => {
    for (const curve of [-1, -0.4, 0, 0.4, 1]) {
      let previous = -1;
      for (let step = 0; step <= 40; step++) {
        const level = fadeEase(step / 40, curve);
        expect(level).toBeGreaterThanOrEqual(previous);
        previous = level;
      }
    }
  });

  it("clamps a bend past the limit rather than running away", () => {
    expect(fadeEase(0.5, -50)).toBeCloseTo(fadeEase(0.5, -1), 12);
    expect(clampFadeCurve(-50)).toBe(-1);
    expect(clampFadeCurve(Number.NaN)).toBe(0);
  });
});

describe("fadeCurveThroughMidpoint", () => {
  it("returns the bend whose curve passes through the dragged point", () => {
    for (const level of [0.1, 0.25, 0.5, 0.7, 0.84]) {
      const curve = fadeCurveThroughMidpoint(level);
      expect(fadeEase(0.5, curve)).toBeCloseTo(level, 4);
    }
  });

  it("is straight when dragged back onto the line", () => {
    expect(fadeCurveThroughMidpoint(0.5)).toBeCloseTo(0, 9);
  });

  it("clamps a pointer dragged past what the range can express", () => {
    // Beyond the reachable band the curve stops following rather than
    // inverting: 0.5^k is bounded by the bend limit at both ends.
    expect(fadeCurveThroughMidpoint(0.001)).toBe(-1);
    expect(fadeCurveThroughMidpoint(0.999)).toBe(1);
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
    const out: HfClipFade = { fadeIn: 0, fadeOut: 2, curve: 0 };
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

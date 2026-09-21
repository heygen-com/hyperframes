import { describe, expect, it } from "vitest";
import {
  clampFadesToDuration,
  fadeGain,
  formatFadeSeconds,
  readElementFades,
  readFadeSeconds,
} from "./audioFade.js";

describe("readFadeSeconds", () => {
  it("reads a positive number and treats everything else as no fade", () => {
    expect(readFadeSeconds("0.5")).toBe(0.5);
    expect(readFadeSeconds("2")).toBe(2);
    expect(readFadeSeconds(null)).toBe(0);
    expect(readFadeSeconds("")).toBe(0);
    expect(readFadeSeconds("-1")).toBe(0);
    expect(readFadeSeconds("NaN")).toBe(0);
    expect(readFadeSeconds("abc")).toBe(0);
  });

  it("reads both attributes off an element", () => {
    const attrs: Record<string, string> = { "data-fade-in": "0.25", "data-fade-out": "1.5" };
    expect(readElementFades({ getAttribute: (n) => attrs[n] ?? null })).toEqual({
      fadeIn: 0.25,
      fadeOut: 1.5,
    });
    expect(readElementFades({ getAttribute: () => null })).toEqual({ fadeIn: 0, fadeOut: 0 });
  });
});

describe("clampFadesToDuration", () => {
  it("leaves fades that fit alone", () => {
    expect(clampFadesToDuration({ fadeIn: 1, fadeOut: 2 }, 10)).toEqual({ fadeIn: 1, fadeOut: 2 });
  });
  it("scales fades that outrun the clip so they meet inside it", () => {
    expect(clampFadesToDuration({ fadeIn: 6, fadeOut: 6 }, 6)).toEqual({ fadeIn: 3, fadeOut: 3 });
    expect(clampFadesToDuration({ fadeIn: 3, fadeOut: 1 }, 2)).toEqual({
      fadeIn: 1.5,
      fadeOut: 0.5,
    });
  });
  it("keeps authored fades on a clip of unknown duration", () => {
    expect(clampFadesToDuration({ fadeIn: 4, fadeOut: 4 }, Number.POSITIVE_INFINITY)).toEqual({
      fadeIn: 4,
      fadeOut: 4,
    });
  });
});

describe("fadeGain", () => {
  const fades = { fadeIn: 2, fadeOut: 1 };
  it("is unity with no fades", () => {
    expect(fadeGain(0, 10, { fadeIn: 0, fadeOut: 0 })).toBe(1);
    expect(fadeGain(10, 10, { fadeIn: 0, fadeOut: 0 })).toBe(1);
  });
  it("ramps linearly from silence over the fade-in", () => {
    expect(fadeGain(0, 10, fades)).toBe(0);
    expect(fadeGain(1, 10, fades)).toBe(0.5);
    expect(fadeGain(2, 10, fades)).toBe(1);
    expect(fadeGain(5, 10, fades)).toBe(1);
  });
  it("ramps linearly to silence over the fade-out, anchored at the clip end", () => {
    expect(fadeGain(9, 10, fades)).toBe(1);
    expect(fadeGain(9.5, 10, fades)).toBe(0.5);
    expect(fadeGain(10, 10, fades)).toBe(0);
    expect(fadeGain(11, 10, fades)).toBe(0);
  });
  it("multiplies where the two fades overlap on a short clip", () => {
    // 2 s clip, both fades scaled to 1 s each: midpoint is the seam.
    expect(fadeGain(1, 2, { fadeIn: 2, fadeOut: 2 })).toBe(1);
    expect(fadeGain(0.5, 2, { fadeIn: 2, fadeOut: 2 })).toBe(0.5);
  });
  it("never applies a fade-out to a clip of unknown duration", () => {
    expect(fadeGain(100, Number.POSITIVE_INFINITY, fades)).toBe(1);
    expect(fadeGain(1, Number.POSITIVE_INFINITY, fades)).toBe(0.5);
  });
});

describe("formatFadeSeconds", () => {
  it("writes short attribute text", () => {
    expect(formatFadeSeconds(0)).toBe("0");
    expect(formatFadeSeconds(1)).toBe("1");
    expect(formatFadeSeconds(0.5)).toBe("0.5");
    expect(formatFadeSeconds(0.333)).toBe("0.33");
    expect(formatFadeSeconds(-2)).toBe("0");
  });
});

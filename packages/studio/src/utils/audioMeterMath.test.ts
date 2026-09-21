import { describe, expect, it } from "vitest";
import {
  fractionToLevel,
  levelToFraction,
  markFraction,
  SILENT_CHANNEL,
  stepChannel,
  stepPair,
} from "./audioMeterMath";

describe("levelToFraction", () => {
  it("puts each dB mark on its equally spaced stop", () => {
    [1, 0.8, 0.6, 0.4, 0.2].forEach((f, i) =>
      expect(markFraction([0, -3, -6, -12, -24][i]!)).toBeCloseTo(f, 6),
    );
  });
  it("clamps silence and overs", () => {
    expect(levelToFraction(0)).toBe(0);
    expect(levelToFraction(4)).toBe(1);
  });
  it("is monotonic between marks", () => {
    expect(levelToFraction(0.5)).toBeGreaterThan(markFraction(-12));
    expect(levelToFraction(0.5)).toBeLessThan(markFraction(-3));
  });
});

describe("fractionToLevel", () => {
  it("round-trips through levelToFraction at each dB mark", () => {
    [0, -3, -6, -12, -24].forEach((db) => {
      const f = markFraction(db);
      expect(levelToFraction(fractionToLevel(f))).toBeCloseTo(f, 6);
    });
  });
  it("pins the ends: silence at 0, unity at 1", () => {
    expect(fractionToLevel(0)).toBe(0);
    expect(fractionToLevel(1)).toBe(1);
  });
  it("clamps out-of-range fractions", () => {
    expect(fractionToLevel(-0.5)).toBe(0);
    expect(fractionToLevel(1.5)).toBe(1);
  });
  it("returns 0 for non-finite input", () => {
    expect(fractionToLevel(Number.NaN)).toBe(0);
    expect(fractionToLevel(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("stepChannel", () => {
  it("attacks instantly, holds the peak, then falls", () => {
    let ch = stepChannel(SILENT_CHANNEL, 1, 0, 16);
    expect(ch.level).toBe(1);
    ch = stepChannel(ch, 0, 500, 16);
    expect(ch.peak).toBe(1);
    expect(ch.level).toBeLessThan(1);
    ch = stepChannel(ch, 0, 2000, 500);
    expect(ch.peak).toBeLessThan(1);
  });
});

describe("stepPair", () => {
  it("returns the same pair while silent at rest, and moves on sound", () => {
    const rest = stepPair(undefined, undefined, 0, 16);
    expect(stepPair(rest, { l: 0, r: 0 }, 16, 16)).toBe(rest);
    expect(stepPair(rest, { l: 1, r: 0 }, 32, 16)).not.toBe(rest);
  });
});

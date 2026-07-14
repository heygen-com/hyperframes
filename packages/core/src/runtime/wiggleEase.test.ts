import { describe, expect, it } from "vitest";
import { evaluateWiggleEase, parseWiggleEase, resolveWiggleEase } from "./wiggleEase";

function countExtrema(samples: number[]): number {
  let previousDirection = 0;
  let extrema = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const delta = samples[index]! - samples[index - 1]!;
    const direction = Math.sign(delta);
    if (direction !== 0 && previousDirection !== 0 && direction !== previousDirection) extrema += 1;
    if (direction !== 0) previousDirection = direction;
  }
  return extrema;
}

function maximumDeviation(
  type: "easeOut" | "easeInOut" | "uniform",
  from: number,
  to: number,
  amplitude?: number,
) {
  return Math.max(
    ...Array.from({ length: 101 }, (_, index) => {
      const progress = from + ((to - from) * index) / 100;
      return Math.abs(evaluateWiggleEase(progress, 6, type, amplitude) - progress);
    }),
  );
}

describe("wiggle ease", () => {
  it("parses positive integer wiggle counts and supported types", () => {
    expect(parseWiggleEase(" wiggle(6, easeInOut) ")).toEqual({
      wiggles: 6,
      type: "easeInOut",
    });
    expect(parseWiggleEase("wiggle(3,easeInOut,0.12)")).toEqual({
      wiggles: 3,
      type: "easeInOut",
      amplitude: 0.12,
    });
    expect(parseWiggleEase("wiggle(3,easeInOut,0)")?.amplitude).toBe(0);
    expect(parseWiggleEase("wiggle(3,easeInOut,1)")?.amplitude).toBe(1);
    expect(parseWiggleEase("wiggle(0,easeOut)")).toBeNull();
    expect(parseWiggleEase("wiggle(2.5,uniform)")).toBeNull();
    expect(parseWiggleEase("wiggle(3,unknown)")).toBeNull();
    expect(parseWiggleEase("wiggle(3,easeInOut,-0.1)")).toBeNull();
    expect(parseWiggleEase("wiggle(3,easeInOut,1.1)")).toBeNull();
  });

  it("is deterministic, endpoint-normalized, and oscillatory", () => {
    const progress = Array.from({ length: 401 }, (_, index) => index / 400);
    const first = progress.map((value) => evaluateWiggleEase(value, 6, "easeInOut"));
    const second = progress.map((value) => evaluateWiggleEase(value, 6, "easeInOut"));

    expect(first).toEqual(second);
    expect(first[0]).toBe(0);
    expect(first.at(-1)).toBe(1);
    expect(countExtrema(first)).toBeGreaterThanOrEqual(8);

    const explicitFirst = progress.map((value) => evaluateWiggleEase(value, 6, "easeInOut", 0.2));
    const explicitSecond = progress.map((value) => evaluateWiggleEase(value, 6, "easeInOut", 0.2));
    expect(explicitFirst).toEqual(explicitSecond);
    expect(explicitFirst[0]).toBe(0);
    expect(explicitFirst.at(-1)).toBe(1);
  });

  it("uses an explicit amplitude as the peak envelope amplitude", () => {
    expect(maximumDeviation("easeInOut", 0, 1, 0.2)).toBeGreaterThan(
      maximumDeviation("easeInOut", 0, 1, 0.1),
    );
  });

  it("preserves the per-type defaults when amplitude is omitted", () => {
    const progress = [0.125, 0.25, 0.5, 0.75, 0.875];
    expect(progress.map((value) => evaluateWiggleEase(value, 6, "easeInOut"))).toEqual(
      progress.map((value) => evaluateWiggleEase(value, 6, "easeInOut", 0.08)),
    );
    expect(progress.map((value) => evaluateWiggleEase(value, 6, "easeOut"))).toEqual(
      progress.map((value) => evaluateWiggleEase(value, 6, "easeOut", 0.16)),
    );
    expect(progress.map((value) => evaluateWiggleEase(value, 6, "uniform"))).toEqual(
      progress.map((value) => evaluateWiggleEase(value, 6, "uniform", 0.14)),
    );
  });

  it("applies the CustomWiggle-style amplitude envelopes", () => {
    expect(maximumDeviation("easeOut", 0, 0.25)).toBeGreaterThan(
      maximumDeviation("easeOut", 0.75, 1),
    );
    expect(maximumDeviation("easeInOut", 0.375, 0.625)).toBeGreaterThan(
      maximumDeviation("easeInOut", 0, 0.125),
    );
    expect(maximumDeviation("uniform", 0, 0.25)).toBeCloseTo(
      maximumDeviation("uniform", 0.75, 1),
      6,
    );
    expect(evaluateWiggleEase(0.025, 5, "anticipate")).toBeLessThan(0);
  });

  it("caches resolved functions by normalized parameters", () => {
    const first = resolveWiggleEase("wiggle(6,easeInOut,0.2)");
    const second = resolveWiggleEase(" wiggle(6, easeInOut, 0.20) ");
    const differentAmplitude = resolveWiggleEase("wiggle(6,easeInOut,0.1)");
    const legacyFirst = resolveWiggleEase("wiggle(6,easeInOut)");
    const legacySecond = resolveWiggleEase(" wiggle(6, easeInOut) ");

    expect(first).not.toBeNull();
    expect(first).toBe(second);
    expect(first).not.toBe(differentAmplitude);
    expect(legacyFirst).toBe(legacySecond);
  });
});

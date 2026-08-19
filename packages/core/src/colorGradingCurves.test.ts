import { describe, expect, it } from "vitest";
import { compileHfColorCurve, compileHfHueCurve } from "./colorGradingCurves";

describe("color grading curves", () => {
  it("compiles an identity curve", () => {
    expect([
      ...compileHfColorCurve(
        [
          [0, 0],
          [1, 1],
        ],
        5,
      ),
    ]).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("compiles a shape-preserving S-curve", () => {
    const samples = compileHfColorCurve(
      [
        [0, 0],
        [0.25, 0.18],
        [0.75, 0.82],
        [1, 1],
      ],
      9,
    );
    expect(samples[1]).toBeCloseTo(0.0787356322, 6);
    expect(samples[4]).toBeCloseTo(0.5, 6);
    expect(samples[7]).toBeCloseTo(0.9212643678, 6);
  });

  it("does not overshoot a non-monotone curve", () => {
    const samples = compileHfColorCurve(
      [
        [0, 0],
        [0.3, 0.8],
        [0.6, 0.2],
        [1, 1],
      ],
      65,
    );
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1);
  });

  it("rejects malformed input rather than guessing", () => {
    expect(() =>
      compileHfColorCurve([
        [0, 0],
        [0, 0.5],
        [1, 1],
      ]),
    ).toThrow("strictly increasing");
    expect(() => compileHfColorCurve([[0, 0]], 1)).toThrow("at least two points");
    expect(() =>
      compileHfColorCurve([
        [-0.1, 0],
        [1, 1],
      ]),
    ).toThrow("between 0 and 1");
    expect(() =>
      compileHfColorCurve([
        [0.1, 0],
        [1, 1],
      ]),
    ).toThrow("endpoints 0 and 1");
    expect(() =>
      compileHfColorCurve(
        [
          [0, -0.1],
          [1, 1],
        ],
        16,
      ),
    ).toThrow("outputs must be between 0 and 1");
    expect(() =>
      compileHfColorCurve(
        Array.from({ length: 17 }, (_, index) => [index / 16, index / 16] as const),
      ),
    ).toThrow("at most 16 points");
    expect(() =>
      compileHfHueCurve(
        [
          [0, 0],
          [120, 0],
          [240, 0],
        ],
        1,
        -1,
      ),
    ).toThrow("bounds must be finite and increasing");
  });

  it("samples hue curves continuously across red", () => {
    const samples = compileHfHueCurve(
      [
        [0, 1],
        [120, 0],
        [240, 0],
      ],
      -1,
      1,
      360,
    );
    expect(samples[0]).toBeCloseTo(1, 6);
    expect(samples[359]).toBeCloseTo(samples[0] ?? 0, 2);
  });

  it("sorts valid hue points but rejects duplicate hues", () => {
    expect(
      compileHfHueCurve(
        [
          [240, 0],
          [0, 1],
          [120, 0],
        ],
        -1,
        1,
        4,
      ),
    ).toHaveLength(4);
    expect(() =>
      compileHfHueCurve(
        [
          [0, 0],
          [0, 1],
          [180, 0],
        ],
        -1,
        1,
      ),
    ).toThrow("unique");
  });

  it("supports degree-valued hue rotation without clipping it", () => {
    const samples = compileHfHueCurve(
      [
        [0, 90],
        [120, 0],
        [240, -90],
      ],
      -180,
      180,
      360,
    );
    expect(samples[0]).toBeCloseTo(90, 5);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(-180);
    expect(Math.max(...samples)).toBeLessThanOrEqual(180);
  });
});

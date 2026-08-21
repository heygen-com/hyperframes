import { describe, expect, it } from "vitest";
import { computeDeVerifySampleFractions } from "./frameCapture.js";

describe("computeDeVerifySampleFractions", () => {
  it("pins the last sample at 95% so late-onset damage is sampled", () => {
    const fractions = computeDeVerifySampleFractions(4);
    expect(fractions).toEqual([0.25, 0.5, 0.75, 0.95]);
  });

  it("keeps the requested sample count", () => {
    for (const k of [1, 2, 3, 4, 8]) {
      expect(computeDeVerifySampleFractions(k)).toHaveLength(k);
    }
  });

  it("uses only the tail sample when k is 1", () => {
    expect(computeDeVerifySampleFractions(1)).toEqual([0.95]);
  });

  it("returns an empty grid when verification is disabled", () => {
    expect(computeDeVerifySampleFractions(0)).toEqual([]);
    expect(computeDeVerifySampleFractions(-2)).toEqual([]);
  });

  it("stays strictly increasing within (0, 1) for every supported k", () => {
    for (let k = 1; k <= 8; k++) {
      const fractions = computeDeVerifySampleFractions(k);
      for (let i = 0; i < fractions.length; i++) {
        const f = fractions[i] ?? 0;
        expect(f).toBeGreaterThan(0);
        expect(f).toBeLessThan(1);
        if (i > 0) expect(f).toBeGreaterThan(fractions[i - 1] ?? 0);
      }
    }
  });
});

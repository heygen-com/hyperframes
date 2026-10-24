import { describe, expect, it } from "vitest";
import { levels, READ_RATE } from "./signal.js";

describe("levels", () => {
  it("keeps fractional sample hops aligned late in a recording", () => {
    const samples = new Float32Array(601 * READ_RATE);
    samples.fill(0.5, 600 * READ_RATE, Math.round(600.1 * READ_RATE));
    const db = levels(samples, READ_RATE, 0.01);
    expect(db).toHaveLength(60100);
    expect(db[60005]).toBeCloseTo(20 * Math.log10(0.5), 3);
    expect(db[59990]).toBe(-120);
  });
});

import { describe, expect, it } from "vitest";
import { roundTo3, roundToCenti } from "./rounding";

describe("roundTo3", () => {
  it("rounds to 3 decimal places", () => {
    expect(roundTo3(1.23456)).toBe(1.235);
  });

  it("leaves values already at 3 decimal places unchanged", () => {
    expect(roundTo3(1.5)).toBe(1.5);
  });

  it("handles negative values", () => {
    expect(roundTo3(-1.23456)).toBe(-1.235);
  });
});

describe("roundToCenti", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundToCenti(1.2345)).toBe(1.23);
  });

  it("leaves values already at 2 decimal places unchanged", () => {
    expect(roundToCenti(1.5)).toBe(1.5);
  });

  it("handles negative values", () => {
    expect(roundToCenti(-1.2345)).toBe(-1.23);
  });
});

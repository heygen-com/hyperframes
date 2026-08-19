import { describe, expect, it } from "vitest";
import { roundDb } from "./perfSummary.js";

describe("roundDb", () => {
  it("rounds to 1 decimal", () => {
    expect(roundDb(28.4373)).toBe(28.4);
    expect(roundDb(28.45)).toBe(28.5);
  });

  it("clamps at 999 (an Infinity PSNR must never ship literally to telemetry)", () => {
    expect(roundDb(Infinity)).toBe(999);
    expect(roundDb(50000)).toBe(999);
  });

  it("passes undefined through unchanged", () => {
    expect(roundDb(undefined)).toBeUndefined();
  });

  it("is idempotent — rounding an already-rounded value is a no-op", () => {
    expect(roundDb(roundDb(28.4373))).toBe(28.4);
  });
});

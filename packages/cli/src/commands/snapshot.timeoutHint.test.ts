import { describe, expect, it } from "vitest";
import { timeoutUnitHint } from "./snapshot.js";

describe("timeoutUnitHint", () => {
  it("says --timeout is in milliseconds when the value looks like seconds", () => {
    expect(timeoutUnitHint(45)).toContain("milliseconds");
    expect(timeoutUnitHint(45)).toContain("45000");
  });

  it("stays quiet for a real millisecond value", () => {
    expect(timeoutUnitHint(45_000)).toBe("");
  });
});

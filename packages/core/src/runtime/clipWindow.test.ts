import { describe, expect, it } from "vitest";
import { isClipVisibleAt, isInClipWindow } from "./clipWindow";

describe("isInClipWindow", () => {
  it("includes the start and excludes the end", () => {
    expect([1, 1.5, 2].map((t) => isInClipWindow(t, 1, 2))).toEqual([true, true, false]);
  });

  it("hands the instant a float sum misses by a rounding step to the next clip only", () => {
    expect([isInClipWindow(26.2, 19.8, 19.8 + 6.4), isInClipWindow(26.2, 26.2, 28.2)]).toEqual([
      false,
      true,
    ]);
    expect(isInClipWindow(20 / 24, 0, 20 / 24 + 5e-7)).toBe(true);
  });

  it("keeps a clip with no known end in its window", () => {
    expect(isInClipWindow(5, 0, Number.POSITIVE_INFINITY)).toBe(true);
  });
});

describe("isClipVisibleAt", () => {
  it("hides a clip that ends before the composition does, from its end on", () => {
    expect([1.99, 2, 5].map((t) => isClipVisibleAt(t, 1, 2, 5))).toEqual([true, false, false]);
  });

  it("keeps a clip that runs to the composition end visible at and past it", () => {
    expect([4.99, 5, 6].map((t) => isClipVisibleAt(t, 4, 5, 5))).toEqual([true, true, true]);
  });

  it("does not show a clip before its start", () => {
    expect(isClipVisibleAt(3.99, 4, 5, 5)).toBe(false);
  });

  it("treats float noise in the summed end as reaching the composition end", () => {
    expect(isClipVisibleAt(0.35, 0.1, 0.3, 0.1 + 0.2)).toBe(true);
  });

  it("gives no terminal grace when the composition duration is unknown", () => {
    expect(isClipVisibleAt(5, 4, 5, 0)).toBe(false);
  });
});

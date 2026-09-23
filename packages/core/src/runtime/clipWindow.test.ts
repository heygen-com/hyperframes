import { describe, expect, it } from "vitest";
import { isClipVisibleAt, isInClipWindow } from "./clipWindow";

describe("isInClipWindow", () => {
  it("includes the start and excludes the end", () => {
    expect([1, 1.5, 2].map((t) => isInClipWindow(t, 1, 2))).toEqual([true, true, false]);
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

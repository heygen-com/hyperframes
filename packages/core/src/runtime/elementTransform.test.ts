import { describe, expect, it } from "vitest";
import { individualScale } from "./elementTransform";

describe("individualScale", () => {
  it("reads one value as both axes and two as x then y", () => {
    expect(individualScale("2")).toEqual([2, 2]);
    expect(individualScale("2 0.5")).toEqual([2, 0.5]);
    expect(individualScale("-1 1")).toEqual([-1, 1]);
  });

  it("keeps a planar z of 1 and refuses any other z as 3D", () => {
    expect(individualScale("2 3 1")).toEqual([2, 3]);
    expect(individualScale("2 3 2")).toBeNull();
  });

  it("treats none or nothing as no scale and refuses what it cannot read", () => {
    expect(individualScale("none")).toEqual([1, 1]);
    expect(individualScale(undefined)).toEqual([1, 1]);
    expect(individualScale("big")).toBeNull();
    expect(individualScale("1 1 1 1")).toBeNull();
  });
});

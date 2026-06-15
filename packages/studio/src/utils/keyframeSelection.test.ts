import { describe, it, expect } from "vitest";
import { selectedKeyframePercentagesForElement } from "./keyframeSelection";

describe("selectedKeyframePercentagesForElement", () => {
  it("returns the percentages of keyframes on the active element", () => {
    const selected = new Set(["comp#a:25", "comp#a:75"]);
    expect(selectedKeyframePercentagesForElement(selected, "comp#a")).toEqual([25, 75]);
  });

  it("drops keyframes that belong to other elements", () => {
    // The bug: a stale shift-selection on `comp#b` would otherwise have its
    // percentages applied to the now-active `comp#a`, deleting the wrong keyframes.
    const selected = new Set(["comp#a:25", "comp#b:50", "comp#b:80"]);
    expect(selectedKeyframePercentagesForElement(selected, "comp#a")).toEqual([25]);
  });

  it("returns nothing when no key belongs to the active element", () => {
    const selected = new Set(["comp#b:50"]);
    expect(selectedKeyframePercentagesForElement(selected, "comp#a")).toEqual([]);
  });

  it("returns nothing when there is no active element", () => {
    const selected = new Set(["comp#a:25"]);
    expect(selectedKeyframePercentagesForElement(selected, null)).toEqual([]);
  });

  it("returns nothing for an empty selection", () => {
    expect(selectedKeyframePercentagesForElement(new Set(), "comp#a")).toEqual([]);
  });

  it("splits on the final colon so element ids containing ':' still match", () => {
    const selected = new Set(["a:b:40"]);
    expect(selectedKeyframePercentagesForElement(selected, "a:b")).toEqual([40]);
  });

  it("skips keys without a percentage separator", () => {
    const selected = new Set(["comp#a"]);
    expect(selectedKeyframePercentagesForElement(selected, "comp#a")).toEqual([]);
  });

  it("skips keys whose percentage is not a finite number", () => {
    const selected = new Set(["comp#a:abc", "comp#a:NaN", "comp#a:30"]);
    expect(selectedKeyframePercentagesForElement(selected, "comp#a")).toEqual([30]);
  });
});

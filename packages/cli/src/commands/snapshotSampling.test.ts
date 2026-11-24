import { describe, it, expect } from "vitest";
import {
  parseSnapshotFrames,
  parseSnapshotRange,
  sampleSnapshotRange,
  resolveSnapshotCompositionRange,
} from "./snapshotSampling.js";
describe("snapshot scoped sampling", () => {
  it("samples only the requested range with exact count", () => {
    expect(sampleSnapshotRange([2, 4], 5, 10)).toEqual([2, 2.5, 3, 3.5, 4]);
    expect(sampleSnapshotRange([2, 4], 1, 10)).toEqual([3]);
    const samples = sampleSnapshotRange([2, 4], 8, 10, true);
    expect(samples).toHaveLength(8);
    expect(samples[0]).toBe(2);
    expect(samples[7]).toBeLessThan(4);
  });
  it("rejects malformed ranges and counts", () => {
    for (const v of ["1", "1:", ":2", "a:3", "3:2", "1:1", "-1:2", "0:Infinity"])
      expect(() => parseSnapshotRange(v)).toThrow();
    expect(parseSnapshotRange("1.8:2.5")).toEqual([1.8, 2.5]);
    expect(parseSnapshotRange("1.8,2.5")).toEqual([1.8, 2.5]);
    for (const v of ["abc", "-3", "0", "2.5", ""])
      expect(() => parseSnapshotFrames(v)).toThrow("--frames must be a positive integer");
    expect(parseSnapshotFrames("10")).toBe(10);
    for (const n of [0, -1, 1.5, NaN]) expect(() => sampleSnapshotRange([1, 2], n, 5)).toThrow();
    expect(() => sampleSnapshotRange([1, 6], 5, 5)).toThrow();
  });
  const html = `<html><body><div data-composition-id="main" data-duration="12"><div id="parent" data-composition-id="parent" data-start="3" data-duration="4"><div data-composition-id="child" data-start="2" data-duration="5"></div></div><div data-composition-id="later" data-start="parent + 1" data-duration="2"></div></div></body></html>`;
  it("resolves nested offsets and clamps to ancestor visibility", () => {
    expect(resolveSnapshotCompositionRange(html, {}, "child", 12)).toEqual([5, 7]);
    expect(resolveSnapshotCompositionRange(html, {}, "later", 12)).toEqual([8, 10]);
    expect(resolveSnapshotCompositionRange(html, {}, "main", 12)).toEqual([0, 12]);
  });
  it("uses registered duration and rejects missing or ambiguous IDs", () => {
    const h =
      '<div data-composition-id="main" data-duration="10"><div data-composition-id="intro" data-start="2"></div></div>';
    expect(resolveSnapshotCompositionRange(h, { intro: 3 }, "intro", 10)).toEqual([2, 5]);
    expect(resolveSnapshotCompositionRange(h, {}, "intro", 10)).toEqual([2, 10]);
    expect(() => resolveSnapshotCompositionRange(h, {}, "absent", 10)).toThrow();
    expect(() => resolveSnapshotCompositionRange(h + h, {}, "intro", 10)).toThrow();
  });
});

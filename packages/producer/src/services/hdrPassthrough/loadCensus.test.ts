import { describe, expect, it } from "bun:test";
import { compareLoadCensus, findForeignObserver, type ObserverCallback } from "./loadCensus.js";

const RUNTIME_A = "aaaa:12:40";
const RUNTIME_B = "aaaa:80:7";
const observer = (
  fn: string,
  origin: ObserverCallback["origin"] = "renderer",
  type = "MutationObserver",
): ObserverCallback => ({ type, origin, function: fn });
const census = (counts: Record<string, number>, observers: ObserverCallback[] = []) => ({
  counts: new Map(Object.entries(counts)),
  observers,
  changed: null,
});

describe("compareLoadCensus", () => {
  const analysis = census({ "Worker instances": 0, "animation-frame callbacks by page": 1 }, [
    observer(RUNTIME_A),
    observer(RUNTIME_A),
    observer(RUNTIME_B),
  ]);

  it("passes a capture page whose observers all run functions the analysis page's run", () => {
    expect(compareLoadCensus(analysis, analysis)).toBeNull();
    // The runtime's own observers vary in number from load to load: matched by function, not counted.
    const fewer = census(Object.fromEntries(analysis.counts), [observer(RUNTIME_B)]);
    expect(compareLoadCensus(analysis, fewer)).toBeNull();
    const more = census(Object.fromEntries(analysis.counts), [
      observer(RUNTIME_B),
      observer(RUNTIME_B),
    ]);
    expect(compareLoadCensus(analysis, more)).toBeNull();
  });

  it("declines any count that differs, either way", () => {
    const observers = [...analysis.observers];
    expect(
      compareLoadCensus(
        analysis,
        census({ "Worker instances": 1, "animation-frame callbacks by page": 1 }, observers),
      ),
    ).toContain("Worker instances: 1 against 0");
    expect(
      compareLoadCensus(
        analysis,
        census({ "Worker instances": 0, "animation-frame callbacks by page": 0 }, observers),
      ),
    ).toContain("animation-frame callbacks by page: 0 against 1");
    // A key the analysis page never counted is 0 there.
    expect(
      compareLoadCensus(
        analysis,
        census({ ...Object.fromEntries(analysis.counts), "film-time timers by no script": 1 }),
      ),
    ).toContain("film-time timers by no script: 1 against 0");
  });

  it("declines an observer in place of one of the runtime's, at the same count", () => {
    // Three observers on both pages; one on the capture page is not one the analysis page held.
    const swapped = census(Object.fromEntries(analysis.counts), [
      observer(RUNTIME_A),
      observer(RUNTIME_B),
      observer("", "no script"),
    ]);
    expect(compareLoadCensus(analysis, swapped)).toBe(
      "the capture page loaded differently from the analysis page (a MutationObserver whose callback, no script, no analysis-page observer runs)",
    );
    const otherFunction = census(Object.fromEntries(analysis.counts), [
      observer(RUNTIME_A),
      observer("aaaa:300:1"),
    ]);
    expect(compareLoadCensus(analysis, otherFunction)).toContain(
      "a MutationObserver whose callback, renderer script, no analysis-page observer runs",
    );
    const otherKind = census(Object.fromEntries(analysis.counts), [
      observer(RUNTIME_A, "renderer", "ResizeObserver"),
    ]);
    expect(compareLoadCensus(analysis, otherKind)).toContain("a ResizeObserver whose callback");
  });
});

describe("findForeignObserver", () => {
  it("passes observers that all run the renderer's script", () => {
    expect(findForeignObserver(census({}, [observer(RUNTIME_A), observer(RUNTIME_B)]))).toBeNull();
  });

  it("names an observer whose callback is page script or no script", () => {
    expect(findForeignObserver(census({}, [observer(RUNTIME_A), observer("", "no script")]))).toBe(
      "a MutationObserver whose callback runs no script",
    );
    expect(
      findForeignObserver(census({}, [observer("bbbb:1:1", "page", "IntersectionObserver")])),
    ).toBe("an IntersectionObserver whose callback is page script");
  });
});

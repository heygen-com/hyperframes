import { describe, expect, it } from "vitest";
import { findMatchingTimelineElementId, resolveTimelineSelectionSeekTime } from "./studioHelpers";

describe("resolveTimelineSelectionSeekTime", () => {
  it("keeps the current time when it is already inside the clip range", () => {
    expect(resolveTimelineSelectionSeekTime(3, { start: 0, duration: 5 })).toBe(3);
  });

  it("clamps to the clip start when current time is before the clip", () => {
    expect(resolveTimelineSelectionSeekTime(1, { start: 4, duration: 3 })).toBe(4);
  });

  it("clamps to the clip end when current time is after the clip", () => {
    expect(resolveTimelineSelectionSeekTime(10, { start: 4, duration: 3 })).toBe(7);
  });

  it("falls back to the clip start for invalid current time", () => {
    expect(resolveTimelineSelectionSeekTime(Number.NaN, { start: 2, duration: 5 })).toBe(2);
  });
});

describe("findMatchingTimelineElementId", () => {
  const el = (over: Record<string, unknown>) =>
    ({ id: "x", start: 0, duration: 1, track: 0, tag: "div", ...over }) as never;

  it("matches a top-level element by domId + sourceFile", () => {
    const els = [el({ id: "s1", domId: "s1", sourceFile: "index.html" })];
    expect(findMatchingTimelineElementId({ id: "s1", sourceFile: "index.html" }, els)).toBe("s1");
  });

  it("returns a qualified id for a sub-comp child with no matching timeline element", () => {
    const els = [el({ id: "s3", domId: "s3", sourceFile: "index.html" })];
    expect(
      findMatchingTimelineElementId(
        { id: "stat-3", sourceFile: "compositions/stats-panel.html" },
        els,
      ),
    ).toBe("compositions/stats-panel.html#stat-3");
  });

  it("returns null for an unmatched element in index.html", () => {
    expect(findMatchingTimelineElementId({ id: "ghost", sourceFile: "index.html" }, [])).toBe(null);
  });
});

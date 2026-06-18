// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  findMatchingTimelineElementId,
  findTimelineIdByAncestor,
  resolveTimelineSelectionSeekTime,
} from "./studioHelpers";

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

describe("findTimelineIdByAncestor", () => {
  const el = (over: Record<string, unknown>) =>
    ({ id: "x", start: 0, duration: 1, track: 0, tag: "div", ...over }) as never;

  it("resolves a static descendant (.num) to its nearest clip ancestor", () => {
    // #stat1 (a clip) > .num (selected, not a clip)
    const stat1 = document.createElement("div");
    stat1.id = "stat1";
    const num = document.createElement("div");
    num.className = "num";
    stat1.appendChild(num);

    const els = [el({ id: "stat1", domId: "stat1", key: "index.html#stat1" })];
    expect(findTimelineIdByAncestor(num, els, "index.html")).toBe("index.html#stat1");
  });

  it("returns null when no ancestor is a clip", () => {
    const wrap = document.createElement("div");
    const child = document.createElement("span");
    wrap.appendChild(child);
    expect(findTimelineIdByAncestor(child, [], "index.html")).toBe(null);
  });
});

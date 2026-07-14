import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { buildTimelineGapStrips } from "./useTimelineGapHighlights";

function el(id: string, track: number, start: number, duration: number): TimelineElement {
  return { id, key: id, tag: "video", start, duration, track, domId: id };
}

const laneA = [el("a1", 0, 1, 2), el("a2", 0, 5, 2)]; // gaps: [0,1), [3,5)
const laneB = [el("b1", 1, 0, 2), el("b2", 1, 2, 3)]; // contiguous
const tracks: [number, TimelineElement[]][] = [
  [0, laneA],
  [1, laneB],
];
const expandedElements = [...laneA, ...laneB];

const base = {
  gapHighlight: null,
  tracks,
  selectedElementId: null,
  selectedElementIds: new Set<string>(),
  expandedElements,
  dragActive: false,
};

describe("buildTimelineGapStrips", () => {
  it("emits a loud hover strip set from the gap-menu highlight", () => {
    const strips = buildTimelineGapStrips({
      ...base,
      gapHighlight: { track: 0, intervals: [{ start: 3, end: 5 }] },
    });
    expect(strips).toEqual([{ track: 0, intervals: [{ start: 3, end: 5 }], kind: "hover" }]);
  });

  it("emits the subtle strips for a single click-selected clip's lane gaps", () => {
    const strips = buildTimelineGapStrips({ ...base, selectedElementId: "a1" });
    expect(strips).toEqual([
      {
        track: 0,
        intervals: [
          { start: 0, end: 1 },
          { start: 3, end: 5 },
        ],
        kind: "selected",
      },
    ]);
  });

  it("selection on a gapless lane emits nothing", () => {
    expect(buildTimelineGapStrips({ ...base, selectedElementId: "b1" })).toEqual([]);
  });

  it("a one-member selectedElementIds mirror of the click still counts as single", () => {
    // The store mirrors a plain click into selectedElementIds = {clicked}.
    const strips = buildTimelineGapStrips({
      ...base,
      selectedElementId: "a1",
      selectedElementIds: new Set(["a1"]),
    });
    expect(strips).toHaveLength(1);
    expect(strips[0].kind).toBe("selected");
  });

  it("marquee multi-selection never emits the selected hint", () => {
    const strips = buildTimelineGapStrips({
      ...base,
      selectedElementId: "a1",
      selectedElementIds: new Set(["a1", "b1"]),
    });
    expect(strips).toEqual([]);
  });

  it("hover wins on its own lane — no doubled strips for the same track", () => {
    const strips = buildTimelineGapStrips({
      ...base,
      gapHighlight: { track: 0, intervals: [{ start: 3, end: 5 }] },
      selectedElementId: "a1",
    });
    expect(strips).toHaveLength(1);
    expect(strips[0].kind).toBe("hover");
  });

  it("hover and selection on DIFFERENT lanes coexist", () => {
    const laneC = [el("c1", 2, 4, 2)];
    const strips = buildTimelineGapStrips({
      ...base,
      tracks: [...tracks, [2, laneC]],
      expandedElements: [...expandedElements, ...laneC],
      gapHighlight: { track: 2, intervals: [{ start: 0, end: 4 }] },
      selectedElementId: "a1",
    });
    expect(strips.map((s) => s.kind)).toEqual(["hover", "selected"]);
  });

  it("a live drag suppresses every strip", () => {
    const strips = buildTimelineGapStrips({
      ...base,
      dragActive: true,
      gapHighlight: { track: 0, intervals: [{ start: 3, end: 5 }] },
      selectedElementId: "a1",
    });
    expect(strips).toEqual([]);
  });
});

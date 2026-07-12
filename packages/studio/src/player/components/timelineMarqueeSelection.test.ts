import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { RULER_H, TRACK_H } from "./timelineLayout";
import { selectTimelineElementsInMarquee } from "./timelineEditing";
import type { StackingTimelineLayer } from "./timelineTrackOrder";

function element(id: string, start: number, duration: number, track: number): TimelineElement {
  return { id, tag: "div", start, duration, track };
}

function layer(id: string, elements: TimelineElement[]): StackingTimelineLayer {
  return {
    id,
    kind: "visual",
    contextKey: "",
    zIndex: 0,
    placementTrack: elements[0]?.track ?? 0,
    elements,
  };
}

describe("selectTimelineElementsInMarquee", () => {
  it("selects clips intersecting both the marquee time span and lane span", () => {
    const layers = [
      layer("lane-0", [element("first-hit", 1, 1, 0), element("time-miss", 5, 1, 0)]),
      layer("lane-1", [element("second-hit", 2.25, 1, 1)]),
      layer("lane-2", [element("lane-miss", 1.5, 1, 2)]),
    ];

    expect(
      selectTimelineElementsInMarquee({
        rect: {
          startTime: 0.5,
          endTime: 3,
          top: RULER_H,
          bottom: RULER_H + TRACK_H * 2,
        },
        layers,
        layerOrder: layers.map((item) => item.id),
        rulerHeight: RULER_H,
        trackHeight: TRACK_H,
      }),
    ).toEqual(["first-hit", "second-hit"]);
  });

  it("returns no ids when the marquee intersects no clip", () => {
    const layers = [layer("lane-0", [element("outside", 4, 1, 0)])];

    expect(
      selectTimelineElementsInMarquee({
        rect: {
          startTime: 0,
          endTime: 1,
          top: RULER_H,
          bottom: RULER_H + TRACK_H,
        },
        layers,
        layerOrder: ["lane-0"],
        rulerHeight: RULER_H,
        trackHeight: TRACK_H,
      }),
    ).toEqual([]);
  });

  it("accounts for context group headers before row hit testing", () => {
    const layers: StackingTimelineLayer[] = [
      { ...layer("lane-0", [element("above", 0, 1, 0)]), contextKey: "root" },
      { ...layer("lane-1", [element("below", 0, 1, 1)]), contextKey: "nested" },
    ];

    expect(
      selectTimelineElementsInMarquee({
        rect: {
          startTime: 0,
          endTime: 1,
          top: RULER_H + 18 + TRACK_H,
          bottom: RULER_H + 18 + TRACK_H + 18 + TRACK_H,
        },
        layers,
        layerOrder: ["lane-0", "lane-1"],
        rulerHeight: RULER_H,
        trackHeight: TRACK_H,
        groupHeaderHeight: 18,
      }),
    ).toEqual(["below"]);
  });
});

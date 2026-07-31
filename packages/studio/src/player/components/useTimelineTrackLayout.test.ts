// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { afterEach, describe, expect, it } from "vitest";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { LANE_H, TRACK_H } from "./timelineLayout";
import { getTimelinePropertyLanes } from "./TimelinePropertyLanes";
import { useTimelineTrackLayout } from "./useTimelineTrackLayout";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  usePlayerStore.getState().reset();
});

function renderTrackLayout(
  elements: TimelineElement[],
  animations: Map<string, GsapAnimation[]>,
): {
  layout: ReturnType<typeof useTimelineTrackLayout>;
  unmount: () => void;
} {
  usePlayerStore.setState({ expandedClipIds: new Set(["clip-1"]) });

  let layout: ReturnType<typeof useTimelineTrackLayout> | undefined;
  function Probe() {
    layout = useTimelineTrackLayout(elements, animations, null, new Set());
    return null;
  }

  const root = createRoot(document.createElement("div"));
  act(() => root.render(React.createElement(Probe)));
  if (!layout) throw new Error("Timeline track layout did not render");

  return { layout, unmount: () => act(() => root.unmount()) };
}

describe("useTimelineTrackLayout", () => {
  it("counts a flat tween lane and reserves its expanded row height", () => {
    const elements: TimelineElement[] = [
      { id: "clip-1", tag: "div", start: 0, duration: 1, track: 0 },
    ];
    const animations = new Map<string, GsapAnimation[]>([
      [
        "clip-1",
        [
          {
            id: "position-tween",
            targetSelector: "#clip-1",
            method: "to",
            position: 0,
            duration: 1,
            properties: { x: 420 },
            propertyGroup: "position",
          },
        ],
      ],
    ]);
    const { layout, unmount } = renderTrackLayout(elements, animations);

    expect(layout.laneCounts.get("clip-1")).toBe(1);
    expect(layout.rowHeights).toEqual([TRACK_H + LANE_H]);
    expect(layout.rowGeometry.rowKeys).toEqual([0]);
    expect(layout.rowGeometry.canvasHeight).toBeGreaterThan(TRACK_H + LANE_H);
    unmount();
  });

  // The row height reserved here and the lanes actually rendered are two
  // readings of the same question. They used to be two inline copies of the
  // group-set rule, and a mixed-group tween made them disagree: zero reserved
  // rows under two rendered lanes.
  it("reserves exactly as many rows as the lanes a mixed-group tween renders", () => {
    const elements: TimelineElement[] = [
      { id: "clip-1", tag: "div", start: 0, duration: 1, track: 0 },
    ];
    const mixed: GsapAnimation = {
      id: "entrance",
      targetSelector: "#clip-1",
      method: "to",
      position: 0,
      duration: 1,
      properties: { x: 420, opacity: 1 },
    };
    const animations = new Map<string, GsapAnimation[]>([["clip-1", [mixed]]]);
    const { layout, unmount } = renderTrackLayout(elements, animations);

    expect(getTimelinePropertyLanes([mixed], 0, 1)).toHaveLength(2);
    expect(layout.laneCounts.get("clip-1")).toBe(2);
    expect(layout.rowHeights).toEqual([TRACK_H + 2 * LANE_H]);
    unmount();
  });
});

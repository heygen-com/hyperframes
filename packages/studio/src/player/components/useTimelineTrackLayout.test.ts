// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { afterEach, describe, expect, it } from "vitest";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { LANE_H, TRACK_H } from "./timelineLayout";
import { useTimelineTrackLayout } from "./useTimelineTrackLayout";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  usePlayerStore.getState().reset();
});

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
    usePlayerStore.setState({ expandedClipIds: new Set(["clip-1"]) });

    let layout: ReturnType<typeof useTimelineTrackLayout> | undefined;
    function Probe() {
      layout = useTimelineTrackLayout(elements, animations, null, new Set());
      return null;
    }

    const root = createRoot(document.createElement("div"));
    act(() => root.render(React.createElement(Probe)));

    expect(layout?.laneCounts.get("clip-1")).toBe(1);
    expect(layout?.rowHeights).toEqual([TRACK_H + LANE_H]);
    act(() => root.unmount());
  });
});

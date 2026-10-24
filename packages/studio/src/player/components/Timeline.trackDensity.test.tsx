// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Timeline } from "./Timeline";
import { installTimelineMountEnv } from "./timelineMountTestEnv";
import { usePlayerStore } from "../store/playerStore";
import { useTimelineTrackDensity } from "./useTimelineTrackHeight";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { CLIP_Y, COMPACT_TRACK_H, LANE_H, RULER_H, TRACKS_TOP_PAD } from "./timelineLayout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installTimelineMountEnv();

afterEach(() => {
  useTimelineTrackDensity.setState({ density: "comfortable" });
  document.body.innerHTML = "";
});

const positionTween: GsapAnimation = {
  id: "card-position",
  targetSelector: "#card",
  method: "to",
  position: 0,
  duration: 2,
  properties: {},
  propertyGroup: "position",
  keyframes: {
    format: "percentage",
    keyframes: [
      { percentage: 0, properties: { x: 0 } },
      { percentage: 50, properties: { x: 100 } },
    ],
  },
};

async function mountCompact() {
  useTimelineTrackDensity.setState({ density: "compact" });
  usePlayerStore.setState({
    duration: 10,
    currentTime: 0,
    timelineReady: true,
    selectedElementId: "card",
    selectedElementIds: new Set(),
    expandedClipIds: new Set(["card"]),
    elements: [
      { id: "card", key: "card", tag: "div", start: 0, duration: 4, track: 0 },
      { id: "title", key: "title", tag: "div", start: 0, duration: 4, track: 1 },
    ],
    gsapAnimations: new Map([["card", [positionTween]]]),
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Timeline onAssetDrop={() => {}} />));
  return { host, root };
}

describe("Timeline compact track density", () => {
  it("sizes clip bars, property lanes and the ghost lane from the compact track height", async () => {
    const { host, root } = await mountCompact();
    const expandedRowHeight = COMPACT_TRACK_H + LANE_H;

    const clip = host.querySelector<HTMLElement>('[data-clip][data-el-id="card"]');
    expect(clip?.style.height).toBe(`${COMPACT_TRACK_H - 2 * CLIP_Y}px`);

    const lane = host.querySelector<HTMLElement>(
      '[data-timeline-property-lane][data-timeline-element-id="card"]',
    );
    expect(lane?.style.top).toBe(`${COMPACT_TRACK_H}px`);
    expect(lane?.dataset.timelineLaneTop).toBe(`${COMPACT_TRACK_H}`);

    const ghost = host.querySelector<HTMLElement>('[data-testid="timeline-ghost-lane"]');
    expect(ghost?.style.height).toBe(`${COMPACT_TRACK_H - 2 * CLIP_Y}px`);
    expect(ghost?.style.top).toBe(
      `${RULER_H + TRACKS_TOP_PAD + expandedRowHeight + COMPACT_TRACK_H + CLIP_Y}px`,
    );
    act(() => root.unmount());
  });
});

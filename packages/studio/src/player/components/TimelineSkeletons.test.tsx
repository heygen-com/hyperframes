// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { TimelineSkeletons } from "./TimelineSkeletons";
import type { PlacedSkeleton, TimelineSkeletonLayout } from "./useTimelineSkeletons";
import { CLIP_Y, RULER_H, TRACKS_TOP_PAD } from "./timelineLayout";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

const ROW_HEIGHTS = [48, 48];
const CONTENT_ORIGIN = 100;
const PPS = 50;

function skeleton(partial: Partial<PlacedSkeleton> = {}): PlacedSkeleton {
  return { key: "job-1:0", start: 1, end: 3, lane: 0, ...partial };
}

function render(layout: Partial<TimelineSkeletonLayout>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <TimelineSkeletons
        placed={layout.placed ?? []}
        incoming={layout.incoming ?? []}
        incomingTracks={layout.incomingTracks ?? []}
        contentOrigin={CONTENT_ORIGIN}
        pps={PPS}
        rowHeights={ROW_HEIGHTS}
        displayTrackOrder={[0, 1]}
      />,
    );
  });
  return { host, root };
}

function boxes(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[data-timeline-skeleton="true"]')];
}

describe("TimelineSkeletons", () => {
  it("draws a declared clip at the time it was declared for", () => {
    const { host, root } = render({ placed: [skeleton({ start: 1, end: 3 })] });

    const [box] = boxes(host);
    expect(box!.style.left).toBe(`${CONTENT_ORIGIN + 1 * PPS}px`);
    expect(box!.style.width).toBe(`${2 * PPS}px`);
    // First row, inset by the same clip padding a real clip uses.
    expect(box!.style.top).toBe(`${RULER_H + TRACKS_TOP_PAD + CLIP_Y}px`);
    act(() => root.unmount());
  });

  it("draws one box per declared clip, on their own lanes", () => {
    const { host, root } = render({
      placed: [skeleton({ key: "a", lane: 0 }), skeleton({ key: "b", lane: 1, start: 4, end: 5 })],
    });

    const drawn = boxes(host);
    expect(drawn).toHaveLength(2);
    expect(drawn[0]!.style.top).not.toBe(drawn[1]!.style.top);
    act(() => root.unmount());
  });

  // A skeleton is a promise, not a thing to click.
  it("takes no pointer events", () => {
    const { host, root } = render({ placed: [skeleton()] });
    const layer = host.querySelector<HTMLElement>('[data-timeline-skeletons="true"]');
    expect(layer?.className).toContain("pointer-events-none");
    act(() => root.unmount());
  });

  it("shows the agent's own label when it gave one", () => {
    const { host, root } = render({ placed: [skeleton({ label: "Hero card" })] });
    expect(host.textContent).toContain("Hero card");
    act(() => root.unmount());
  });

  // The most interesting thing an agent can declare is a track that does not
  // exist yet, and it has to be visible before the clip that creates it lands.
  it("draws a track that does not exist yet below the ones that do", () => {
    const { host, root } = render({
      incoming: [skeleton({ key: "new", lane: 7 })],
      incomingTracks: [7],
    });

    const [box] = boxes(host);
    const lastRowBottom = RULER_H + TRACKS_TOP_PAD + ROW_HEIGHTS[0]! + ROW_HEIGHTS[1]!;
    expect(Number.parseFloat(box!.style.top)).toBeGreaterThanOrEqual(lastRowBottom);
    expect(box!.className).toContain("border-dashed");
    expect(host.textContent).toContain("New track 7");
    act(() => root.unmount());
  });

  it("splits the incoming band between two new tracks rather than stacking them", () => {
    const { host, root } = render({
      incoming: [skeleton({ key: "a", lane: 7 }), skeleton({ key: "b", lane: 9 })],
      incomingTracks: [7, 9],
    });

    const drawn = boxes(host);
    expect(drawn).toHaveLength(2);
    expect(drawn[0]!.style.top).not.toBe(drawn[1]!.style.top);
    act(() => root.unmount());
  });

  // A zero-width bar would be invisible, and a run that declared something
  // should never look like a run that declared nothing.
  it("keeps a very short clip wide enough to see", () => {
    const { host, root } = render({ placed: [skeleton({ start: 1, end: 1.01 })] });
    expect(Number.parseFloat(boxes(host)[0]!.style.width)).toBeGreaterThanOrEqual(6);
    act(() => root.unmount());
  });

  it("draws nothing at all when no run declared anything", () => {
    const { host, root } = render({});
    expect(host.textContent).toBe("");
    expect(host.querySelector('[data-timeline-skeletons="true"]')).toBeNull();
    act(() => root.unmount());
  });

  // A lane the timeline is not currently showing (a collapsed or filtered
  // track) has no row to draw on, and guessing one would be a lie.
  it("skips a clip whose lane is not on screen", () => {
    const { host, root } = render({ placed: [skeleton({ lane: 42 })] });
    expect(boxes(host)).toHaveLength(0);
    act(() => root.unmount());
  });
});

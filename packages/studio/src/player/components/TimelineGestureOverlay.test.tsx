// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { defaultTimelineTheme } from "./timelineTheme";
import { TimelineGestureOverlay } from "./TimelineGestureOverlay";
import type { DraggedClipState } from "./timelineClipDragTypes";
import { getTrackStyle } from "./useTimelineTrackLayout";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const drag: DraggedClipState = {
  element: { id: "hero", tag: "div", start: 2, duration: 3, track: 1 },
  originClientX: 100,
  originClientY: 100,
  originScrollLeft: 0,
  originScrollTop: 0,
  pointerClientX: 350,
  pointerClientY: 240,
  pointerOffsetX: 20,
  pointerOffsetY: 10,
  previewStart: 4,
  previewTrack: 2,
  insertRow: null,
  snapTime: null,
  snapType: null,
  started: true,
};

afterEach(() => document.body.replaceChildren());

describe("TimelineGestureOverlay", () => {
  it("keeps the drag actor mounted without a source-row node", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const scroll = {
      scrollLeft: 500,
      scrollTop: 300,
      getBoundingClientRect: () => ({ left: 50, top: 40 }),
    } as HTMLDivElement;
    act(() => {
      root.render(
        <TimelineGestureOverlay
          drag={drag}
          scrollRef={{ current: scroll }}
          pixelsPerSecond={100}
          rowHeight={42}
          selectedElementId="hero"
          currentTime={4}
          theme={defaultTimelineTheme}
          getTrackStyle={getTrackStyle}
        />,
      );
    });
    const actor = host.querySelector<HTMLElement>('[data-timeline-gesture-actor="hero"]');
    expect(actor?.style.left).toBe("780px");
    expect(actor?.style.top).toBe("490px");
    expect(actor?.querySelector(".timeline-clip")).not.toBeNull();
    expect(actor?.querySelector("[data-el-id]")).toBeNull();
    expect(actor?.querySelector("[data-clip]")).toBeNull();
    expect(host.querySelector("[data-source-row]")).toBeNull();
    act(() => root.unmount());
  });

  it("keeps the stable overlay host after terminal cleanup", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <TimelineGestureOverlay
          drag={null}
          scrollRef={{ current: null }}
          pixelsPerSecond={100}
          rowHeight={42}
          selectedElementId={null}
          currentTime={0}
          theme={defaultTimelineTheme}
          getTrackStyle={getTrackStyle}
        />,
      );
    });
    expect(host.querySelector("[data-timeline-gesture-overlay]")).not.toBeNull();
    expect(host.querySelector("[data-timeline-gesture-actor]")).toBeNull();
    act(() => root.unmount());
  });
});

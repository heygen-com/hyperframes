// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { createTimelineRowGeometry, getTimelineRowTop } from "./timelineLayout";
import { createTimelineClipIndex } from "../lib/timelineClipIndex";
import { useTimelineRangeSelection } from "./useTimelineRangeSelection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const elements: TimelineElement[] = [
  { id: "first", tag: "div", start: 1, duration: 1, track: 0 },
  { id: "offscreen", tag: "div", start: 2, duration: 1, track: 50 },
  { id: "base", tag: "div", start: 8, duration: 1, track: 99 },
];
const tracks = Array.from({ length: 100 }, (_, index) => index);
const geometry = createTimelineRowGeometry(
  tracks,
  tracks.map(() => 48),
);
const clipIndex = createTimelineClipIndex(
  tracks.map((track) => [track, elements.filter((element) => element.track === track)]),
);

function pointer(
  currentTarget: HTMLElement,
  pointerId: number,
  clientX: number,
  clientY: number,
  init: Partial<React.PointerEvent> = {},
): React.PointerEvent {
  return {
    button: 0,
    clientX,
    clientY,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    pointerId,
    currentTarget,
    target: currentTarget,
    ...init,
  } as React.PointerEvent;
}

function renderHarness(sessionEpoch = 1) {
  const host = document.createElement("div");
  const scroll = document.createElement("div");
  scroll.setPointerCapture = vi.fn();
  scroll.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 800, bottom: 240, width: 800, height: 240 }) as DOMRect;
  Object.defineProperties(scroll, {
    scrollLeft: { configurable: true, writable: true, value: 0 },
    scrollTop: { configurable: true, writable: true, value: 0 },
    scrollWidth: { configurable: true, value: 10_000 },
    scrollHeight: { configurable: true, value: geometry.canvasHeight },
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 240 },
  });
  host.append(scroll);
  document.body.append(host);
  const root = createRoot(host);
  let api: ReturnType<typeof useTimelineRangeSelection> | null = null;
  const ppsRef = { current: 100 };
  const dragScrollRaf = { current: 0 };
  const isDragging = { current: false };
  const elementsRef = { current: elements };
  const rowGeometryRef = { current: geometry };

  function Probe({ epoch }: { epoch: number }) {
    api = useTimelineRangeSelection({
      scrollRef: { current: scroll },
      ppsRef,
      effectiveDuration: 60,
      pps: 100,
      seekFromX: vi.fn(),
      autoScrollDuringDrag: vi.fn(),
      dragScrollRaf,
      isDragging,
      setShowPopover: vi.fn(),
      elementsRef,
      clipIndex,
      rowGeometryRef,
      contentOrigin: 0,
      sessionEpoch: epoch,
    });
    return null;
  }

  act(() => root.render(<Probe epoch={sessionEpoch} />));
  return {
    scroll,
    root,
    get api() {
      if (!api) throw new Error("selection harness did not render");
      return api;
    },
    rerender(epoch: number) {
      act(() => root.render(<Probe epoch={epoch} />));
    },
  };
}

afterEach(() => {
  usePlayerStore.getState().reset();
  document.body.innerHTML = "";
});

describe("useTimelineRangeSelection", () => {
  it("marquee-selects model clips across unmounted virtual rows", () => {
    const view = renderHarness();
    const y0 = getTimelineRowTop(0) + 4;
    const y50 = getTimelineRowTop(50) + 40;

    act(() => {
      view.api.handlePointerDown(pointer(view.scroll, 7, 0, y0));
      view.api.handlePointerMove(pointer(view.scroll, 7, 400, y50));
    });

    expect(document.querySelectorAll("[data-clip]")).toHaveLength(0);
    expect(usePlayerStore.getState().selectedElementIds).toEqual(new Set(["first", "offscreen"]));
    act(() => view.root.unmount());
  });

  it("ignores another pointer and restores the pre-drag selection on cancellation", () => {
    usePlayerStore.getState().setSelectedElementId("base");
    const view = renderHarness();
    const y0 = getTimelineRowTop(0) + 4;
    const y50 = getTimelineRowTop(50) + 40;

    act(() => {
      view.api.handlePointerDown(pointer(view.scroll, 7, 0, y0));
      view.api.handlePointerMove(pointer(view.scroll, 7, 400, y50));
      view.api.handlePointerUp(pointer(view.scroll, 8, 400, y50));
    });
    expect(usePlayerStore.getState().selectedElementIds).toEqual(new Set(["first", "offscreen"]));

    act(() => view.api.handlePointerCancel(pointer(view.scroll, 7, 400, y50)));
    expect(usePlayerStore.getState().selectedElementId).toBe("base");
    expect(usePlayerStore.getState().selectedElementIds).toEqual(new Set(["base"]));
    act(() => view.root.unmount());
  });

  it("cancels a live marquee when the project session changes", () => {
    usePlayerStore.getState().setSelectedElementId("base");
    const view = renderHarness(1);
    const y0 = getTimelineRowTop(0) + 4;
    const y50 = getTimelineRowTop(50) + 40;

    act(() => {
      view.api.handlePointerDown(pointer(view.scroll, 7, 0, y0));
      view.api.handlePointerMove(pointer(view.scroll, 7, 400, y50));
    });
    usePlayerStore.getState().setSelectedElementId("base");
    view.rerender(2);

    expect(usePlayerStore.getState().selectedElementId).toBe("base");
    expect(usePlayerStore.getState().selectedElementIds).toEqual(new Set(["base"]));
    act(() => view.root.unmount());
  });
});

// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import {
  cancelTimelineZoom,
  registerTimelineZoomViewport,
  requestTimelineZoom,
  settleTimelineZoom,
  zoomTimelineToRange,
} from "./timelineZoomInput";
import { getTimelineRenderTimeRange } from "./timelineViewportGeometry";
import { useTimelineClipRenderWindow } from "./useTimelineClipRenderWindow";
import type { TimelineScrollViewportSnapshot } from "./useTimelineScrollViewport";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let unregisterViewport = () => {};

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout"],
  });
  // 1000% of a 10 px/s fit, scrolled to 50 s in a 1080px viewport with 32px of track headers.
  usePlayerStore.setState({
    zoomMode: "manual",
    manualZoomPercent: 1000,
    timelineFitPps: 10,
    timelinePps: 100,
    duration: 100,
    currentTime: 0,
  });
  const scroll = document.createElement("div");
  Object.defineProperties(scroll, {
    clientWidth: { value: 1080 },
    scrollWidth: { value: 10_032 },
    scrollLeft: { value: 5000, writable: true },
  });
  unregisterViewport = registerTimelineZoomViewport({ scroll, contentOrigin: 32 });
});

afterEach(() => {
  act(() => cancelTimelineZoom());
  act(() => root?.unmount());
  root = null;
  unregisterViewport();
  vi.useRealTimers();
});

const SNAPSHOT = { scrollLeft: 5000, clientWidth: 1080 } as TimelineScrollViewportSnapshot;

function renderWindow(renders: { start: number; end: number }[] = []) {
  let range = { start: 0, end: 0 };
  function Harness() {
    const pixelsPerSecond = usePlayerStore((state) => state.timelinePps);
    ({ renderTimeRange: range } = useTimelineClipRenderWindow({
      tracks: [],
      viewport: SNAPSHOT,
      pixelsPerSecond,
      contentOrigin: 32,
      duration: 100,
    }));
    renders.push(range);
    return null;
  }
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root?.render(React.createElement(Harness)));
  return () => range;
}

it("mounts a quarter viewport each side at rest and half while a zoom previews", () => {
  const range = renderWindow();
  expect(range()).toEqual({ start: 46.98, end: 63.18 });
  act(() => requestTimelineZoom(600, { time: 55.24, x: 556 }));
  expect(range()).toEqual({ start: 44.28, end: 65.88 });
  act(() => cancelTimelineZoom());
  expect(range()).toEqual({ start: 46.98, end: 63.18 });
});

it("lets a zoom-out preview show the wider window it mounted", () => {
  renderWindow();
  // At 60 px/s about 55.24 s the view shows 46.5..63.97 s: past the rest window, inside the zoom's.
  act(() => requestTimelineZoom(600, { time: 55.24, x: 556 }));
  act(() => vi.advanceTimersToNextFrame());
  expect(usePlayerStore.getState().timelinePps).toBe(100);
});

it("lays a zoom out in one render, with the rest window", () => {
  const renders: { start: number; end: number }[] = [];
  renderWindow(renders);
  act(() => requestTimelineZoom(600, { time: 55.24, x: 556 }));
  renders.length = 0;
  act(() => settleTimelineZoom());
  expect(renders).toEqual([getTimelineRenderTimeRange(SNAPSHOT, 60, 32, 100)]);
});

it("keeps an eased zoom-out a preview in its first frame", () => {
  renderWindow();
  act(() => void zoomTimelineToRange(60, 80, { smooth: true }));
  act(() => vi.advanceTimersToNextFrame());
  expect(usePlayerStore.getState().timelinePps).toBe(100);
});

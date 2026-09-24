// @vitest-environment happy-dom

import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { useTimelinePlayhead } from "./useTimelinePlayhead";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function scrollBox(scrollLeft: number) {
  const el = document.createElement("div");
  let left = scrollLeft;
  Object.defineProperties(el, {
    clientWidth: { value: 800 },
    scrollWidth: { value: 20_000 },
    scrollLeft: { get: () => left, set: (v: number) => (left = v) },
  });
  return el;
}

function Harness({ pps, scroll }: { pps: number; scroll: HTMLDivElement }) {
  useTimelinePlayhead({
    playheadRef: createRef(),
    scrollRef: { current: scroll },
    ppsRef: { current: pps },
    durationRef: { current: 60 },
    isDragging: { current: false },
    currentTime: 0,
    zoomMode: "manual",
    manualZoomPercent: 100,
    zoomModeRef: { current: "manual" },
    manualZoomPercentRef: { current: 100 },
    fitPps: pps,
    fitPpsRef: { current: pps },
    effectiveDuration: 60,
    pps,
    timelineReady: true,
    elementsLength: 1,
    setZoomMode: () => {},
    setManualZoomPercent: () => {},
    contentOrigin: 32,
  });
  return null;
}

function zoom(scrollLeft: number, fromPps: number, toPps: number) {
  const scroll = scrollBox(scrollLeft);
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Harness pps={fromPps} scroll={scroll} />));
  act(() => root.render(<Harness pps={toPps} scroll={scroll} />));
  act(() => root.unmount());
  return scroll.scrollLeft;
}

describe("useTimelinePlayhead centre anchor", () => {
  it("keeps a view at the start at the start when the scale changes", () => {
    expect(zoom(0, 100, 114)).toBe(0);
  });

  it("keeps the time at the viewport centre when the view is scrolled", () => {
    // Centre time (400 + 400 - 32) / 100 = 7.68s lands at 32 + 7.68 * 200 - 400.
    expect(zoom(400, 100, 200)).toBe(1168);
  });
});

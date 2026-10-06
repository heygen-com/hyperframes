// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import {
  requestTimelineZoom,
  setTimelineZoomViewport,
  takeTimelineZoomAnchor,
  zoomTimelineStep,
  zoomTimelineToRange,
} from "./timelineZoomInput";

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "setTimeout",
      "clearTimeout",
      "performance",
    ],
  });
  usePlayerStore.setState({
    zoomMode: "fit",
    manualZoomPercent: 100,
    timelineFitPps: 10,
    timelinePps: 10,
    userZoomCount: 0,
  });
});
afterEach(() => {
  setTimelineZoomViewport(null);
  takeTimelineZoomAnchor();
  vi.useRealTimers();
});

describe("requestTimelineZoom", () => {
  it("writes the store once per frame with the last zoom asked for", () => {
    const writes = vi.fn();
    const unsubscribe = usePlayerStore.subscribe(writes);
    requestTimelineZoom(150);
    requestTimelineZoom(200, { time: 4, x: 100 });
    requestTimelineZoom(300, { time: 5, x: 120 });
    expect(writes).not.toHaveBeenCalled();
    vi.advanceTimersToNextFrame();
    unsubscribe();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState()).toMatchObject({
      zoomMode: "manual",
      manualZoomPercent: 300,
      timelinePps: 30,
      userZoomCount: 1,
    });
    expect(takeTimelineZoomAnchor()).toEqual({ time: 5, x: 120 });
    expect(takeTimelineZoomAnchor()).toBeNull();
  });
});

describe("zoomTimelineToRange", () => {
  function viewport(clientWidth: number, scrollLeft = 0) {
    const scroll = document.createElement("div");
    Object.defineProperties(scroll, {
      clientWidth: { value: clientWidth },
      scrollLeft: { value: scrollLeft, writable: true },
    });
    setTimelineZoomViewport({ scroll, contentOrigin: 32 });
  }

  it("fills the width with the range and puts its start at the left margin", () => {
    viewport(1080);
    zoomTimelineToRange(100, 150, { smooth: false });
    vi.advanceTimersToNextFrame();
    // 1080 - (32 + 24) - 24 = 1000px for 50s is 20 pps.
    expect(usePlayerStore.getState().timelinePps).toBeCloseTo(20);
    expect(takeTimelineZoomAnchor()).toEqual({ time: 100, x: 56 });
  });

  it("eases there over several frames and ends exactly on the range", () => {
    viewport(1080);
    zoomTimelineToRange(10, 20);
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
    const midway = usePlayerStore.getState().timelinePps;
    expect(midway).toBeGreaterThan(10);
    expect(midway).toBeLessThan(100);
    for (let i = 0; i < 30; i++) vi.advanceTimersToNextFrame();
    expect(usePlayerStore.getState().timelinePps).toBeCloseTo(100);
    const anchor = takeTimelineZoomAnchor();
    // The range's start lands at the left margin, 32 + 24 px in.
    expect(anchor && anchor.x + (10 - anchor.time) * 100).toBeCloseTo(56);
  });

  it("stops easing when a person zooms during it", () => {
    viewport(1080);
    zoomTimelineToRange(10, 20);
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
    requestTimelineZoom(150);
    for (let i = 0; i < 30; i++) vi.advanceTimersToNextFrame();
    expect(usePlayerStore.getState().manualZoomPercent).toBe(150);
  });
});

describe("zoomTimelineStep", () => {
  function viewport(scrollLeft: number) {
    const scroll = document.createElement("div");
    Object.defineProperties(scroll, {
      clientWidth: { value: 1080 },
      scrollLeft: { value: scrollLeft, writable: true },
    });
    setTimelineZoomViewport({ scroll, contentOrigin: 32 });
  }
  const run = () => {
    for (let i = 0; i < 30; i++) vi.advanceTimersToNextFrame();
  };
  const screenX = (time: number) => {
    const anchor = takeTimelineZoomAnchor();
    return anchor && anchor.x + (time - anchor.time) * usePlayerStore.getState().timelinePps;
  };

  it("doubles the scale and keeps an on-screen playhead where it is", () => {
    usePlayerStore.setState({ currentTime: 40 });
    viewport(0);
    // At 10 pps the playhead sits at 32 + 400 = 432px.
    zoomTimelineStep("in");
    run();
    expect(usePlayerStore.getState().timelinePps).toBeCloseTo(20);
    expect(screenX(40)).toBeCloseTo(432);
  });

  it("centres an off-screen playhead", () => {
    usePlayerStore.setState({ currentTime: 300 });
    viewport(0);
    zoomTimelineStep("in");
    run();
    // The range's middle, 56 + 1000 / 2, is the playhead.
    expect(screenX(300)).toBeCloseTo(556);
  });
});

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import {
  currentTimelineRange,
  currentTimelineZoomPercent,
  requestTimelineZoom,
  setTimelineZoomViewport,
  takeTimelineZoomAnchor,
  timelineZoomMapping,
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
    currentTime: 0,
  });
});
afterEach(() => {
  // Run out any ease, preview and rest, so the next test starts with nothing scheduled.
  for (let i = 0; i < 40; i++) vi.advanceTimersToNextFrame();
  setTimelineZoomViewport(null);
  takeTimelineZoomAnchor();
  vi.useRealTimers();
});

/** A 1080px timeline viewport with 32px of track headers, holding one scaled row. */
function viewport(scrollLeft = 0) {
  const scroll = document.createElement("div");
  Object.defineProperties(scroll, {
    clientWidth: { value: 1080 },
    scrollWidth: { value: 20_000 },
    scrollLeft: { value: scrollLeft, writable: true },
  });
  const row = scroll.appendChild(document.createElement("div"));
  row.setAttribute("data-timeline-zoom-scale", "");
  setTimelineZoomViewport({ scroll, contentOrigin: 32 });
  return { scroll, row };
}

/** Where `time` lands on screen once the committed zoom is laid out. */
const laidOutX = (time: number) => {
  const anchor = takeTimelineZoomAnchor();
  return anchor && anchor.x + (time - anchor.time) * usePlayerStore.getState().timelinePps;
};

describe("requestTimelineZoom", () => {
  it("scales the drawn rows during a gesture and lays the zoom out once it rests", () => {
    const { row } = viewport();
    const writes = vi.fn();
    const unsubscribe = usePlayerStore.subscribe(writes);
    requestTimelineZoom(120, { time: 4, x: 100 });
    requestTimelineZoom(150, { time: 4, x: 100 });
    vi.advanceTimersToNextFrame();
    expect(writes).not.toHaveBeenCalled();
    expect(currentTimelineZoomPercent()).toBe(150);
    // 4 s stays at 100px: 32 + 4 * 15 - left = 100, left = -8 clamps to 0, translated by 0.
    expect(row.style.transform).toBe("translateX(0px) scaleX(1.5)");
    vi.advanceTimersByTime(150);
    unsubscribe();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState()).toMatchObject({
      zoomMode: "manual",
      manualZoomPercent: 150,
      timelinePps: 15,
      userZoomCount: 1,
    });
    expect(row.style.transform).toBe("");
  });

  it("keeps the time under the pointer while previewing, then lays it out there", () => {
    const { scroll, row } = viewport(400);
    // 432px in: (400 + 432 - 32) / 10 = 80 s.
    requestTimelineZoom(150, { time: 80, x: 432 });
    vi.advanceTimersToNextFrame();
    const mapping = timelineZoomMapping(10, 32);
    expect(mapping.pps).toBe(15);
    expect(mapping.contentOrigin + 80 * mapping.pps - scroll.scrollLeft).toBeCloseTo(432);
    expect(row.style.transform).toContain("scaleX(1.5)");
    vi.advanceTimersByTime(150);
    expect(laidOutX(80)).toBeCloseTo(432);
  });

  it("lays the zoom out mid-gesture once the preview has scaled too far", () => {
    viewport();
    requestTimelineZoom(300);
    vi.advanceTimersToNextFrame();
    expect(usePlayerStore.getState().timelinePps).toBe(10);
    requestTimelineZoom(500);
    vi.advanceTimersToNextFrame();
    expect(usePlayerStore.getState().timelinePps).toBe(50);
  });
});

describe("zoomTimelineToRange", () => {
  it("fills the width with the range and puts its start at the left margin", () => {
    viewport();
    void zoomTimelineToRange(100, 150, { smooth: false });
    // 1080 - (32 + 24) - 24 = 1000px for 50s is 20 pps.
    expect(usePlayerStore.getState().timelinePps).toBeCloseTo(20);
    expect(laidOutX(100)).toBeCloseTo(56);
  });

  it("eases there over several frames and ends exactly on the range", () => {
    viewport();
    void zoomTimelineToRange(10, 20);
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
    expect(currentTimelineZoomPercent()).toBeGreaterThan(100);
    expect(currentTimelineZoomPercent()).toBeLessThan(1000);
    for (let i = 0; i < 30; i++) vi.advanceTimersToNextFrame();
    expect(usePlayerStore.getState().timelinePps).toBeCloseTo(100);
    expect(laidOutX(10)).toBeCloseTo(56);
  });

  it("stops easing when a person zooms during it, and says it was cancelled", async () => {
    viewport();
    const result = zoomTimelineToRange(10, 20);
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
    requestTimelineZoom(150);
    for (let i = 0; i < 30; i++) vi.advanceTimersToNextFrame();
    expect(usePlayerStore.getState().manualZoomPercent).toBe(150);
    await expect(result).resolves.toBe("cancelled");
  });

  it("resolves done once the range is laid out, without counting as a person's zoom", async () => {
    const { row } = viewport();
    let settled: string | null = null;
    void zoomTimelineToRange(10, 20).then((r) => (settled = r));
    for (let i = 0; i < 30 && settled === null; i++) {
      vi.advanceTimersToNextFrame();
      await Promise.resolve();
    }
    expect(settled).toBe("done");
    expect(usePlayerStore.getState().timelinePps).toBeCloseTo(100);
    expect(usePlayerStore.getState().userZoomCount).toBe(0);
    expect(row.style.transform).toBe("");
  });

  it("cancels when the caller aborts", async () => {
    viewport();
    const abort = new AbortController();
    const result = zoomTimelineToRange(10, 20, { signal: abort.signal });
    vi.advanceTimersToNextFrame();
    abort.abort();
    await expect(result).resolves.toBe("cancelled");
  });
});

describe("currentTimelineRange", () => {
  it("reads back the range zoomTimelineToRange filled", () => {
    viewport();
    void zoomTimelineToRange(100, 150, { smooth: false });
    const range = currentTimelineRange()!;
    expect(range.start).toBeCloseTo(100);
    expect(range.end).toBeCloseTo(150);
  });

  it("reads the range a gesture shows before it is laid out", () => {
    viewport();
    requestTimelineZoom(150, { time: 0, x: 32 });
    const range = currentTimelineRange()!;
    // 1000px between the margins at 15 px/s, from 24px in.
    expect(range.start).toBeCloseTo(24 / 15);
    expect(range.end - range.start).toBeCloseTo(1000 / 15);
  });

  it("is null with no timeline mounted", () => {
    expect(currentTimelineRange()).toBeNull();
  });
});

describe("zoomTimelineStep", () => {
  const run = () => {
    for (let i = 0; i < 30; i++) vi.advanceTimersToNextFrame();
  };

  it("counts as a person's zoom", () => {
    viewport();
    zoomTimelineStep("in");
    run();
    expect(usePlayerStore.getState().userZoomCount).toBeGreaterThan(0);
  });

  it("doubles the scale and keeps an on-screen playhead where it is", () => {
    usePlayerStore.setState({ currentTime: 40 });
    viewport();
    // At 10 pps the playhead sits at 32 + 400 = 432px.
    zoomTimelineStep("in");
    run();
    expect(usePlayerStore.getState().timelinePps).toBeCloseTo(20);
    expect(laidOutX(40)).toBeCloseTo(432);
  });

  it("centres an off-screen playhead", () => {
    usePlayerStore.setState({ currentTime: 300 });
    viewport();
    zoomTimelineStep("in");
    run();
    // The range's middle, 56 + 1000 / 2, is the playhead.
    expect(laidOutX(300)).toBeCloseTo(556);
  });
});

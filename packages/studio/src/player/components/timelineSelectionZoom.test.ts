// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import type { TimelineElement } from "../store/timelineElement";
import { selectedClipsRange, zoomToSelectedClips } from "./timelineSelectionZoom";
import { registerTimelineZoomViewport, takeTimelineZoomAnchor } from "./timelineZoomInput";

const clip = (id: string, start: number, duration: number): TimelineElement => ({
  id,
  tag: "div",
  start,
  duration,
  track: 0,
});

describe("selectedClipsRange", () => {
  const elements = [clip("a", 0, 4), clip("b", 10, 5), clip("c", 30, 2), clip("d", 96, 8)];

  it("spans a single clip", () => {
    expect(selectedClipsRange(elements, ["b"])).toEqual({ start: 10, end: 15 });
  });

  it("spans several clips from the first start to the last end, gaps included", () => {
    expect(selectedClipsRange(elements, ["c", "b"])).toEqual({ start: 10, end: 32 });
  });

  it("ends at the clip that ends last, not the one that starts last", () => {
    const overlapping = [clip("inner", 10, 5), clip("outer", 5, 30), clip("later", 12, 2)];
    expect(selectedClipsRange(overlapping, ["inner", "outer", "later"])).toEqual({
      start: 5,
      end: 35,
    });
  });

  it("keeps a clip at the very start and one at the very end", () => {
    expect(selectedClipsRange(elements, ["a"])).toEqual({ start: 0, end: 4 });
    expect(selectedClipsRange(elements, ["d"])).toEqual({ start: 96, end: 104 });
    expect(selectedClipsRange(elements, ["a", "d"])).toEqual({ start: 0, end: 104 });
  });

  it("matches a clip by its key before its id", () => {
    const keyed = { ...clip("dup", 20, 3), key: "host.html#dup" };
    expect(selectedClipsRange([keyed], ["host.html#dup"])).toEqual({ start: 20, end: 23 });
    expect(selectedClipsRange([keyed], ["dup"])).toBeNull();
  });

  it("is null with nothing selected, or only ids that are not clips", () => {
    expect(selectedClipsRange(elements, [])).toBeNull();
    expect(selectedClipsRange(elements, ["comp.html#child"])).toBeNull();
  });

  it("is null for a selection with no length", () => {
    expect(selectedClipsRange([clip("z", 5, 0)], ["z"])).toBeNull();
  });
});

describe("zoomToSelectedClips", () => {
  let unregister = () => {};
  // A 1080px viewport with 32px of track headers. At 10 px/s fit, its 1046px track holds 104.6s.
  const contentOrigin = 32;
  const clientWidth = 1080;

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
      duration: 104.6,
      elements: [clip("a", 0, 5), clip("b", 40, 10), clip("c", 50, 10), clip("d", 99.6, 5)],
      selectedElementId: null,
      selectedElementIds: new Set(),
    });
    const scroll = document.createElement("div");
    Object.defineProperties(scroll, {
      clientWidth: { value: clientWidth },
      scrollWidth: { value: 20_000 },
      scrollLeft: { value: 0, writable: true },
    });
    unregister = registerTimelineZoomViewport({ scroll, contentOrigin, publishScroll: () => {} });
  });

  afterEach(() => {
    for (let i = 0; i < 40; i++) vi.advanceTimersToNextFrame();
    unregister();
    takeTimelineZoomAnchor();
    vi.useRealTimers();
  });

  /** Lets the eased zoom land, then says where each time sits on screen. */
  function settle() {
    for (let i = 0; i < 40; i++) vi.advanceTimersToNextFrame();
    const anchor = takeTimelineZoomAnchor()!;
    const pps = usePlayerStore.getState().timelinePps;
    return (time: number) => anchor.x + (time - anchor.time) * pps;
  }

  it("fills the width between the margins with the selected clips", () => {
    usePlayerStore.getState().setSelection(["b", "c"], "b");
    void zoomToSelectedClips();
    const x = settle();
    // 1080 - (32 + 24) - 24 = 1000px for 20s.
    expect(usePlayerStore.getState().timelinePps).toBeCloseTo(1000 / 20);
    expect(x(40)).toBeCloseTo(56);
    expect(x(60)).toBeCloseTo(1056);
  });

  it("keeps a clip at the very start fully on screen", () => {
    usePlayerStore.getState().setSelection(["a"]);
    void zoomToSelectedClips();
    const x = settle();
    expect(usePlayerStore.getState().timelinePps).toBeCloseTo(1000 / 5);
    expect(x(0)).toBeGreaterThanOrEqual(contentOrigin - 0.5);
    expect(x(5)).toBeLessThanOrEqual(clientWidth);
  });

  it("keeps a clip at the very end fully on screen", () => {
    usePlayerStore.getState().setSelection(["d"]);
    void zoomToSelectedClips();
    const x = settle();
    expect(usePlayerStore.getState().timelinePps).toBeCloseTo(1000 / 5);
    expect(x(99.6)).toBeGreaterThanOrEqual(contentOrigin);
    expect(x(104.6)).toBeLessThanOrEqual(clientWidth + 0.5);
  });

  it("does nothing with no clip selected", async () => {
    await expect(zoomToSelectedClips()).resolves.toBe("cancelled");
    expect(usePlayerStore.getState().zoomMode).toBe("fit");
  });
});

// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach } from "vitest";
import { describe, it, expect, vi } from "vitest";
import {
  Timeline,
  formatTimelineTickLabel,
  generateTicks,
  getDefaultDroppedTrack,
  getTimelineCanvasHeight,
  resolveTimelineAssetDrop,
  getTimelinePlayheadLeft,
  getTimelineScrollLeftForZoomAnchor,
  getTimelineScrollLeftForZoomTransition,
  shouldShowTimelineShortcutHint,
  shouldHandleTimelineDeleteKey,
  shouldAutoScrollTimeline,
} from "./Timeline";
import {
  GUTTER,
  MIN_TIMELINE_EXTENT_S,
  RULER_H,
  TRACK_H,
  getTimelineDisplayContentWidth,
  getTimelineFitPps,
} from "./timelineLayout";
import { formatTime } from "../lib/time";
import { usePlayerStore } from "../store/playerStore";
import { TimelineEditProvider } from "../../contexts/TimelineEditContext";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
});

describe("Timeline provider boundary", () => {
  // fallow-ignore-next-line code-duplication
  it("renders the public Timeline export without TimelineEditProvider", () => {
    const host = document.createElement("div");
    document.body.append(host);
    Object.defineProperty(host, "clientWidth", {
      configurable: true,
      value: 640,
    });

    usePlayerStore.setState({
      duration: 4,
      timelineReady: true,
      elements: [{ id: "clip-1", tag: "div", start: 0, duration: 2, track: 0 }],
    });

    const root = createRoot(host);

    expect(() => {
      act(() => {
        root.render(React.createElement(Timeline));
      });
    }).not.toThrow();

    act(() => root.unmount());
  });

  // fallow-ignore-next-line code-duplication
  it("renders the gutter without legacy icons or hue dots", () => {
    const host = document.createElement("div");
    document.body.append(host);
    Object.defineProperty(host, "clientWidth", {
      configurable: true,
      value: 640,
    });

    usePlayerStore.setState({
      duration: 4,
      timelineReady: true,
      elements: [{ id: "clip-1", tag: "div", start: 0, duration: 2, track: 0 }],
    });

    const root = createRoot(host);
    act(() => {
      root.render(React.createElement(Timeline));
    });

    const hueDot = Array.from(host.querySelectorAll("div")).find(
      (node) =>
        node.style.width === "6px" &&
        node.style.height === "6px" &&
        node.style.borderRadius === "9999px",
    );

    expect(host.querySelector('img[src^="/icons/timeline/"]')).toBeNull();
    expect(hueDot).toBeUndefined();
    act(() => root.unmount());
  });

  // fallow-ignore-next-line code-duplication
  it("requests persisted track visibility from the gutter without seeking", () => {
    const host = document.createElement("div");
    document.body.append(host);
    Object.defineProperty(host, "clientWidth", {
      configurable: true,
      value: 640,
    });

    usePlayerStore.setState({
      duration: 4,
      timelineReady: true,
      elements: [{ id: "clip-1", tag: "div", start: 0, duration: 2, track: 0, hidden: true }],
    });

    const onSeek = vi.fn();
    const onToggleTrackHidden = vi.fn();
    const root = createRoot(host);
    act(() => {
      root.render(
        React.createElement(
          TimelineEditProvider,
          { value: { onToggleTrackHidden } },
          React.createElement(Timeline, { onSeek }),
        ),
      );
    });

    // Flush passive effects (ResizeObserver-driven layout) so the gutter row is
    // mounted before we query it.
    act(() => {});

    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Show track 0"]');
    expect(button).not.toBeNull();
    if (!button) throw new Error("Expected a track visibility toggle");

    act(() => {
      button.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 120,
          clientY: 40,
        }),
      );
    });
    expect(onSeek).not.toHaveBeenCalled();

    act(() => {
      button.click();
    });

    const row = button.parentElement?.parentElement;
    const trackContent = row?.children.item(1);
    expect(onToggleTrackHidden).toHaveBeenCalledWith(0, false);
    expect(trackContent).toBeInstanceOf(HTMLElement);
    if (!(trackContent instanceof HTMLElement)) {
      throw new Error("Expected track content element");
    }
    expect(trackContent.style.opacity).toBe("0.35");

    act(() => root.unmount());
  });

  it("opens the keyframe context menu without seeking to that keyframe", () => {
    const host = document.createElement("div");
    document.body.append(host);
    Object.defineProperty(host, "clientWidth", {
      configurable: true,
      value: 720,
    });

    usePlayerStore.setState({
      duration: 4,
      timelineReady: true,
      currentTime: 0.25,
      selectedElementId: "clip-1",
      elements: [{ id: "clip-1", tag: "div", start: 0, duration: 4, track: 0 }],
      keyframeCache: new Map([
        [
          "clip-1",
          {
            format: "percentage",
            keyframes: [{ percentage: 50, properties: { x: 100 }, tweenPercentage: 50 }],
          },
        ],
      ]),
    });

    const onSeek = vi.fn();
    const root = createRoot(host);
    act(() => {
      root.render(React.createElement(Timeline, { onSeek }));
    });

    const diamond = host.querySelector<HTMLButtonElement>('button[title="50%"]');
    expect(diamond).not.toBeNull();

    act(() => {
      diamond!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 120,
          clientY: 40,
        }),
      );
    });

    expect(onSeek).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("marks every clip in selectedElementIds as selected", () => {
    const host = document.createElement("div");
    document.body.append(host);
    Object.defineProperty(host, "clientWidth", {
      configurable: true,
      value: 720,
    });

    usePlayerStore.setState({
      duration: 6,
      timelineReady: true,
      selectedElementId: "clip-2",
      selectedElementIds: new Set(["clip-1", "clip-2"]),
      elements: [
        { id: "clip-1", tag: "div", start: 0, duration: 1, track: 0 },
        { id: "clip-2", tag: "div", start: 1.5, duration: 1, track: 1 },
        { id: "clip-3", tag: "div", start: 3, duration: 1, track: 2 },
      ],
    });

    const root = createRoot(host);
    act(() => {
      root.render(React.createElement(Timeline));
    });

    const selectedClips = host.querySelectorAll(".timeline-clip.is-selected");
    expect(selectedClips).toHaveLength(2);
    expect(host.querySelector('[data-el-id="clip-3"]')?.classList.contains("is-selected")).toBe(
      false,
    );

    act(() => root.unmount());
  });
});

describe("generateTicks", () => {
  it("returns empty arrays for duration <= 0", () => {
    expect(generateTicks(0)).toEqual({ major: [], minor: [] });
    expect(generateTicks(-5)).toEqual({ major: [], minor: [] });
  });

  it("generates ticks for a short duration (3 seconds)", () => {
    const { major } = generateTicks(3);
    expect(major.length).toBeGreaterThan(0);
    expect(major[0]).toBe(0);
    expect(major).toContain(0);
    expect(major).toContain(1);
    expect(major).toContain(2);
    expect(major).toContain(3);
  });

  it("generates ticks for a medium duration (10 seconds)", () => {
    const { major, minor } = generateTicks(10);
    expect(major).toContain(0);
    expect(major).toContain(2);
    expect(major).toContain(4);
    expect(major).toContain(6);
    expect(major).toContain(8);
    expect(major).toContain(10);
    expect(minor).toContain(1);
    expect(minor).toContain(3);
    expect(minor).toContain(5);
  });

  it("generates ticks for a long duration (120 seconds)", () => {
    const { major, minor } = generateTicks(120);
    expect(major).toContain(0);
    expect(major).toContain(30);
    expect(major).toContain(60);
    expect(major).toContain(90);
    expect(major).toContain(120);
    expect(minor).toContain(15);
    expect(minor).toContain(45);
  });

  it("generates ticks for a very long duration (500 seconds)", () => {
    const { major } = generateTicks(500);
    expect(major).toContain(0);
    expect(major).toContain(60);
    expect(major).toContain(120);
  });

  it("major and minor ticks do not overlap", () => {
    const { major, minor } = generateTicks(30);
    for (const t of minor) {
      expect(major).not.toContain(t);
    }
  });

  it("all tick values are non-negative", () => {
    const { major, minor } = generateTicks(60);
    for (const t of [...major, ...minor]) {
      expect(t).toBeGreaterThanOrEqual(0);
    }
  });

  it("major ticks always start at 0", () => {
    for (const d of [1, 5, 10, 30, 60, 120, 300]) {
      const { major } = generateTicks(d);
      expect(major[0]).toBe(0);
    }
  });

  it("uses denser major labels as timeline zoom increases", () => {
    const fitTicks = generateTicks(180, 10);
    const zoomedTicks = generateTicks(180, 48);
    expect(fitTicks.major[1] - fitTicks.major[0]).toBe(10);
    expect(fitTicks.minor).toContain(5);
    expect(zoomedTicks.major[1] - zoomedTicks.major[0]).toBe(2);
    expect(zoomedTicks.minor).toContain(1);
  });

  it("keeps labels readable instead of placing one at every tiny tick", () => {
    const { major } = generateTicks(180, 80);
    expect(major[1] - major[0]).toBe(2);
  });
});

describe("formatTime", () => {
  it("formats 0 seconds as 00:00", () => {
    expect(formatTime(0)).toBe("00:00");
  });

  // fallow-ignore-next-line code-duplication
  it("formats seconds below a minute", () => {
    expect(formatTime(5)).toBe("00:05");
    expect(formatTime(30)).toBe("00:30");
    expect(formatTime(59)).toBe("00:59");
  });

  it("formats exactly one minute", () => {
    expect(formatTime(60)).toBe("01:00");
  });

  it("formats minutes and seconds", () => {
    expect(formatTime(90)).toBe("01:30");
    expect(formatTime(125)).toBe("02:05");
  });

  it("floors fractional seconds", () => {
    expect(formatTime(5.7)).toBe("00:05");
    expect(formatTime(59.9)).toBe("00:59");
    expect(formatTime(90.5)).toBe("01:30");
  });

  it("handles large values", () => {
    expect(formatTime(600)).toBe("10:00");
    expect(formatTime(3661)).toBe("61:01");
  });

  it("zero-pads minutes and seconds to two digits", () => {
    expect(formatTime(1)).toBe("00:01");
    expect(formatTime(9)).toBe("00:09");
    expect(formatTime(61)).toBe("01:01");
  });
});

describe("formatTimelineTickLabel", () => {
  it("uses minute-second labels for normal timeline intervals", () => {
    expect(formatTimelineTickLabel(90, 180, 5)).toBe("01:30");
  });

  it("uses hour labels for long timelines", () => {
    expect(formatTimelineTickLabel(3661, 4000, 60)).toBe("1:01:01");
  });

  it("shows subsecond labels when the major ruler interval is below one second", () => {
    expect(formatTimelineTickLabel(1.5, 3, 0.5)).toBe("00:01.5");
  });
});

describe("shouldAutoScrollTimeline", () => {
  it("never auto-scrolls in fit mode", () => {
    expect(shouldAutoScrollTimeline("fit", 1200, 800)).toBe(false);
  });

  it("does not auto-scroll when there is no horizontal overflow", () => {
    expect(shouldAutoScrollTimeline("manual", 800, 800)).toBe(false);
    expect(shouldAutoScrollTimeline("manual", 800.5, 800)).toBe(false);
  });

  it("auto-scrolls in manual mode when horizontal overflow exists", () => {
    expect(shouldAutoScrollTimeline("manual", 1200, 800)).toBe(true);
  });
});

describe("getTimelineFitPps (min 60s extent)", () => {
  const viewport = 632; // usable width = 632 - GUTTER - 2 = 598

  it("computes fit pps against the 60s floor for short compositions", () => {
    // A 10s comp maps 60s onto the viewport → the comp takes ~1/6 of the width.
    const pps = getTimelineFitPps(viewport, 10);
    expect(pps).toBeCloseTo((viewport - GUTTER - 2) / MIN_TIMELINE_EXTENT_S);
    expect(10 * pps).toBeCloseTo((viewport - GUTTER - 2) / 6);
  });

  it("keeps filling the viewport with the composition when it is 60s or longer", () => {
    expect(getTimelineFitPps(viewport, 60)).toBeCloseTo((viewport - GUTTER - 2) / 60);
    expect(getTimelineFitPps(viewport, 120)).toBeCloseTo((viewport - GUTTER - 2) / 120);
  });

  it("falls back to 100 pps before the viewport is measured", () => {
    expect(getTimelineFitPps(0, 10)).toBe(100);
    expect(getTimelineFitPps(GUTTER, 10)).toBe(100);
    expect(getTimelineFitPps(Number.NaN, 10)).toBe(100);
  });

  it("uses the floor for zero/invalid durations", () => {
    expect(getTimelineFitPps(viewport, 0)).toBeCloseTo(
      (viewport - GUTTER - 2) / MIN_TIMELINE_EXTENT_S,
    );
    expect(getTimelineFitPps(viewport, Number.NaN)).toBeCloseTo(
      (viewport - GUTTER - 2) / MIN_TIMELINE_EXTENT_S,
    );
  });
});

describe("getTimelineDisplayContentWidth", () => {
  it("always spans at least MIN_TIMELINE_EXTENT_S seconds of content", () => {
    // 10s of content at 20 pps = 200px; the floor keeps 60s (1200px) rendered.
    expect(
      getTimelineDisplayContentWidth({ trackContentWidth: 200, viewportWidth: 400, pps: 20 }),
    ).toBe(MIN_TIMELINE_EXTENT_S * 20);
  });

  it("still fills the viewport when that is larger than the 60s floor", () => {
    expect(
      getTimelineDisplayContentWidth({ trackContentWidth: 200, viewportWidth: 2000, pps: 5 }),
    ).toBe(2000 - GUTTER - 2);
  });

  it("tracks a drag ghost past every other bound (drag-to-extend)", () => {
    expect(
      getTimelineDisplayContentWidth({
        trackContentWidth: 500,
        viewportWidth: 400,
        pps: 5,
        dragGhostEndPx: 5000,
      }),
    ).toBe(5000);
  });

  it("tracks a resize (trim) ghost past every other bound (trim-to-extend)", () => {
    expect(
      getTimelineDisplayContentWidth({
        trackContentWidth: 500,
        viewportWidth: 400,
        pps: 5,
        resizeGhostEndPx: 4200,
      }),
    ).toBe(4200);
  });

  it("keeps long content authoritative", () => {
    expect(
      getTimelineDisplayContentWidth({ trackContentWidth: 9000, viewportWidth: 400, pps: 50 }),
    ).toBe(9000);
  });
});

describe("getTimelineScrollLeftForZoomTransition", () => {
  it("resets horizontal scroll when switching from manual zoom back to fit", () => {
    expect(getTimelineScrollLeftForZoomTransition("manual", "fit", 480)).toBe(0);
  });

  it("resets horizontal scroll whenever the next zoom mode is fit", () => {
    expect(getTimelineScrollLeftForZoomTransition("fit", "fit", 480)).toBe(0);
    expect(getTimelineScrollLeftForZoomTransition(null, "fit", 480)).toBe(0);
  });

  it("preserves the current scroll offset for manual zoom transitions", () => {
    expect(getTimelineScrollLeftForZoomTransition("fit", "manual", 480)).toBe(480);
    expect(getTimelineScrollLeftForZoomTransition("manual", "manual", 480)).toBe(480);
  });
});

describe("getTimelineScrollLeftForZoomAnchor", () => {
  it("preserves the time under the pointer when zooming in", () => {
    expect(
      getTimelineScrollLeftForZoomAnchor({
        pointerX: 300,
        currentScrollLeft: 200,
        gutter: 32,
        currentPixelsPerSecond: 10,
        nextPixelsPerSecond: 20,
        duration: 120,
      }),
    ).toBe(668);
  });

  it("clamps negative scroll targets", () => {
    expect(
      getTimelineScrollLeftForZoomAnchor({
        pointerX: 300,
        currentScrollLeft: 0,
        gutter: 32,
        currentPixelsPerSecond: 20,
        nextPixelsPerSecond: 5,
        duration: 120,
      }),
    ).toBe(0);
  });

  it("preserves current scroll when inputs are invalid", () => {
    expect(
      getTimelineScrollLeftForZoomAnchor({
        pointerX: 300,
        currentScrollLeft: 120,
        gutter: 32,
        currentPixelsPerSecond: 0,
        nextPixelsPerSecond: 20,
        duration: 120,
      }),
    ).toBe(120);
  });
});

describe("getTimelinePlayheadLeft", () => {
  it("converts time to a pixel offset from the gutter", () => {
    expect(getTimelinePlayheadLeft(4, 20)).toBe(112);
  });

  it("guards invalid input", () => {
    expect(getTimelinePlayheadLeft(Number.NaN, 20)).toBe(32);
    expect(getTimelinePlayheadLeft(4, Number.NaN)).toBe(32);
  });
});

describe("getTimelineCanvasHeight", () => {
  it("includes bottom scroll buffer below the last track", () => {
    expect(getTimelineCanvasHeight(3)).toBeGreaterThan(RULER_H + 3 * TRACK_H);
  });

  it("still keeps ruler space when there are no tracks", () => {
    expect(getTimelineCanvasHeight(0)).toBeGreaterThan(24);
  });
});

describe("shouldShowTimelineShortcutHint", () => {
  it("shows the hint when the timeline does not vertically overflow", () => {
    expect(shouldShowTimelineShortcutHint(220, 220)).toBe(true);
    expect(shouldShowTimelineShortcutHint(220.5, 220)).toBe(true);
  });

  it("hides the hint when timeline tracks need vertical scrolling", () => {
    expect(shouldShowTimelineShortcutHint(221.5, 220)).toBe(false);
  });
});

describe("shouldHandleTimelineDeleteKey", () => {
  it("handles Delete and Backspace when focus is not in an editor", () => {
    expect(shouldHandleTimelineDeleteKey({ key: "Delete" })).toBe(true);
    expect(shouldHandleTimelineDeleteKey({ key: "Backspace" })).toBe(true);
  });

  it("ignores modifier shortcuts", () => {
    expect(shouldHandleTimelineDeleteKey({ key: "Delete", metaKey: true })).toBe(false);
    expect(shouldHandleTimelineDeleteKey({ key: "Backspace", ctrlKey: true })).toBe(false);
  });

  it("ignores input and editable targets", () => {
    const input = { tagName: "INPUT", isContentEditable: false };
    const editable = { tagName: "DIV", isContentEditable: true };

    expect(shouldHandleTimelineDeleteKey({ key: "Delete", target: input })).toBe(false);
    expect(shouldHandleTimelineDeleteKey({ key: "Delete", target: editable })).toBe(false);
  });
});

describe("getDefaultDroppedTrack", () => {
  it("defaults to track 0 when there are no rows yet", () => {
    expect(getDefaultDroppedTrack([])).toBe(0);
  });

  it("creates a new bottom track when dropped below existing rows", () => {
    expect(getDefaultDroppedTrack([0, 1, 5], 10)).toBe(6);
  });
});

describe("resolveTimelineAssetDrop", () => {
  it("maps drop coordinates to a start time and visible track", () => {
    expect(
      resolveTimelineAssetDrop(
        {
          rectLeft: 100,
          rectTop: 200,
          scrollLeft: 0,
          scrollTop: 0,
          pixelsPerSecond: 100,
          duration: 10,
          trackHeight: 72,
          trackOrder: [0, 3, 7],
        },
        432,
        // clientY updated for TRACKS_TOP_PAD=72: rectTop(200) + RULER_H(24) +
        // TRACKS_TOP_PAD(72) + TRACK_H(48) + TRACK_H/2(24) = 368 → row 1 → track 3.
        368,
      ),
    ).toEqual({ start: 3, track: 3 });
  });

  it("can create a new bottom track when dropped below the last visible row", () => {
    expect(
      resolveTimelineAssetDrop(
        {
          rectLeft: 100,
          rectTop: 200,
          scrollLeft: 0,
          scrollTop: 0,
          pixelsPerSecond: 100,
          duration: 10,
          trackHeight: 72,
          trackOrder: [0, 3, 7],
        },
        250,
        600,
      ),
    ).toEqual({ start: 1.18, track: 8 });
  });
});

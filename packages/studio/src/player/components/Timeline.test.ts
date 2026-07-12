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
import { RULER_H, TRACK_H } from "./timelineLayout";
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
  it("formats 0 seconds as 0:00", () => {
    expect(formatTime(0)).toBe("0:00");
  });

  // fallow-ignore-next-line code-duplication
  it("formats seconds below a minute", () => {
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(30)).toBe("0:30");
    expect(formatTime(59)).toBe("0:59");
  });

  it("formats exactly one minute", () => {
    expect(formatTime(60)).toBe("1:00");
  });

  it("formats minutes and seconds", () => {
    expect(formatTime(90)).toBe("1:30");
    expect(formatTime(125)).toBe("2:05");
  });

  it("floors fractional seconds", () => {
    expect(formatTime(5.7)).toBe("0:05");
    expect(formatTime(59.9)).toBe("0:59");
    expect(formatTime(90.5)).toBe("1:30");
  });

  it("handles large values", () => {
    expect(formatTime(600)).toBe("10:00");
    expect(formatTime(3661)).toBe("61:01");
  });

  it("zero-pads seconds to two digits", () => {
    expect(formatTime(1)).toBe("0:01");
    expect(formatTime(9)).toBe("0:09");
    expect(formatTime(61)).toBe("1:01");
  });
});

describe("formatTimelineTickLabel", () => {
  it("uses minute-second labels for normal timeline intervals", () => {
    expect(formatTimelineTickLabel(90, 180, 5)).toBe("1:30");
  });

  it("uses hour labels for long timelines", () => {
    expect(formatTimelineTickLabel(3661, 4000, 60)).toBe("1:01:01");
  });

  it("shows subsecond labels when the major ruler interval is below one second", () => {
    expect(formatTimelineTickLabel(1.5, 3, 0.5)).toBe("0:01.5");
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
        310,
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

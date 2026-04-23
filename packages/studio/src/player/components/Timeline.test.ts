import { describe, it, expect } from "vitest";
import {
  generateTicks,
  getDefaultDroppedTrack,
  getTimelineCanvasHeight,
  resolveTimelineAssetDrop,
  getTimelinePlayheadLeft,
  getTimelineScrollLeftForZoomTransition,
  shouldHandleTimelineDeleteKey,
  shouldAutoScrollTimeline,
} from "./Timeline";
import { formatTime } from "../lib/time";

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
});

describe("formatTime", () => {
  it("formats 0 seconds as 0:00", () => {
    expect(formatTime(0)).toBe("0:00");
  });

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

  it("preserves the current scroll offset for other zoom transitions", () => {
    expect(getTimelineScrollLeftForZoomTransition("fit", "fit", 480)).toBe(480);
    expect(getTimelineScrollLeftForZoomTransition("fit", "manual", 480)).toBe(480);
    expect(getTimelineScrollLeftForZoomTransition("manual", "manual", 480)).toBe(480);
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
    expect(getTimelineCanvasHeight(3)).toBeGreaterThan(24 + 3 * 72);
  });

  it("still keeps ruler space when there are no tracks", () => {
    expect(getTimelineCanvasHeight(0)).toBeGreaterThan(24);
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

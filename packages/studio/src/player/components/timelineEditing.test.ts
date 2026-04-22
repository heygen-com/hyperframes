import { describe, expect, it } from "vitest";
import {
  buildTrackZIndexMap,
  buildPromptCopyText,
  buildTimelineAgentPrompt,
  resolveTimelineAutoScroll,
  resolveTimelineMove,
  resolveTimelineResize,
  type TimelinePromptElement,
} from "./timelineEditing";

describe("resolveTimelineMove", () => {
  it("moves timing based on horizontal drag and snaps to centiseconds", () => {
    expect(
      resolveTimelineMove(
        {
          start: 1.25,
          track: 2,
          duration: 2,
          originClientX: 100,
          originClientY: 200,
          pixelsPerSecond: 100,
          trackHeight: 72,
          maxStart: 8,
          trackOrder: [0, 1, 2, 3, 4],
        },
        245,
        200,
      ),
    ).toEqual({ start: 2.7, track: 2 });
  });

  it("moves layers based on vertical drag and clamps to the allowed range", () => {
    expect(
      resolveTimelineMove(
        {
          start: 2,
          track: 1,
          duration: 3,
          originClientX: 200,
          originClientY: 200,
          pixelsPerSecond: 100,
          trackHeight: 72,
          maxStart: 10,
          trackOrder: [0, 1, 5, 9],
        },
        150,
        390,
      ),
    ).toEqual({ start: 1.5, track: 9 });
  });

  it("prevents moving before zero or past the last valid start", () => {
    expect(
      resolveTimelineMove(
        {
          start: 0.2,
          track: 0,
          duration: 4,
          originClientX: 300,
          originClientY: 200,
          pixelsPerSecond: 100,
          trackHeight: 72,
          maxStart: 6,
          trackOrder: [0, 10, 20],
        },
        -100,
        -200,
      ),
    ).toEqual({ start: 0, track: -1 });

    expect(
      resolveTimelineMove(
        {
          start: 5.8,
          track: 10,
          duration: 4,
          originClientX: 300,
          originClientY: 200,
          pixelsPerSecond: 100,
          trackHeight: 72,
          maxStart: 6,
          trackOrder: [0, 10, 20],
        },
        500,
        200,
      ),
    ).toEqual({ start: 6, track: 10 });
  });

  it("creates a new top track when dragged past the first row threshold", () => {
    expect(
      resolveTimelineMove(
        {
          start: 1,
          track: 0,
          duration: 2,
          originClientX: 100,
          originClientY: 200,
          pixelsPerSecond: 100,
          trackHeight: 72,
          maxStart: 8,
          trackOrder: [0, 10, 20],
        },
        100,
        150,
      ),
    ).toEqual({ start: 1, track: -1 });
  });

  it("creates a new bottom track when dragged past the last row threshold", () => {
    expect(
      resolveTimelineMove(
        {
          start: 1,
          track: 20,
          duration: 2,
          originClientX: 100,
          originClientY: 200,
          pixelsPerSecond: 100,
          trackHeight: 72,
          maxStart: 8,
          trackOrder: [0, 10, 20],
        },
        100,
        250,
      ),
    ).toEqual({ start: 1, track: 21 });
  });

  it("accounts for scroll displacement while dragging", () => {
    expect(
      resolveTimelineMove(
        {
          start: 1,
          track: 0,
          duration: 2,
          originClientX: 100,
          originClientY: 200,
          originScrollLeft: 0,
          originScrollTop: 0,
          currentScrollLeft: 100,
          currentScrollTop: 144,
          pixelsPerSecond: 100,
          trackHeight: 72,
          maxStart: 8,
          trackOrder: [0, 1, 2, 3],
        },
        100,
        200,
      ),
    ).toEqual({ start: 2, track: 2 });
  });
});

describe("buildTrackZIndexMap", () => {
  it("maps sorted tracks onto stable positive z-index values", () => {
    expect(buildTrackZIndexMap([-2, -1, 0, 3])).toEqual(
      new Map([
        [-2, 1],
        [-1, 2],
        [0, 3],
        [3, 4],
      ]),
    );
  });

  it("deduplicates tracks before assigning z-index values", () => {
    expect(buildTrackZIndexMap([-1, 0, -1, 3, 3])).toEqual(
      new Map([
        [-1, 1],
        [0, 2],
        [3, 3],
      ]),
    );
  });
});

describe("resolveTimelineAutoScroll", () => {
  it("does not scroll when the pointer stays away from the edges", () => {
    expect(
      resolveTimelineAutoScroll(
        {
          left: 100,
          top: 100,
          right: 500,
          bottom: 400,
        },
        300,
        250,
      ),
    ).toEqual({ x: 0, y: 0 });
  });

  it("scrolls upward and leftward near the top-left edge", () => {
    expect(
      resolveTimelineAutoScroll(
        {
          left: 100,
          top: 100,
          right: 500,
          bottom: 400,
        },
        110,
        120,
      ),
    ).toEqual({ x: -9, y: -6 });
  });

  it("scrolls downward and rightward near the bottom-right edge", () => {
    expect(
      resolveTimelineAutoScroll(
        {
          left: 100,
          top: 100,
          right: 500,
          bottom: 400,
        },
        490,
        380,
      ),
    ).toEqual({ x: 9, y: 6 });
  });
});

describe("buildTimelineAgentPrompt", () => {
  it("includes the selected range, elements, and user request", () => {
    const elements: TimelinePromptElement[] = [
      { id: "title", tag: "div", start: 1, duration: 3, track: 0 },
      { id: "music", tag: "audio", start: 0, duration: 8, track: 2 },
    ];

    const text = buildTimelineAgentPrompt({
      rangeStart: 1,
      rangeEnd: 4,
      elements,
      prompt: "Move the title later and lower the music",
    });

    expect(text).toContain("Time range: 0:01 — 0:04");
    expect(text).toContain("#title (div)");
    expect(text).toContain("#music (audio)");
    expect(text).toContain("Move the title later and lower the music");
  });
});

describe("resolveTimelineResize", () => {
  it("shrinks clip duration from the right edge", () => {
    expect(
      resolveTimelineResize(
        {
          start: 1,
          duration: 3,
          originClientX: 100,
          pixelsPerSecond: 100,
          minStart: 0,
          maxEnd: 10,
        },
        "end",
        40,
      ),
    ).toEqual({ start: 1, duration: 2.4, playbackStart: undefined });
  });

  it("trims media from the left edge by advancing playback start and clip start", () => {
    expect(
      resolveTimelineResize(
        {
          start: 1,
          duration: 3,
          originClientX: 100,
          pixelsPerSecond: 100,
          minStart: 0,
          maxEnd: 10,
          playbackStart: 0.5,
          playbackRate: 1,
        },
        "start",
        150,
      ),
    ).toEqual({ start: 1.5, duration: 2.5, playbackStart: 1 });
  });

  it("prevents extending media left past available source before media-start", () => {
    expect(
      resolveTimelineResize(
        {
          start: 1,
          duration: 3,
          originClientX: 100,
          pixelsPerSecond: 100,
          minStart: 0,
          maxEnd: 10,
          playbackStart: 0.2,
          playbackRate: 1,
        },
        "start",
        0,
      ),
    ).toEqual({ start: 0.8, duration: 3.2, playbackStart: 0 });
  });
});

describe("buildPromptCopyText", () => {
  it("returns a trimmed prompt for the copy-prompt action", () => {
    expect(buildPromptCopyText("  Tighten the headline timing  ")).toBe(
      "Tighten the headline timing",
    );
  });
});

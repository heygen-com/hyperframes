import { describe, expect, it } from "vitest";
import {
  buildClipRangeSelection,
  buildPromptCopyText,
  buildTimelineElementAgentPrompt,
  buildTimelineAgentPrompt,
  clampTimelineGroupResizeDelta,
  getTimelineEditCapabilities,
  hasPatchableTimelineTarget,
  resolveBlockedTimelineEditIntent,
  resolveTimelineAutoScroll,
  resolveTimelineMove,
  resolveTimelineResize,
  resolveTimelineGroupMove,
  resolveTimelineGroupResize,
  snapKeyframePctToBeat,
  type TimelinePromptElement,
} from "./timelineEditing";
import { buildStackingTimelineLayers } from "./timelineTrackOrder";

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

  it("snaps conflicting vertical stacking movement to a new lane without changing data-track-index", () => {
    const stackingElements = [
      {
        id: "root-front",
        tag: "div",
        start: 0,
        duration: 2,
        track: 0,
        zIndex: 2,
        hasExplicitZIndex: true,
        stackingContextId: "root",
        parentCompositionId: null,
        compositionAncestors: ["root"],
      },
      {
        id: "root-back",
        tag: "div",
        start: 0,
        duration: 2,
        track: 1,
        zIndex: 1,
        hasExplicitZIndex: true,
        stackingContextId: "root",
        parentCompositionId: null,
        compositionAncestors: ["root"],
      },
    ];
    const layers = buildStackingTimelineLayers(stackingElements).rows;
    const result = resolveTimelineMove(
      {
        start: 0,
        track: 1,
        duration: 2,
        originClientX: 0,
        originClientY: 0,
        pixelsPerSecond: 100,
        trackHeight: 72,
        maxStart: 8,
        trackOrder: [0, 1],
        layerOrder: layers.map((layer) => layer.id),
        timelineLayers: layers,
        stackingElement: stackingElements[1],
        stackingElements,
      },
      0,
      -72,
    );

    expect(result).toEqual({
      start: 0,
      track: 1,
      previewLayerId: `preview:root-back:above:${layers[0]!.id}`,
      previewLayerIndex: 0,
      stackingReorder: {
        contextKey: "root",
        placement: { type: "above", layerId: layers[0]!.id },
        zIndexChanges: [{ key: "root-back", zIndex: 3 }],
      },
    });
  });
});

describe("resolveTimelineGroupMove", () => {
  it("applies an unclamped delta uniformly", () => {
    const result = resolveTimelineGroupMove(
      [
        { start: 1, duration: 2 },
        { start: 4, duration: 3 },
      ],
      1.25,
    );

    expect(result).toEqual({
      delta: 1.25,
      members: [
        { start: 2.25, duration: 2 },
        { start: 5.25, duration: 3 },
      ],
    });
  });

  it("clamps the whole group when the earliest start reaches zero", () => {
    const result = resolveTimelineGroupMove(
      [
        { start: 1, duration: 2 },
        { start: 5, duration: 3 },
      ],
      -3,
    );

    expect(result).toEqual({
      delta: -1,
      members: [
        { start: 0, duration: 2 },
        { start: 4, duration: 3 },
      ],
    });
    expect(result.members[1]!.start - result.members[0]!.start).toBe(4);
  });
});

describe("resolveTimelineGroupResize", () => {
  it("returns the shared clamped delta without applying per-member starts", () => {
    expect(
      clampTimelineGroupResizeDelta(
        1,
        [
          { start: 1, duration: 0.5 },
          { start: 4, duration: 2 },
        ],
        "start",
      ),
    ).toBe(0.4);
  });

  it("applies an unclamped start-edge delta uniformly", () => {
    const result = resolveTimelineGroupResize(
      [
        { start: 1, duration: 3 },
        { start: 5, duration: 4 },
      ],
      "start",
      1,
    );

    expect(result).toEqual({
      delta: 1,
      members: [
        { start: 2, duration: 2, playbackStart: undefined },
        { start: 6, duration: 3, playbackStart: undefined },
      ],
    });
    expect(result.members[1]!.start - result.members[0]!.start).toBe(4);
  });

  it("clamps a start-edge delta when the earliest member reaches zero", () => {
    const result = resolveTimelineGroupResize(
      [
        { start: 0.5, duration: 3 },
        { start: 4, duration: 4 },
      ],
      "start",
      -2,
    );

    expect(result).toEqual({
      delta: -0.5,
      members: [
        { start: 0, duration: 3.5, playbackStart: undefined },
        { start: 3.5, duration: 4.5, playbackStart: undefined },
      ],
    });
    expect(result.members[1]!.start - result.members[0]!.start).toBe(3.5);
  });

  it("clamps a start-edge delta when any member reaches minimum duration", () => {
    const result = resolveTimelineGroupResize(
      [
        { start: 1, duration: 0.5 },
        { start: 4, duration: 2 },
      ],
      "start",
      1,
    );

    expect(result).toEqual({
      delta: 0.4,
      members: [
        { start: 1.4, duration: 0.1, playbackStart: undefined },
        { start: 4.4, duration: 1.6, playbackStart: undefined },
      ],
    });
    expect(result.members[1]!.start - result.members[0]!.start).toBeCloseTo(3);
  });

  it("clamps an end-edge delta when any member reaches minimum duration", () => {
    const result = resolveTimelineGroupResize(
      [
        { start: 1, duration: 0.5 },
        { start: 4, duration: 2 },
      ],
      "end",
      -1,
    );

    expect(result).toEqual({
      delta: -0.4,
      members: [
        { start: 1, duration: 0.1, playbackStart: undefined },
        { start: 4, duration: 1.6, playbackStart: undefined },
      ],
    });
    expect(result.members[1]!.start - result.members[0]!.start).toBe(3);
  });

  it("adjusts each start-edge playback start using the shared delta", () => {
    const result = resolveTimelineGroupResize(
      [
        { start: 2, duration: 3, playbackStart: 1, playbackRate: 1 },
        { start: 5, duration: 4, playbackStart: 2, playbackRate: 2 },
      ],
      "start",
      0.5,
    );

    expect(result).toEqual({
      delta: 0.5,
      members: [
        { start: 2.5, duration: 2.5, playbackStart: 1.5 },
        { start: 5.5, duration: 3.5, playbackStart: 3 },
      ],
    });
  });
});

describe("hasPatchableTimelineTarget", () => {
  it("returns true when the clip has a DOM id", () => {
    expect(hasPatchableTimelineTarget({ domId: "hero-card" })).toBe(true);
  });

  it("returns true when the clip has a selector", () => {
    expect(hasPatchableTimelineTarget({ selector: ".hero-card" })).toBe(true);
  });

  it("returns false when the clip has no stable patch target", () => {
    expect(hasPatchableTimelineTarget({})).toBe(false);
  });
});

describe("getTimelineEditCapabilities", () => {
  it("does not disable editable audio just because it spans multiple scenes", () => {
    expect(
      getTimelineEditCapabilities({
        tag: "audio",
        duration: 8,
        selector: "#voiceover",
        sourceDuration: 8,
      }),
    ).toEqual({
      canMove: true,
      canTrimStart: true,
      canTrimEnd: true,
    });
  });

  it("allows full editing of generic motion clips with authored timing", () => {
    expect(
      getTimelineEditCapabilities({
        tag: "section",
        duration: 2,
        selector: ".feature-card",
      }),
    ).toEqual({
      canMove: true,
      canTrimStart: true,
      canTrimEnd: true,
    });
  });

  it("keeps implicit layout layers selectable but not timeline-editable", () => {
    expect(
      getTimelineEditCapabilities({
        duration: 8,
        selector: ".scene-shell",
        tag: "div",
        timingSource: "implicit",
      }),
    ).toEqual({
      canMove: false,
      canTrimStart: false,
      canTrimEnd: false,
    });
  });

  it("allows move and both trims for patchable media clips with offset support", () => {
    expect(
      getTimelineEditCapabilities({
        tag: "video",
        duration: 2,
        selector: "#media-card",
        playbackStartAttr: "media-start",
        sourceDuration: 10,
      }),
    ).toEqual({
      canMove: true,
      canTrimStart: true,
      canTrimEnd: true,
    });
  });

  it("treats wrapped media clips with media metadata as deterministic", () => {
    expect(
      getTimelineEditCapabilities({
        tag: "div",
        duration: 2,
        selector: "#media-card",
        playbackStartAttr: "media-start",
        sourceDuration: 10,
      }),
    ).toEqual({
      canMove: true,
      canTrimStart: true,
      canTrimEnd: true,
    });
  });

  it("allows full editing for patchable composition hosts", () => {
    expect(
      getTimelineEditCapabilities({
        tag: "div",
        duration: 3,
        selector: '[data-composition-id="intro"]',
        compositionSrc: "compositions/intro.html",
      }),
    ).toEqual({
      canMove: true,
      canTrimStart: true,
      canTrimEnd: true,
    });
  });

  it("locks all timeline edits for clips with data-timeline-locked", () => {
    expect(
      getTimelineEditCapabilities({
        tag: "div",
        duration: 8,
        selector: '[data-composition-id="caption-highlight"]',
        compositionSrc: "compositions/components/caption-highlight.html",
        timelineLocked: true,
      }),
    ).toEqual({
      canMove: false,
      canTrimStart: false,
      canTrimEnd: false,
    });
  });

  it("allows full editing of explicitly authored generic elements", () => {
    expect(
      getTimelineEditCapabilities({
        tag: "div",
        duration: 4,
        selector: "#hero-card",
        timingSource: "authored",
      }),
    ).toEqual({
      canMove: true,
      canTrimStart: true,
      canTrimEnd: true,
    });
  });

  it("disables all timeline edits for clips without a patchable target", () => {
    expect(
      getTimelineEditCapabilities({
        tag: "video",
        duration: 2,
        sourceDuration: 10,
      }),
    ).toEqual({
      canMove: false,
      canTrimStart: false,
      canTrimEnd: false,
    });
  });
});

describe("resolveBlockedTimelineEditIntent", () => {
  it("returns move when the clip body is blocked", () => {
    expect(
      resolveBlockedTimelineEditIntent({
        width: 160,
        offsetX: 80,
        handleWidth: 18,
        capabilities: {
          canMove: false,
          canTrimStart: false,
          canTrimEnd: false,
        },
      }),
    ).toBe("move");
  });

  it("returns resize-start when the left edge is blocked", () => {
    expect(
      resolveBlockedTimelineEditIntent({
        width: 160,
        offsetX: 8,
        handleWidth: 18,
        capabilities: {
          canMove: false,
          canTrimStart: false,
          canTrimEnd: true,
        },
      }),
    ).toBe("resize-start");
  });

  it("returns resize-end when the right edge is blocked", () => {
    expect(
      resolveBlockedTimelineEditIntent({
        width: 160,
        offsetX: 154,
        handleWidth: 18,
        capabilities: {
          canMove: false,
          canTrimStart: true,
          canTrimEnd: false,
        },
      }),
    ).toBe("resize-end");
  });

  it("does not block the left edge when the clip can still be moved", () => {
    expect(
      resolveBlockedTimelineEditIntent({
        width: 160,
        offsetX: 8,
        handleWidth: 18,
        capabilities: {
          canMove: true,
          canTrimStart: false,
          canTrimEnd: true,
        },
      }),
    ).toBe(null);
  });

  it("does not swallow the full surface of a narrow movable clip", () => {
    expect(
      resolveBlockedTimelineEditIntent({
        width: 12,
        offsetX: 6,
        handleWidth: 18,
        capabilities: {
          canMove: true,
          canTrimStart: false,
          canTrimEnd: false,
        },
      }),
    ).toBe(null);
  });

  it("returns null when the relevant edit is supported", () => {
    expect(
      resolveBlockedTimelineEditIntent({
        width: 160,
        offsetX: 8,
        handleWidth: 18,
        capabilities: {
          canMove: true,
          canTrimStart: true,
          canTrimEnd: true,
        },
      }),
    ).toBe(null);
  });
});

describe("buildClipRangeSelection", () => {
  it("anchors the full clip range at the click position", () => {
    expect(
      buildClipRangeSelection({ start: 1.25, duration: 3.5 }, { anchorX: 320, anchorY: 180 }),
    ).toEqual({
      start: 1.25,
      end: 4.75,
      anchorX: 320,
      anchorY: 180,
    });
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

    expect(text).toContain("Time range: 00:01 - 00:04");
    expect(text).toContain("#title (div)");
    expect(text).toContain("#music (audio)");
    expect(text).toContain("Move the title later and lower the music");
  });
});

describe("buildTimelineElementAgentPrompt", () => {
  it("includes the clip context and guidance for agent-based edits", () => {
    expect(
      buildTimelineElementAgentPrompt({
        id: "feature-card",
        tag: "section",
        start: 1.4,
        duration: 1.6,
        track: 1,
        sourceFile: "index.html",
        selector: "#feature-card",
      }),
    ).toContain("If this clip is animated with GSAP");
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

  it("can seed front trim from an implicit zero playback start", () => {
    expect(
      resolveTimelineResize(
        {
          start: 0,
          duration: 8,
          originClientX: 100,
          pixelsPerSecond: 100,
          minStart: 0,
          maxEnd: 8,
          playbackStart: 0,
          playbackRate: 1,
        },
        "start",
        200,
      ),
    ).toEqual({ start: 1, duration: 7, playbackStart: 1 });
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

  it("trims generic element start without media offset", () => {
    expect(
      resolveTimelineResize(
        {
          start: 2,
          duration: 4,
          originClientX: 100,
          pixelsPerSecond: 100,
          minStart: 0,
          maxEnd: 10,
        },
        "start",
        200,
      ),
    ).toEqual({ start: 3, duration: 3, playbackStart: undefined });
  });

  it("extends generic element start leftward to time zero", () => {
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
        "start",
        -200,
      ),
    ).toEqual({ start: 0, duration: 4, playbackStart: undefined });
  });
});

describe("buildPromptCopyText", () => {
  it("returns a trimmed prompt for the copy-prompt action", () => {
    expect(buildPromptCopyText("  Tighten the headline timing  ")).toBe(
      "Tighten the headline timing",
    );
  });
});

describe("snapKeyframePctToBeat", () => {
  // el spans 0–10s, so clip-% maps to composition time as pct * 0.1s.
  // At pps=100 the snap window is 8 / 100 = 0.08s.
  const el = { start: 0, duration: 10 };
  const beats = [2, 5, 8];

  it("snaps a keyframe within ~8px of a beat exactly onto it", () => {
    // pct 50.5 → 5.05s, 0.05s from the beat at 5s (inside 0.08s window) → 50%.
    expect(snapKeyframePctToBeat(el, 50.5, beats, 100)).toBe(50);
  });

  it("leaves a keyframe unchanged when no beat is within the window", () => {
    // pct 55 → 5.5s, 0.5s from the nearest beat → free.
    expect(snapKeyframePctToBeat(el, 55, beats, 100)).toBe(55);
  });

  it("is a no-op when there are no beats", () => {
    expect(snapKeyframePctToBeat(el, 50.5, [], 100)).toBe(50.5);
    expect(snapKeyframePctToBeat(el, 50.5, undefined, 100)).toBe(50.5);
  });

  it("is a no-op for a zero-duration clip", () => {
    expect(snapKeyframePctToBeat({ start: 0, duration: 0 }, 50.5, beats, 100)).toBe(50.5);
  });

  it("widens the snap window as zoom (pps) decreases", () => {
    // pct 53 → 5.3s, 0.3s from the beat at 5s. At pps=20 the window is 0.4s → snaps to 50%.
    expect(snapKeyframePctToBeat(el, 53, beats, 20)).toBe(50);
  });
});

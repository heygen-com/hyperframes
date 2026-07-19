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
  getTimelineVisibleTimeRange,
  getTimelineScrollTopForGeometryChange,
} from "./Timeline";
import {
  CLIP_Y,
  FIT_ZOOM_HEADROOM,
  GUTTER,
  LABEL_COL_W,
  LANE_H,
  MIN_TIMELINE_EXTENT_S,
  PLAYHEAD_HEAD_W,
  RULER_H,
  TRACK_H,
  TRACKS_LEFT_PAD,
  getTimelineDisplayContentWidth,
  getTimelineFitPps,
  getTimelineLaneTop,
  createTimelineRowGeometry,
} from "./timelineLayout";
import { formatTime } from "../lib/time";
import { usePlayerStore } from "../store/playerStore";
import { TimelineEditProvider } from "../../contexts/TimelineEditContext";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
});

describe("timeline viewport geometry", () => {
  it("derives a clamped visible time range from the raw viewport", () => {
    expect(
      getTimelineVisibleTimeRange({ scrollLeft: 300, clientWidth: 500 }, 100, 200, 20),
    ).toEqual({ start: 1, end: 6 });
    expect(getTimelineVisibleTimeRange({ scrollLeft: 0, clientWidth: 100 }, 100, 200, 20)).toEqual({
      start: 0,
      end: 0,
    });
  });

  it("keeps the same row anchored when a row above it expands", () => {
    const previous = createTimelineRowGeometry([1, 2, 3], [48, 48, 48]);
    const next = createTimelineRowGeometry([1, 2, 3], [104, 48, 48]);
    const scrollTop = previous.getRowTop(2) - RULER_H + 6;
    expect(getTimelineScrollTopForGeometryChange(previous, next, scrollTop)).toBe(scrollTop + 56);
  });
});

function getHorizontalGeometry(host: HTMLElement, clipId: string, tickLabel: string) {
  const clip = host.querySelector<HTMLElement>(`[data-el-id="${clipId}"]`);
  if (!clip) throw new Error(`Missing timeline clip ${clipId}`);
  const trackContent = clip.parentElement;
  if (!trackContent) throw new Error(`Missing content row for ${clipId}`);
  const trackHeader = trackContent.previousElementSibling;
  if (!(trackHeader instanceof HTMLElement)) throw new Error(`Missing track header for ${clipId}`);
  const rulerTickLabel = Array.from(host.querySelectorAll("span")).find(
    (node) => node.textContent === tickLabel,
  );
  const rulerTick = rulerTickLabel?.parentElement;
  if (!rulerTick) throw new Error(`Missing ruler tick ${tickLabel}`);
  const ruler = rulerTick.parentElement;
  if (!ruler) throw new Error("Missing timeline ruler");
  const rulerOrigin = ruler.previousElementSibling;
  if (!(rulerOrigin instanceof HTMLElement)) throw new Error("Missing timeline ruler origin");
  const playhead = Array.from(host.querySelectorAll<HTMLElement>("div")).find(
    (node) => node.style.zIndex === "100",
  );
  if (!playhead) throw new Error("Missing timeline playhead");
  return { clip, trackHeader, rulerTick, rulerOrigin, playhead };
}

function renderTimelineGeometry(clipId: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(React.createElement(Timeline));
  });
  return { host, root, ...getHorizontalGeometry(host, clipId, "00:10") };
}

function createSizedTimelineHost(width: number): HTMLDivElement {
  const host = document.createElement("div");
  document.body.append(host);
  Object.defineProperty(host, "clientWidth", { configurable: true, value: width });
  return host;
}

function expectTrackExpansion(
  row: HTMLElement | null | undefined,
  expandedClipIds: string[],
  height: number,
) {
  expect(usePlayerStore.getState().expandedClipIds).toEqual(new Set(expandedClipIds));
  expect(row?.style.height).toBe(`${height}px`);
}

function renderBasicTimeline() {
  const host = createSizedTimelineHost(640);
  usePlayerStore.setState({
    duration: 4,
    timelineReady: true,
    elements: [{ id: "clip-1", tag: "div", start: 0, duration: 2, track: 0 }],
  });
  const root = createRoot(host);
  act(() => {
    root.render(React.createElement(Timeline));
  });
  return { host, root };
}

describe("Timeline provider boundary", () => {
  it("keeps all-collapsed horizontal positions at the 32px gutter", () => {
    usePlayerStore.setState({
      duration: 11,
      timelineReady: true,
      currentTime: 10,
      zoomMode: "manual",
      manualZoomPercent: 100,
      elements: [{ id: "clip-1", tag: "div", start: 10, duration: 1, track: 0 }],
    });

    const { root, clip, trackHeader, rulerTick, rulerOrigin, playhead } =
      renderTimelineGeometry("clip-1");

    expect(trackHeader.style.width).toBe("32px");
    expect(clip.style.left).toBe("1000px");
    expect(clip.style.height).toBe("");
    expect(clip.style.bottom).toBe(`${CLIP_Y}px`);
    expect(rulerOrigin.style.width).toBe("32px");
    expect(rulerTick.style.left).toBe("999.5px");
    expect(playhead.style.left).toBe(`${1032 - PLAYHEAD_HEAD_W / 2}px`);
    expect(playhead.style.width).toBe(`${PLAYHEAD_HEAD_W}px`);
    expect(
      resolveTimelineAssetDrop(
        {
          rectLeft: 100,
          rectTop: 0,
          scrollLeft: 0,
          scrollTop: 0,
          contentOrigin: GUTTER,
          pixelsPerSecond: 100,
          duration: 60,
          trackOrder: [0],
        },
        1132,
        100,
      ).start,
    ).toBe(10);
    expect(getTimelineFitPps(640, 11, GUTTER)).toBe(10.1);

    act(() => root.unmount());
  });

  it("reserves the label column and keeps expanded keyframes aligned with ruler time", () => {
    usePlayerStore.setState({
      duration: 20,
      timelineReady: true,
      currentTime: 10,
      zoomMode: "manual",
      manualZoomPercent: 100,
      selectedElementId: "clip-1",
      expandedClipIds: new Set(["clip-1"]),
      elements: [
        { id: "clip-1", label: "Hero card", tag: "div", start: 0, duration: 20, track: 0 },
        { id: "clip-2", label: "Outro", tag: "div", start: 2, duration: 1, track: 1 },
      ],
      gsapAnimations: new Map([
        [
          "clip-1",
          [
            {
              id: "position-tween",
              targetSelector: "#clip-1",
              method: "to",
              position: 0,
              duration: 20,
              properties: {},
              propertyGroup: "position",
              keyframes: {
                format: "percentage",
                keyframes: [{ percentage: 50, properties: { x: 100 } }],
              },
            },
          ],
        ],
      ]),
    });

    const { host, root, clip, trackHeader, rulerTick, rulerOrigin, playhead } =
      renderTimelineGeometry("clip-1");
    const { trackHeader: collapsedHeader } = getHorizontalGeometry(host, "clip-2", "00:10");
    const diamond = host.querySelector<HTMLElement>(
      '[data-keyframe-group="position"][data-keyframe-percentage="50"]',
    );
    if (!diamond) throw new Error("Missing expanded position keyframe");
    const propertyLane = diamond.closest<HTMLElement>("[data-timeline-property-lane]");
    if (!propertyLane) throw new Error("Missing flat position property lane");
    const headerLane = trackHeader.querySelector<HTMLElement>('[data-property-group="position"]');
    if (!headerLane) throw new Error("Missing position property header");
    // Absolute x rebuilds from the content origin (the ruler-origin spacer),
    // which now insets a GUTTER past the LABEL_COL_W label column so a 0%
    // diamond has room to its left. The content row reaches that same origin via
    // header (LABEL_COL_W) + its gutter margin, so ruler tick and diamond still
    // coincide on the shared time x.
    const contentOrigin = Number.parseFloat(rulerOrigin.style.width);
    const rulerX = contentOrigin + Number.parseFloat(rulerTick.style.left) + 0.5;
    const diamondX =
      contentOrigin +
      Number.parseFloat(propertyLane.style.left) +
      Number.parseFloat(diamond.style.left) +
      Number.parseFloat(diamond.style.width) / 2;

    expect(clip.contains(propertyLane)).toBe(false);
    expect(clip.style.height).toBe(`${TRACK_H - 2 * CLIP_Y}px`);
    expect(clip.style.bottom).toBe("");
    expect(propertyLane.style.top).toBe(`${getTimelineLaneTop(0)}px`);
    expect(propertyLane.style.top).toBe(headerLane.style.top);
    expect(propertyLane.style.background).toBe("");
    expect(propertyLane.style.border).toBe("");
    expect(propertyLane.style.borderRadius).toBe("");
    const treegrid = host.querySelector<HTMLElement>('[role="treegrid"]');
    const semanticRows = treegrid?.querySelectorAll<HTMLElement>('[role="row"]') ?? [];
    expect(treegrid?.getAttribute("aria-rowcount")).toBe("3");
    expect([...semanticRows].map((row) => row.getAttribute("aria-rowindex"))).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(semanticRows[0]?.getAttribute("aria-level")).toBe("1");
    expect(semanticRows[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(semanticRows[1]?.getAttribute("aria-level")).toBe("2");
    expect(semanticRows[1]?.textContent).toContain("position");
    expect(semanticRows[1]?.querySelector('[role="rowheader"]')?.getAttribute("aria-owns")).toBe(
      headerLane.id,
    );
    expect(semanticRows[1]?.querySelector('[role="gridcell"]')?.getAttribute("aria-owns")).toBe(
      propertyLane.id,
    );
    expect(semanticRows[2]?.hasAttribute("aria-expanded")).toBe(false);
    expect(trackHeader.style.width).toBe(`${LABEL_COL_W}px`);
    expect(rulerOrigin.style.width).toBe(`${LABEL_COL_W + GUTTER}px`);
    expect(playhead.style.left).toBe(`${LABEL_COL_W + GUTTER + 1000 - PLAYHEAD_HEAD_W / 2}px`);
    expect(diamondX).toBe(rulerX);
    expect(rulerX).toBe(LABEL_COL_W + GUTTER + 1000);
    expect(collapsedHeader.textContent).toContain("Outro");
    expect(getTimelineFitPps(640, 20, LABEL_COL_W + GUTTER)).toBeCloseTo(
      (640 - (LABEL_COL_W + GUTTER) - 2) / MIN_TIMELINE_EXTENT_S,
    );
    expect(
      resolveTimelineAssetDrop(
        {
          rectLeft: 100,
          rectTop: 0,
          scrollLeft: 0,
          scrollTop: 0,
          contentOrigin: LABEL_COL_W + GUTTER,
          pixelsPerSecond: 100,
          duration: 60,
          trackOrder: [0],
        },
        100 + LABEL_COL_W + GUTTER + 1000,
        100,
      ).start,
    ).toBe(10);

    act(() => root.unmount());
  });

  it("renders the public Timeline export without TimelineEditProvider", () => {
    const { root } = renderBasicTimeline();

    act(() => root.unmount());
  });

  it("renders the complete track list while row virtualization is gated off", () => {
    const host = createSizedTimelineHost(640);
    usePlayerStore.setState({
      duration: 4,
      timelineReady: true,
      elements: Array.from({ length: 12 }, (_, track) => ({
        id: `clip-${track}`,
        tag: "div",
        start: 0,
        duration: 2,
        track,
      })),
    });
    const root = createRoot(host);
    act(() => root.render(React.createElement(Timeline)));

    const treegrid = host.querySelector<HTMLElement>('[role="treegrid"]');
    const rows = treegrid?.querySelectorAll('[role="row"]') ?? [];
    expect(rows).toHaveLength(12);
    expect(treegrid?.getAttribute("aria-rowcount")).toBe("12");
    expect(rows[0]?.getAttribute("aria-rowindex")).toBe("1");
    expect(rows[11]?.getAttribute("aria-rowindex")).toBe("12");

    act(() => root.unmount());
  });

  it("renders the gutter without legacy icons or hue dots", () => {
    const { host, root } = renderBasicTimeline();

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

  it("requests persisted track visibility from the gutter without seeking", () => {
    const host = createSizedTimelineHost(640);

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
    // Row children: [TimelineTrackHeader (sticky column), time-mapped content].
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
    const host = createSizedTimelineHost(720);

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

  it("shows a disclosure only for grouped keyframes and toggles the track height", () => {
    const host = createSizedTimelineHost(720);

    usePlayerStore.setState({
      duration: 4,
      timelineReady: true,
      elements: [
        { id: "clip-1", tag: "div", start: 0, duration: 2, track: 0 },
        { id: "clip-2", tag: "div", start: 2, duration: 2, track: 1 },
      ],
      keyframeCache: new Map([
        [
          "clip-1",
          {
            format: "percentage",
            keyframes: [
              { percentage: 0, properties: { x: 0 }, propertyGroup: "position" },
              { percentage: 50, properties: { x: 100 }, propertyGroup: "position" },
              { percentage: 100, properties: { opacity: 0 }, propertyGroup: "visual" },
            ],
          },
        ],
      ]),
      gsapAnimations: new Map([
        [
          "clip-1",
          [
            {
              id: "clip-1-position",
              targetSelector: "#clip-1",
              method: "to",
              position: 0,
              duration: 2,
              properties: {},
              propertyGroup: "position",
              keyframes: {
                format: "percentage",
                keyframes: [
                  { percentage: 0, properties: { x: 0 } },
                  { percentage: 50, properties: { x: 100 } },
                ],
              },
            },
            {
              id: "clip-1-visual",
              targetSelector: "#clip-1",
              method: "to",
              position: 0,
              duration: 2,
              properties: {},
              propertyGroup: "visual",
              keyframes: {
                format: "percentage",
                keyframes: [{ percentage: 100, properties: { opacity: 0 } }],
              },
            },
          ],
        ],
      ]),
    });

    const root = createRoot(host);
    act(() => {
      root.render(React.createElement(Timeline));
    });

    // Keyframed clip-1 is expanded by default (AE/Figma default); its disclosure
    // lives in the left column. clip-2 has no keyframes so it never shows one.
    const collapseButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse clip-1 keyframes"]',
    );
    expect(collapseButton).not.toBeNull();
    expect(host.querySelector('button[aria-label="Expand clip-2 keyframes"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Collapse clip-2 keyframes"]')).toBeNull();

    const clip = host.querySelector<HTMLElement>('[data-el-id="clip-1"]');
    const row = clip?.parentElement?.parentElement;
    expectTrackExpansion(row, ["clip-1"], TRACK_H + 2 * LANE_H);

    // Collapsing sticks (does not bounce back open via auto-expand).
    act(() => collapseButton?.click());
    expectTrackExpansion(row, [], TRACK_H);

    const expandButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand clip-1 keyframes"]',
    );
    expect(expandButton).not.toBeNull();
    act(() => expandButton?.click());
    expectTrackExpansion(row, ["clip-1"], TRACK_H + 2 * LANE_H);
    act(() => root.unmount());
  });

  it("marks every clip in selectedElementIds as selected", () => {
    const host = createSizedTimelineHost(720);

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

  it("picks 'nice' NLE steps across zoom levels (no 7s-style intervals)", () => {
    // step = first nice interval whose px spacing >= 88 at that pps.
    const cases: Array<[number, number]> = [
      [2, 60], // 60s * 2pps = 120px
      [10, 10], // 10s * 10pps = 100px
      [20, 5], // 5s * 20pps = 100px
      [50, 2], // 2s * 50pps = 100px
      [100, 1], // 1s * 100pps = 100px
    ];
    for (const [pps, expected] of cases) {
      const { major } = generateTicks(600, pps);
      expect(major[1] - major[0]).toBe(expected);
    }
  });

  it("uses minute/hour steps when zoomed far out instead of colliding 10m labels", () => {
    // 0.05 pps → 600s step would be 30px apart (labels collide); 1800s = 90px.
    const { major } = generateTicks(7200, 0.05);
    expect(major[1] - major[0]).toBe(1800);
    expect(major).toContain(3600);
  });

  it("does not drift on long rulers (ticks are exact multiples of the step)", () => {
    const { major } = generateTicks(600, 100); // 1s step, 601 ticks
    expect(major[599]).toBe(599);
  });

  describe("frame display mode (frameRate provided)", () => {
    it("snaps sub-frame steps up to one whole frame (no duplicate frame labels)", () => {
      // 4400 pps would pick a 0.02s step = 0.6 frames at 30fps → snapped to 1 frame.
      const { major } = generateTicks(2, 4400, 30);
      const frames = major.map((t) => Math.round(t * 30));
      // Frame labels are consecutive integers — no duplicates, no gaps.
      frames.forEach((f, i) => expect(f).toBe(i));
    });

    it("keeps major AND minor ticks on whole frames", () => {
      // 200 pps → 0.5s step (15 frames); quarters (3.75f) are rejected in
      // frame mode in favour of fifths (3f).
      const { major, minor } = generateTicks(20, 200, 30);
      expect(major[1]).toBeCloseTo(0.5);
      expect(minor).toContain(0.1); // 3 frames
      for (const t of [...major, ...minor]) {
        const frames = t * 30;
        expect(Math.abs(frames - Math.round(frames))).toBeLessThan(1e-3);
      }
    });

    it("leaves whole-second steps unchanged", () => {
      const { major } = generateTicks(60, 100, 30);
      expect(major[1] - major[0]).toBe(1);
    });
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

describe("getTimelineFitPps (min 60s extent + fit headroom)", () => {
  const viewport = 632; // usable width = 632 - GUTTER - TRACKS_LEFT_PAD - 2

  it("computes fit pps against the 60s floor for short compositions", () => {
    // A 10s comp maps 60s onto the viewport → the comp takes ~1/6 of the width.
    // (10 * 1.2 = 12s of headroom-padded content is still under the 60s floor.)
    const pps = getTimelineFitPps(viewport, 10, GUTTER + TRACKS_LEFT_PAD);
    expect(pps).toBeCloseTo((viewport - (GUTTER + TRACKS_LEFT_PAD) - 2) / MIN_TIMELINE_EXTENT_S);
    expect(10 * pps).toBeCloseTo((viewport - (GUTTER + TRACKS_LEFT_PAD) - 2) / 6);
  });

  it("fits duration * FIT_ZOOM_HEADROOM (not the bare duration) for long compositions", () => {
    expect(getTimelineFitPps(viewport, 60, GUTTER + TRACKS_LEFT_PAD)).toBeCloseTo(
      (viewport - (GUTTER + TRACKS_LEFT_PAD) - 2) / (60 * FIT_ZOOM_HEADROOM),
    );
    expect(getTimelineFitPps(viewport, 120, GUTTER + TRACKS_LEFT_PAD)).toBeCloseTo(
      (viewport - (GUTTER + TRACKS_LEFT_PAD) - 2) / (120 * FIT_ZOOM_HEADROOM),
    );
  });

  it("subtracts the expanded keyframe label column before fitting headroom", () => {
    expect(getTimelineFitPps(viewport, 120, LABEL_COL_W)).toBeCloseTo(
      (viewport - LABEL_COL_W - 2) / (120 * FIT_ZOOM_HEADROOM),
    );
  });

  it("leaves CapCut-style trailing headroom: the comp ends at 1/1.2 of the usable width", () => {
    const usable = viewport - (GUTTER + TRACKS_LEFT_PAD) - 2;
    const pps = getTimelineFitPps(viewport, 120, GUTTER + TRACKS_LEFT_PAD);
    // Composition content occupies usable/1.2 px; the remaining ~17% is empty
    // droppable ruler/lane surface past the end.
    expect(120 * pps).toBeCloseTo(usable / FIT_ZOOM_HEADROOM);
    expect(120 * pps).toBeLessThan(usable);
  });

  it("falls back to 100 pps before the viewport is measured", () => {
    expect(getTimelineFitPps(0, 10, GUTTER)).toBe(100);
    expect(getTimelineFitPps(GUTTER, 10, GUTTER)).toBe(100);
    expect(getTimelineFitPps(Number.NaN, 10, GUTTER)).toBe(100);
  });

  it("uses the floor for zero/invalid durations", () => {
    expect(getTimelineFitPps(viewport, 0, GUTTER + TRACKS_LEFT_PAD)).toBeCloseTo(
      (viewport - (GUTTER + TRACKS_LEFT_PAD) - 2) / MIN_TIMELINE_EXTENT_S,
    );
    expect(getTimelineFitPps(viewport, Number.NaN, GUTTER + TRACKS_LEFT_PAD)).toBeCloseTo(
      (viewport - (GUTTER + TRACKS_LEFT_PAD) - 2) / MIN_TIMELINE_EXTENT_S,
    );
  });
});

describe("getTimelineDisplayContentWidth", () => {
  it("always spans at least MIN_TIMELINE_EXTENT_S seconds of content", () => {
    // 10s of content at 20 pps = 200px; the floor keeps 60s (1200px) rendered.
    expect(
      getTimelineDisplayContentWidth({
        trackContentWidth: 200,
        viewportWidth: 400,
        contentOrigin: GUTTER,
        pps: 20,
      }),
    ).toBe(MIN_TIMELINE_EXTENT_S * 20);
  });

  it("still fills the viewport when that is larger than the 60s floor", () => {
    expect(
      getTimelineDisplayContentWidth({
        trackContentWidth: 200,
        viewportWidth: 2000,
        contentOrigin: GUTTER + TRACKS_LEFT_PAD,
        pps: 5,
      }),
    ).toBe(2000 - (GUTTER + TRACKS_LEFT_PAD) - 2);
  });

  it("tracks a drag ghost past every other bound (drag-to-extend)", () => {
    expect(
      getTimelineDisplayContentWidth({
        trackContentWidth: 500,
        viewportWidth: 400,
        contentOrigin: GUTTER,
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
        contentOrigin: GUTTER,
        pps: 5,
        resizeGhostEndPx: 4200,
      }),
    ).toBe(4200);
  });

  it("keeps long content authoritative", () => {
    expect(
      getTimelineDisplayContentWidth({
        trackContentWidth: 9000,
        viewportWidth: 400,
        contentOrigin: GUTTER,
        pps: 50,
      }),
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
        contentOrigin: GUTTER,
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
        contentOrigin: GUTTER,
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
        contentOrigin: GUTTER,
        currentPixelsPerSecond: 0,
        nextPixelsPerSecond: 20,
        duration: 120,
      }),
    ).toBe(120);
  });
});

describe("getTimelinePlayheadLeft", () => {
  it("offsets the wrapper by half the head width so the line CENTER = contentOrigin + t*pps", () => {
    // Wrapper left + PLAYHEAD_HEAD_W/2 (where the 1px line is centered) must
    // equal contentOrigin + t*pps at any zoom, for both the padded default
    // origin and the plain gutter origin.
    expect(getTimelinePlayheadLeft(4, 20, GUTTER + TRACKS_LEFT_PAD) + PLAYHEAD_HEAD_W / 2).toBe(
      GUTTER + TRACKS_LEFT_PAD + 4 * 20,
    );
    expect(getTimelinePlayheadLeft(10, 7.5, GUTTER + TRACKS_LEFT_PAD) + PLAYHEAD_HEAD_W / 2).toBe(
      GUTTER + TRACKS_LEFT_PAD + 75,
    );
    expect(getTimelinePlayheadLeft(4, 20, GUTTER) + PLAYHEAD_HEAD_W / 2).toBe(GUTTER + 4 * 20);
    expect(getTimelinePlayheadLeft(10, 7.5, GUTTER) + PLAYHEAD_HEAD_W / 2).toBe(GUTTER + 75);
  });

  it("uses the expanded keyframe label column as the playhead origin", () => {
    expect(getTimelinePlayheadLeft(4, 20, LABEL_COL_W) + PLAYHEAD_HEAD_W / 2).toBe(
      LABEL_COL_W + 4 * 20,
    );
  });

  it("centers the line exactly on the left pad's end (the 00:00 tick) at t = 0", () => {
    expect(getTimelinePlayheadLeft(0, 20, GUTTER + TRACKS_LEFT_PAD) + PLAYHEAD_HEAD_W / 2).toBe(
      GUTTER + TRACKS_LEFT_PAD,
    );
  });

  it("centers the line exactly on the gutter (the 00:00 tick) at t = 0", () => {
    expect(getTimelinePlayheadLeft(0, 20, GUTTER) + PLAYHEAD_HEAD_W / 2).toBe(GUTTER);
  });

  it("guards invalid input", () => {
    expect(getTimelinePlayheadLeft(Number.NaN, 20, GUTTER + TRACKS_LEFT_PAD)).toBe(
      GUTTER + TRACKS_LEFT_PAD - PLAYHEAD_HEAD_W / 2,
    );
    expect(getTimelinePlayheadLeft(4, Number.NaN, GUTTER + TRACKS_LEFT_PAD)).toBe(
      GUTTER + TRACKS_LEFT_PAD - PLAYHEAD_HEAD_W / 2,
    );
    expect(getTimelinePlayheadLeft(Number.NaN, 20, GUTTER)).toBe(GUTTER - PLAYHEAD_HEAD_W / 2);
    expect(getTimelinePlayheadLeft(4, Number.NaN, LABEL_COL_W)).toBe(
      LABEL_COL_W - PLAYHEAD_HEAD_W / 2,
    );
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
          contentOrigin: GUTTER,
          pixelsPerSecond: 100,
          duration: 10,
          trackHeight: 72,
          trackOrder: [0, 3, 7],
        },
        432, // rectLeft(100) + GUTTER(32) + 3s*100pps  (contentOrigin = GUTTER)
        // clientY: rectTop(200) + RULER_H(24) + TRACKS_TOP_PAD(72) + TRACK_H(48)
        // + TRACK_H/2(24) = 368 → row 1 → track 3.
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
          contentOrigin: GUTTER,
          pixelsPerSecond: 100,
          duration: 10,
          trackHeight: 72,
          trackOrder: [0, 3, 7],
        },
        250, // rectLeft(100) + GUTTER(32) + 1.18s*100pps  (contentOrigin = GUTTER)
        600,
      ),
    ).toEqual({ start: 1.18, track: 8 });
  });
});

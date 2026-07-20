import { describe, it, expect } from "vitest";
import {
  RULER_H,
  TRACK_H,
  LANE_H,
  TRACKS_TOP_PAD,
  TRACKS_BOTTOM_PAD,
  GUTTER,
  getTimelineRowTop,
  getTimelineRowFromY,
  getTimelineRowOffsets,
  getTimelineCanvasHeight,
  createTimelineRowGeometry,
  getTimelineRowGeometry,
  trackHeights,
  resolveTimelineAssetDrop,
  generateTicks,
  getTimelineBeatEntries,
  getTimelineMajorTickInterval,
} from "./timelineLayout";
import { getTimelineRenderTimeRange } from "./timelineViewportGeometry";

describe("horizontal timeline window", () => {
  it("adds the shared half-viewport overscan on each side and clamps to duration", () => {
    expect(getTimelineRenderTimeRange({ scrollLeft: 300, clientWidth: 500 }, 100, 200, 20)).toEqual(
      { start: 0, end: 8.5 },
    );
    expect(
      getTimelineRenderTimeRange({ scrollLeft: 1_900, clientWidth: 500 }, 100, 200, 20),
    ).toEqual({ start: 14.5, end: 20 });
  });

  it("generates globally aligned ticks directly inside the bounded window", () => {
    const ticks = generateTicks(10_000, 100, undefined, { start: 500.2, end: 501.8 });
    const interval = getTimelineMajorTickInterval(10_000, 100);
    expect(ticks.major.every((time) => time >= 500.2 && time <= 501.8)).toBe(true);
    expect(
      ticks.major.every((time) => Math.abs(time / interval - Math.round(time / interval)) < 1e-6),
    ).toBe(true);
    expect(ticks.major.length + ticks.minor.length).toBeLessThan(100);
  });

  it("slices beat records with original strength indexes and unions a pinned beat", () => {
    expect(
      getTimelineBeatEntries(
        [0, 1, 2, 3],
        [0.1, 0.2, 0.3, 0.4],
        { start: 1, end: 3 },
        new Set([3]),
      ),
    ).toEqual([
      { index: 1, time: 1, strength: 0.2 },
      { index: 2, time: 2, strength: 0.3 },
      { index: 3, time: 3, strength: 0.4 },
    ]);
  });
});

describe("variable timeline row geometry", () => {
  const tracks = [
    [{ clipId: "a", laneCount: 0 }],
    [{ clipId: "b", laneCount: 2 }],
    [{ clipId: "c", laneCount: 1 }],
  ];

  it("resolves every row to the base height when no clip is expanded", () => {
    expect(trackHeights(tracks)).toEqual([TRACK_H, TRACK_H, TRACK_H]);
    expect(trackHeights(3)).toEqual([TRACK_H, TRACK_H, TRACK_H]);
  });

  it("adds one lane height per lane on an expanded clip", () => {
    expect(trackHeights(tracks, new Set(["b"]))).toEqual([TRACK_H, TRACK_H + 2 * LANE_H, TRACK_H]);
  });

  it("derives row tops from cumulative offsets", () => {
    const heights = trackHeights(tracks, new Set(["b"]));
    expect(getTimelineRowOffsets(heights)).toEqual([
      0,
      TRACK_H,
      2 * TRACK_H + 2 * LANE_H,
      3 * TRACK_H + 2 * LANE_H,
    ]);
    expect(getTimelineRowTop(2, heights)).toBe(RULER_H + TRACKS_TOP_PAD + 2 * TRACK_H + 2 * LANE_H);
  });

  it("maps y inside an expanded lane region back to the expanded track", () => {
    const heights = trackHeights(tracks, new Set(["b"]));
    const yInSecondExpandedLane = getTimelineRowTop(1, heights) + TRACK_H + LANE_H * 1.5;
    const row = getTimelineRowFromY(yInSecondExpandedLane, heights);
    expect(Math.floor(row)).toBe(1);
    expect(row).toBeGreaterThan(1.5);
    expect(row).toBeLessThan(2);
  });

  it("sums resolved row heights into the canvas height", () => {
    const heights = trackHeights(tracks, new Set(["b"]));
    expect(getTimelineCanvasHeight(heights)).toBe(
      RULER_H + TRACKS_TOP_PAD + 3 * TRACK_H + 2 * LANE_H + TRACKS_BOTTOM_PAD,
    );
  });

  it("reuses one immutable geometry snapshot for one height array", () => {
    const heights = trackHeights(tracks, new Set(["b"]));
    const first = getTimelineRowGeometry(heights);
    expect(getTimelineRowGeometry(heights)).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.rowOffsets)).toBe(true);
  });

  it("looks up row boundaries through the precomputed geometry", () => {
    const geometry = createTimelineRowGeometry([4, 8, 12], [48, 104, 76]);
    expect(getTimelineRowGeometry(geometry.rowHeights)).toBe(geometry);
    expect(geometry.getRowIndex(8)).toBe(1);
    expect(geometry.getRowFromY(geometry.getRowTop(1))).toBe(1);
    expect(geometry.getRowFromY(geometry.getRowTop(2) - 0.001)).toBeLessThan(2);
    expect(geometry.getRowFromY(geometry.getRowTop(2))).toBe(2);
    expect(geometry.canvasHeight).toBe(RULER_H + TRACKS_TOP_PAD + 228 + TRACKS_BOTTOM_PAD);
  });
});

describe("collapsed timeline row geometry characterization", () => {
  it.each([
    [0, 74],
    [1, 122],
    [4, 266],
  ])("keeps row %i at content y=%i", (row, expectedTop) => {
    expect(getTimelineRowTop(row)).toBe(expectedTop);
  });

  it.each([
    [74, 0],
    [86, 0.25],
    [146, 1.5],
    [290, 4.5],
  ])("maps content y=%i to fractional row %f", (contentY, expectedRow) => {
    expect(getTimelineRowFromY(contentY)).toBe(expectedRow);
  });

  it.each([
    [0, 146],
    [1, 194],
    [3, 290],
    [5, 386],
  ])("keeps the %i-track canvas height at %i", (trackCount, expectedHeight) => {
    expect(getTimelineCanvasHeight(trackCount)).toBe(expectedHeight);
  });
});

describe("track-area breathing pad y-math", () => {
  describe("getTimelineRowTop", () => {
    it("offsets the first lane below the ruler by the top pad", () => {
      expect(getTimelineRowTop(0)).toBe(RULER_H + TRACKS_TOP_PAD);
    });

    it("advances by one track height per row, keeping the pad", () => {
      expect(getTimelineRowTop(1)).toBe(RULER_H + TRACKS_TOP_PAD + TRACK_H);
      expect(getTimelineRowTop(3)).toBe(RULER_H + TRACKS_TOP_PAD + 3 * TRACK_H);
    });

    it("is a strict positive shift from the pre-pad formula (pad is non-zero)", () => {
      expect(TRACKS_TOP_PAD).toBeGreaterThan(0);
      expect(getTimelineRowTop(2)).toBe(RULER_H + 2 * TRACK_H + TRACKS_TOP_PAD);
    });
  });

  describe("getTimelineRowFromY", () => {
    it("is the exact inverse of getTimelineRowTop at lane boundaries", () => {
      for (const row of [0, 1, 2, 7]) {
        expect(getTimelineRowFromY(getTimelineRowTop(row))).toBeCloseTo(row, 10);
      }
    });

    it("floors a y inside the top pad (above lane 0) to a negative fraction", () => {
      // A drop in the pad between the ruler and lane 0 sits at row < 0, so a
      // floor lands it on row -1 → getDefaultDroppedTrack floors to the top lane.
      const yInPad = RULER_H + TRACKS_TOP_PAD / 2;
      expect(getTimelineRowFromY(yInPad)).toBeLessThan(0);
    });

    it("maps a y in the middle of lane 1 into [1,2)", () => {
      const yMidLane1 = getTimelineRowTop(1) + TRACK_H / 2;
      const row = getTimelineRowFromY(yMidLane1);
      expect(row).toBeGreaterThanOrEqual(1);
      expect(row).toBeLessThan(2);
    });
  });

  describe("getTimelineCanvasHeight", () => {
    it("reserves ruler + top pad + lanes + bottom pad", () => {
      expect(getTimelineCanvasHeight(0)).toBe(RULER_H + TRACKS_TOP_PAD + TRACKS_BOTTOM_PAD);
      expect(getTimelineCanvasHeight(3)).toBe(
        RULER_H + TRACKS_TOP_PAD + 3 * TRACK_H + TRACKS_BOTTOM_PAD,
      );
    });

    it("clamps a negative track count to zero lanes", () => {
      expect(getTimelineCanvasHeight(-4)).toBe(RULER_H + TRACKS_TOP_PAD + TRACKS_BOTTOM_PAD);
    });

    it("leaves room below the last lane for a drag-into-void new track", () => {
      // The gap below the final lane must be at least a full track height so a
      // clip can be dropped there to create a new bottom track.
      const oneLane = getTimelineCanvasHeight(1);
      const lastLaneBottom = getTimelineRowTop(0) + TRACK_H;
      expect(oneLane - lastLaneBottom).toBeGreaterThanOrEqual(TRACK_H);
    });
  });

  describe("resolveTimelineAssetDrop honours the top pad", () => {
    const base = {
      rectLeft: 0,
      rectTop: 0,
      scrollLeft: 0,
      scrollTop: 0,
      contentOrigin: GUTTER,
      pixelsPerSecond: 100,
      duration: 60,
      rowHeights: trackHeights(3),
      trackOrder: [0, 1, 2],
    };

    it("drops onto lane 0 when the pointer is in the middle of the first lane", () => {
      const clientY = getTimelineRowTop(0) + TRACK_H / 2;
      const clientX = GUTTER + 100; // t = 1s (contentOrigin = GUTTER)
      const { start, track } = resolveTimelineAssetDrop(base, clientX, clientY);
      expect(track).toBe(0);
      expect(start).toBe(1);
    });

    it("drops into the top pad → floors to the first lane (row < 0)", () => {
      const clientY = RULER_H + TRACKS_TOP_PAD / 2; // inside the pad, above lane 0
      const { track } = resolveTimelineAssetDrop(base, GUTTER, clientY);
      expect(track).toBe(0);
    });

    it("drops below the last lane → appends a new track", () => {
      const clientY = getTimelineRowTop(2) + TRACK_H + 4; // in the bottom pad
      const { track } = resolveTimelineAssetDrop(base, GUTTER, clientY);
      expect(track).toBe(3); // max(trackOrder)+1
    });

    it("keeps a drop in an expanded lane region on that track", () => {
      const rowHeights = [TRACK_H + 2 * LANE_H, TRACK_H, TRACK_H];
      const clientY = getTimelineRowTop(0, rowHeights) + TRACK_H + LANE_H;
      const { track } = resolveTimelineAssetDrop({ ...base, rowHeights }, GUTTER, clientY);
      expect(track).toBe(0);
    });
  });
});

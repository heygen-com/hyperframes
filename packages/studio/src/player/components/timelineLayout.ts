import type { ZoomMode } from "../store/playerStore";
import type { TimelineTimeRange } from "../lib/timelineClipIndex";

export {
  formatTimelineTickLabel,
  generateTicks,
  getTimelineMajorTickInterval,
} from "./timelineRulerGeometry";

/* ── Layout constants ──────────────────────────────────────────────── */
export const GUTTER = 32;
export const LABEL_COL_W = 232;
export const TRACK_H = 48;
export const LANE_H = 28;
export const RULER_H = 24;
export const CLIP_Y = 3;
export const CLIP_HANDLE_W = 18;

export interface TimelineBeatEntry {
  readonly index: number;
  readonly time: number;
  readonly strength: number | undefined;
}

function findFirstTimeAtOrAfter(times: readonly number[], target: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((times[mid] ?? Number.POSITIVE_INFINITY) < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Slice sorted beat data without allocating entries outside the render window. */
export function getTimelineBeatEntries(
  beatTimes: readonly number[] | undefined,
  beatStrengths: readonly number[] | undefined,
  range: TimelineTimeRange | undefined,
  pinnedIndexes: ReadonlySet<number> = new Set(),
): readonly TimelineBeatEntry[] {
  if (!beatTimes?.length) return [];
  const start = range?.start ?? Number.NEGATIVE_INFINITY;
  const end = range?.end ?? Number.POSITIVE_INFINITY;
  const selected = new Set<number>();
  for (let index = findFirstTimeAtOrAfter(beatTimes, start); index < beatTimes.length; index++) {
    const time = beatTimes[index];
    if (time === undefined || time >= end) break;
    selected.add(index);
  }
  for (const index of pinnedIndexes) {
    if (index >= 0 && index < beatTimes.length) selected.add(index);
  }
  return [...selected]
    .sort((left, right) => left - right)
    .map((index) => ({ index, time: beatTimes[index]!, strength: beatStrengths?.[index] }));
}

export function getTimelineLaneTop(laneIndex: number): number {
  return TRACK_H + Math.max(0, Math.trunc(laneIndex)) * LANE_H;
}
/**
 * Collapsed-row characterization value for the new-track INSERT band. Runtime
 * hit-testing uses getTimelineInsertBoundaryBand with the concrete row height.
 */
export const INSERT_BOUNDARY_BAND = CLIP_Y / TRACK_H;
/**
 * Breathing room INSIDE the scroll area (CapCut-style), threaded through every
 * track-row y computation via {@link getTimelineRowTop} — never inline a magic
 * offset; a track row's top is always ruler + top pad + cumulative row heights.
 *
 * - TRACKS_TOP_PAD: empty space between the (sticky) ruler and the first track
 *   (~half a track height) so the first clip isn't jammed under the ruler.
 * - TRACKS_BOTTOM_PAD: empty space below the last track (~1.5 track heights),
 *   enough to comfortably drag a clip into the void to create a new bottom lane.
 */
export const TRACKS_TOP_PAD = 50;
export const TRACKS_BOTTOM_PAD = Math.round(TRACK_H * 1.5);
/**
 * Breathing room LEFT of t=0 (CapCut-style), inside the scroll content — the
 * horizontal sibling of TRACKS_TOP_PAD: empty lane surface between the sticky
 * gutter and where the ruler's 00:00 / the clips actually start, scrolling
 * WITH the content. Time↔pixel mapping: content x = GUTTER + TRACKS_LEFT_PAD
 * + t·pps, and every pointer→time inverse subtracts it symmetrically. The
 * lanes and the ruler realize it as a plain flow spacer between the sticky
 * gutter cell and the time-mapped content div, so all content-relative math
 * (clip left = t·pps, beat lines, lane-menu time) is untouched.
 */
export const TRACKS_LEFT_PAD = 48;

/**
 * The y (content-space) of the top edge of track ROW index `row` (0 = first
 * displayed lane). The single source of truth for row→y — the ruler height plus
 * the top breathing pad plus whole track lanes above it. Every clip/ghost/
 * placeholder/insertion top and every pointer-y→row inversion goes through this
 * (or its inverse in {@link getTimelineRowFromY}) so the pad can never drift.
 */
export interface TimelineTrackHeightClip {
  clipId: string;
  laneCount: number;
}

type TimelineTrackHeightInput = readonly (readonly TimelineTrackHeightClip[])[];

/**
 * Resolve each track's full height. Without expansion state every row is the
 * legacy TRACK_H; if multiple clips in one track expand, the tallest one owns
 * the shared row height.
 */
export function trackHeights(
  tracks: number | TimelineTrackHeightInput,
  expandedClipIds?: ReadonlySet<string>,
): number[] {
  if (typeof tracks === "number") {
    return Array.from({ length: Math.max(0, Math.trunc(tracks)) }, () => TRACK_H);
  }
  return tracks.map((clips) => {
    let laneCount = 0;
    if (expandedClipIds) {
      for (const clip of clips) {
        if (expandedClipIds.has(clip.clipId)) laneCount = Math.max(laneCount, clip.laneCount);
      }
    }
    return TRACK_H + Math.max(0, Math.trunc(laneCount)) * LANE_H;
  });
}

function validRowHeight(height: number | undefined): number {
  if (height === undefined || !Number.isFinite(height) || height <= 0) return TRACK_H;
  return height;
}

export interface TimelineRowGeometry {
  readonly rowKeys: readonly number[];
  readonly rowHeights: readonly number[];
  /** Cumulative row boundaries, including the final bottom boundary. */
  readonly rowOffsets: readonly number[];
  readonly rowsHeight: number;
  readonly canvasHeight: number;
  getRowIndex(rowKey: number): number;
  getRowHeight(row: number): number;
  getRowTop(row: number): number;
  getRowFromY(contentY: number): number;
  getRowPositionFromY(contentY: number): {
    rowFloat: number;
    row: number;
    fraction: number;
    rowHeight: number;
  };
}

const rowGeometryCache = new WeakMap<readonly number[], TimelineRowGeometry>();
const EMPTY_ROW_HEIGHTS: readonly number[] = Object.freeze([]);

/** Build the immutable row snapshot shared by rendering and hit testing. */
export function createTimelineRowGeometry(
  rowKeys: readonly number[],
  rowHeights: readonly number[],
): TimelineRowGeometry {
  const heights = Object.freeze(rowHeights.map(validRowHeight));
  const keys = Object.freeze(
    heights.map((_, row) => {
      const key = rowKeys[row];
      return key !== undefined && Number.isFinite(key) ? key : row;
    }),
  );
  const offsets = [0];
  for (const height of heights) offsets.push((offsets.at(-1) ?? 0) + height);
  Object.freeze(offsets);
  const rowIndexByKey = new Map(keys.map((key, row) => [key, row]));

  const getRowHeight = (row: number) => validRowHeight(heights[row]);
  const getRowOffset = (row: number) => {
    if (heights.length === 0) return row * TRACK_H;
    if (row <= 0) return row * getRowHeight(0);
    if (row >= heights.length) {
      return (offsets[heights.length] ?? 0) + (row - heights.length) * TRACK_H;
    }
    const wholeRow = Math.floor(row);
    return (offsets[wholeRow] ?? 0) + (row - wholeRow) * getRowHeight(wholeRow);
  };
  const getRowFromY = (contentY: number) => {
    const y = contentY - RULER_H - TRACKS_TOP_PAD;
    if (heights.length === 0) return y / TRACK_H;
    if (y < 0) return y / getRowHeight(0);
    const rowsHeight = offsets[heights.length] ?? 0;
    if (y >= rowsHeight) return heights.length + (y - rowsHeight) / TRACK_H;

    // First boundary strictly greater than y. Unlike the old linear scan this
    // stays logarithmic for large timelines and uses the precomputed offsets.
    let low = 1;
    let high = heights.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if ((offsets[mid] ?? 0) > y) high = mid;
      else low = mid + 1;
    }
    const row = low - 1;
    return row + (y - (offsets[row] ?? 0)) / getRowHeight(row);
  };
  const geometry: TimelineRowGeometry = {
    rowKeys: keys,
    rowHeights: heights,
    rowOffsets: offsets,
    rowsHeight: offsets.at(-1) ?? 0,
    canvasHeight: RULER_H + TRACKS_TOP_PAD + (offsets.at(-1) ?? 0) + TRACKS_BOTTOM_PAD,
    getRowIndex: (rowKey) => rowIndexByKey.get(rowKey) ?? -1,
    getRowHeight,
    getRowTop: (row) => RULER_H + TRACKS_TOP_PAD + getRowOffset(row),
    getRowFromY,
    getRowPositionFromY: (contentY) => {
      const rowFloat = getRowFromY(contentY);
      const row = Math.floor(rowFloat);
      return { rowFloat, row, fraction: rowFloat - row, rowHeight: getRowHeight(row) };
    },
  };
  const frozenGeometry = Object.freeze(geometry);
  rowGeometryCache.set(heights, frozenGeometry);
  return frozenGeometry;
}

/** Compatibility accessor; repeated calls for one height-array reuse one snapshot. */
export function getTimelineRowGeometry(rowHeights: readonly number[]): TimelineRowGeometry {
  const cached = rowGeometryCache.get(rowHeights);
  if (cached) return cached;
  const geometry = createTimelineRowGeometry(
    rowHeights.map((_, row) => row),
    rowHeights,
  );
  rowGeometryCache.set(rowHeights, geometry);
  return geometry;
}

/** Cumulative top offsets, including the final bottom boundary. */
export function getTimelineRowOffsets(rowHeights: readonly number[]): number[] {
  return [...getTimelineRowGeometry(rowHeights).rowOffsets];
}

export function getTimelineRowHeight(
  row: number,
  rowHeights: readonly number[] = EMPTY_ROW_HEIGHTS,
): number {
  return validRowHeight(rowHeights[row]);
}

function getTimelineRowOffset(row: number, rowHeights: readonly number[]): number {
  return getTimelineRowGeometry(rowHeights).getRowTop(row) - RULER_H - TRACKS_TOP_PAD;
}

export function getTimelineRowTop(
  row: number,
  rowHeights: readonly number[] = EMPTY_ROW_HEIGHTS,
): number {
  return RULER_H + TRACKS_TOP_PAD + getTimelineRowOffset(row, rowHeights);
}

/**
 * Inverse of {@link getTimelineRowTop}: the fractional row index for a content-
 * space y (used for insert-row / drop-lane decisions). Locates the concrete row
 * from cumulative offsets, then returns its local fractional position.
 */
export function getTimelineRowFromY(
  contentY: number,
  rowHeights: readonly number[] = EMPTY_ROW_HEIGHTS,
): number {
  return getTimelineRowGeometry(rowHeights).getRowFromY(contentY);
}

export function getTimelineRowPositionFromY(
  contentY: number,
  rowHeights: readonly number[] = EMPTY_ROW_HEIGHTS,
): { rowFloat: number; row: number; fraction: number; rowHeight: number } {
  return getTimelineRowGeometry(rowHeights).getRowPositionFromY(contentY);
}

/** Fractional insert band for the concrete row under a pointer. */
export function getTimelineInsertBoundaryBand(rowHeight: number): number {
  return CLIP_Y / validRowHeight(rowHeight);
}
/**
 * While a clip drag is live, the rendered timeline extends this far past the
 * ghost's end so the right-edge auto-scroll zone always has room to keep
 * stepping — that's what lets a drag extend the timeline past its current
 * rendered width (see Timeline.tsx displayContentWidth).
 */
export const DRAG_EXTEND_MARGIN_PX = 160;
/**
 * The rendered timeline always spans at least this many seconds of ruler +
 * track lanes, even when the composition is shorter — the empty space on the
 * right is a real, drag/drop-enabled surface (clips can be moved into it; the
 * composition grows on commit, content-driven). In fit mode the fit pps is
 * derived against this floor, so a 10s comp renders as ~1/6 of the viewport
 * with 60s of ruler after it.
 */
export const MIN_TIMELINE_EXTENT_S = 60;
/**
 * Fit-mode headroom (CapCut-style): "fit" maps `duration * 1.2` — not the bare
 * duration — onto the viewport, so the composition ends at ~83% of the width
 * and the trailing ~17% stays empty ruler + droppable lane surface (room to
 * drag clips past the current end without first zooming out). Applied ONLY
 * inside {@link getTimelineFitPps}, the single fit-pps source, so the ruler,
 * lanes, playhead, marquee, and drag math all inherit it consistently. Manual
 * zoom percentages stay defined relative to this fit basis (100% == fit).
 */
export const FIT_ZOOM_HEADROOM = 1.2;

/* ── Tick generation ──────────────────────────────────────────────── */
/* ── Width / duration derivation ──────────────────────────────────── */
/**
 * Fit-mode pixels-per-second: fill the viewport with the composition plus
 * FIT_ZOOM_HEADROOM trailing headroom (CapCut-style — the comp never slams
 * into the right edge), and never map fewer than MIN_TIMELINE_EXTENT_S
 * seconds onto it — a short comp takes a fraction of the width and the
 * remaining ruler runs to 1:00.
 * Manual zoom multiplies this base, so the floor only anchors the default.
 */
export function getTimelineFitPps(
  viewportWidth: number,
  effectiveDuration: number,
  contentOrigin: number,
): number {
  const safeDuration =
    Number.isFinite(effectiveDuration) && effectiveDuration > 0 ? effectiveDuration : 0;
  const span = Math.max(safeDuration * FIT_ZOOM_HEADROOM, MIN_TIMELINE_EXTENT_S);
  if (!Number.isFinite(viewportWidth) || viewportWidth <= contentOrigin) return 100;
  return (viewportWidth - contentOrigin - 2) / span;
}

/**
 * The rendered timeline extent in px. Always covers, whichever is largest:
 * the actual clip content, the visible viewport (no dead black after short
 * content — CapCut-style), a live drag or resize ghost plus the auto-scroll
 * margin (drag/trim-to-extend), and the MIN_TIMELINE_EXTENT_S floor. Only the
 * RENDERED extent grows; clip positions/durations are untouched.
 */
export function getTimelineDisplayContentWidth(input: {
  trackContentWidth: number;
  viewportWidth: number;
  contentOrigin: number;
  pps: number;
  dragGhostEndPx?: number;
  resizeGhostEndPx?: number;
}): number {
  const safePps = Number.isFinite(input.pps) ? Math.max(input.pps, 0) : 0;
  return Math.max(
    input.trackContentWidth,
    input.viewportWidth - input.contentOrigin - 2,
    input.dragGhostEndPx ?? 0,
    input.resizeGhostEndPx ?? 0,
    MIN_TIMELINE_EXTENT_S * safePps,
  );
}

/* ── Scroll / zoom helpers ────────────────────────────────────────── */
export function getTimelineContentXFromClient(input: {
  clientX: number;
  rectLeft: number;
  scrollLeft: number;
  contentOrigin: number;
}): number {
  return input.clientX - input.rectLeft + input.scrollLeft - input.contentOrigin;
}

export function shouldAutoScrollTimeline(
  zoomMode: ZoomMode,
  scrollWidth: number,
  clientWidth: number,
): boolean {
  if (zoomMode === "fit") return false;
  if (!Number.isFinite(scrollWidth) || !Number.isFinite(clientWidth)) return false;
  return scrollWidth - clientWidth > 1;
}

export function getTimelineScrollLeftForZoomTransition(
  previousZoomMode: ZoomMode | null,
  nextZoomMode: ZoomMode,
  currentScrollLeft: number,
): number {
  if (nextZoomMode === "fit") return 0;
  return currentScrollLeft;
}

export function getTimelineScrollLeftForZoomAnchor(input: {
  pointerX: number;
  currentScrollLeft: number;
  contentOrigin: number;
  currentPixelsPerSecond: number;
  nextPixelsPerSecond: number;
  duration: number;
}): number {
  const currentPps = Math.max(0, input.currentPixelsPerSecond);
  const nextPps = Math.max(0, input.nextPixelsPerSecond);
  if (
    !Number.isFinite(input.pointerX) ||
    !Number.isFinite(input.currentScrollLeft) ||
    !Number.isFinite(input.duration) ||
    input.duration <= 0 ||
    currentPps <= 0 ||
    nextPps <= 0
  ) {
    return Math.max(0, input.currentScrollLeft);
  }
  const timelineX = Math.max(
    0,
    getTimelineContentXFromClient({
      clientX: input.pointerX,
      rectLeft: 0,
      scrollLeft: input.currentScrollLeft,
      contentOrigin: input.contentOrigin,
    }),
  );
  const timeAtPointer = Math.max(0, Math.min(input.duration, timelineX / currentPps));
  return Math.max(0, input.contentOrigin + timeAtPointer * nextPps - input.pointerX);
}

/* ── Playhead / canvas ────────────────────────────────────────────── */
/**
 * Width of the playhead wrapper element (== the diamond head chip's layout
 * width, which the wrapper shrink-wraps to). The 1px vertical line inside
 * PlayheadIndicator is centered at 50% of this wrapper, so the wrapper must be
 * shifted LEFT by half this width for the line's center to land exactly on
 * `contentOrigin + time * pps` — see {@link getTimelinePlayheadLeft}.
 */
export const PLAYHEAD_HEAD_W = 9;

/**
 * The `left` for the playhead WRAPPER such that the vertical line's CENTER
 * sits exactly on `contentOrigin + time * pps` (the same x the ruler ticks center
 * on) at every zoom level. Without the half-head offset the line sat
 * `PLAYHEAD_HEAD_W / 2` px to the right of its ruler tick.
 */
export function getTimelinePlayheadLeft(
  time: number,
  pixelsPerSecond: number,
  contentOrigin: number,
): number {
  if (!Number.isFinite(time) || !Number.isFinite(pixelsPerSecond)) {
    return contentOrigin - PLAYHEAD_HEAD_W / 2;
  }
  return contentOrigin + Math.max(0, time) * Math.max(0, pixelsPerSecond) - PLAYHEAD_HEAD_W / 2;
}

const PLAYBACK_FOLLOW_POSITION = 0.75;

/**
 * Keep a playing timeline calm until the playhead crosses the right-side
 * comfort line, then advance the viewport just enough to hold it there. A
 * loop/reverse jump that leaves the playhead behind the sticky labels restores
 * the matching earlier viewport instead.
 */
export function getTimelinePlaybackFollowScrollLeft(input: {
  playheadX: number;
  currentScrollLeft: number;
  viewportWidth: number;
  contentOrigin: number;
  maxScrollLeft: number;
}): number {
  const current = Number.isFinite(input.currentScrollLeft)
    ? Math.max(0, input.currentScrollLeft)
    : 0;
  const max = Number.isFinite(input.maxScrollLeft) ? Math.max(0, input.maxScrollLeft) : 0;
  const visibleTimelineWidth = input.viewportWidth - input.contentOrigin;
  if (
    !Number.isFinite(input.playheadX) ||
    !Number.isFinite(input.contentOrigin) ||
    !Number.isFinite(visibleTimelineWidth) ||
    visibleTimelineWidth <= 0 ||
    max <= 0
  ) {
    return Math.min(max, current);
  }

  const visibleStart = current + input.contentOrigin;
  const followLine = visibleStart + visibleTimelineWidth * PLAYBACK_FOLLOW_POSITION;
  let next = current;
  if (input.playheadX > followLine) {
    next = input.playheadX - input.contentOrigin - visibleTimelineWidth * PLAYBACK_FOLLOW_POSITION;
  } else if (input.playheadX < visibleStart) {
    next = input.playheadX - input.contentOrigin;
  }
  return Math.max(0, Math.min(max, next));
}

export function getTimelineCanvasHeight(trackCountOrHeights: number | readonly number[]): number {
  // RULER_H + top pad + lanes + bottom pad. The old TIMELINE_SCROLL_BUFFER is
  // subsumed by TRACKS_BOTTOM_PAD (which is larger), so the drag-into-void space
  // below the last lane is real scrollable surface, not a hidden buffer.
  const heights =
    typeof trackCountOrHeights === "number"
      ? trackHeights(trackCountOrHeights)
      : trackCountOrHeights;
  return getTimelineRowGeometry(heights).canvasHeight;
}

/* ── UI helpers ───────────────────────────────────────────────────── */
export function shouldShowTimelineShortcutHint(
  scrollHeight: number,
  clientHeight: number,
): boolean {
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) return true;
  return scrollHeight - clientHeight <= 1;
}

export function shouldHandleTimelineDeleteKey(input: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null;
}): boolean {
  if (input.key !== "Delete" && input.key !== "Backspace") return false;
  if (input.metaKey || input.ctrlKey || input.altKey) return false;
  const target =
    input.target && typeof input.target === "object"
      ? (input.target as {
          tagName?: string;
          isContentEditable?: boolean;
          closest?: (selector: string) => Element | null;
        })
      : null;
  if (target) {
    const tag = target.tagName?.toLowerCase() ?? "";
    if (target.isContentEditable) return false;
    if (["input", "textarea", "select"].includes(tag)) return false;
    if (typeof target.closest === "function" && target.closest("[contenteditable='true']")) {
      return false;
    }
  }
  return true;
}

/* ── Asset drop ───────────────────────────────────────────────────── */
export function getDefaultDroppedTrack(trackOrder: number[], rowIndex?: number): number {
  if (trackOrder.length === 0) return 0;
  if (rowIndex == null || rowIndex < 0) return trackOrder[0];
  if (rowIndex >= trackOrder.length) {
    return Math.max(...trackOrder) + 1;
  }
  return trackOrder[rowIndex] ?? trackOrder[trackOrder.length - 1] ?? 0;
}

export function resolveTimelineAssetDrop(
  input: {
    rectLeft: number;
    rectTop: number;
    scrollLeft: number;
    scrollTop: number;
    contentOrigin: number;
    pixelsPerSecond: number;
    duration: number;
    clampStartToDuration?: boolean;
    rowHeights?: readonly number[];
    trackOrder: number[];
  },
  clientX: number,
  clientY: number,
): { start: number; track: number } {
  const x = getTimelineContentXFromClient({
    clientX,
    rectLeft: input.rectLeft,
    scrollLeft: input.scrollLeft,
    contentOrigin: input.contentOrigin,
  });
  const contentY = clientY - input.rectTop + input.scrollTop;
  const pointerStart = Math.round((x / Math.max(input.pixelsPerSecond, 1)) * 100) / 100;
  const start = Math.max(
    0,
    input.clampStartToDuration === false ? pointerStart : Math.min(input.duration, pointerStart),
  );
  // Row from the shared row→y inverse so the top pad is honoured; a drop in the
  // pad above the first lane floors to row 0, a drop in the bottom pad rounds
  // past the last lane (getDefaultDroppedTrack then appends a new track).
  const rowIndex = Math.floor(getTimelineRowFromY(contentY, input.rowHeights));
  return {
    start,
    track: getDefaultDroppedTrack(input.trackOrder, rowIndex),
  };
}

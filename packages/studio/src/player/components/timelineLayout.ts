import { formatTime } from "../lib/time";
import type { ZoomMode } from "../store/playerStore";

/* ── Layout constants ──────────────────────────────────────────────── */
export const GUTTER = 32;
export const TRACK_H = 48;
export const RULER_H = 24;
export const CLIP_Y = 3;
export const CLIP_HANDLE_W = 18;
/**
 * Half-width (as a fraction of TRACK_H) of the new-track INSERT band that
 * straddles each lane boundary. Deliberately equals the clip's vertical inset
 * (`CLIP_Y / TRACK_H`): a clip body fills [CLIP_Y, TRACK_H − CLIP_Y] of its row,
 * so the ONLY region this band covers is the visible empty gutter between two
 * clip bodies (plus the top/bottom breathing pads, handled separately by the
 * rowFloat ≤ 0 / ≥ trackCount extremes). Aiming at a clip body is therefore a
 * move-to-that-lane; only the inter-clip gap arms an insert — see resolveInsertRow.
 * Threaded into resolveInsertRow by the drag preview so the hit band can never
 * drift from the rendered clip geometry.
 */
export const INSERT_BOUNDARY_BAND = CLIP_Y / TRACK_H;
/**
 * Breathing room INSIDE the scroll area (CapCut-style), threaded through every
 * track-row y computation via {@link getTimelineRowTop} — never inline a magic
 * offset; a track row's top is always `RULER_H + TRACKS_TOP_PAD + row*TRACK_H`.
 *
 * - TRACKS_TOP_PAD: empty space between the (sticky) ruler and the first track
 *   (~half a track height) so the first clip isn't jammed under the ruler.
 * - TRACKS_BOTTOM_PAD: empty space below the last track (~1.5 track heights),
 *   enough to comfortably drag a clip into the void to create a new bottom lane.
 */
export const TRACKS_TOP_PAD = 50;
export const TRACKS_BOTTOM_PAD = Math.round(TRACK_H * 1.5);

/**
 * The y (content-space) of the top edge of track ROW index `row` (0 = first
 * displayed lane). The single source of truth for row→y — the ruler height plus
 * the top breathing pad plus whole track lanes above it. Every clip/ghost/
 * placeholder/insertion top and every pointer-y→row inversion goes through this
 * (or its inverse in {@link getTimelineRowFromY}) so the pad can never drift.
 */
export function getTimelineRowTop(row: number): number {
  return RULER_H + TRACKS_TOP_PAD + row * TRACK_H;
}

/**
 * Inverse of {@link getTimelineRowTop}: the fractional row index for a content-
 * space y (used for insert-row / drop-lane decisions). Subtracts the ruler and
 * top pad before dividing by the track height.
 */
export function getTimelineRowFromY(contentY: number): number {
  return (contentY - RULER_H - TRACKS_TOP_PAD) / TRACK_H;
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

/* ── Tick generation ──────────────────────────────────────────────── */
function getMajorTickInterval(duration: number, pixelsPerSecond?: number): number {
  const zoomIntervals = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  if (Number.isFinite(pixelsPerSecond) && (pixelsPerSecond ?? 0) > 0) {
    const targetMajorPx = 88;
    return (
      zoomIntervals.find((interval) => interval * (pixelsPerSecond ?? 0) >= targetMajorPx) ?? 600
    );
  }
  const durationIntervals = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
  const target = duration / 6;
  return durationIntervals.find((interval) => interval >= target) ?? 60;
}

// How many equal parts to split each major interval into for minor ticks. Prefer
// quarters (4) so the midpoint stays a minor tick; fall back to halves (2) then
// none (0) as ticks get too dense to read (< ~8px apart).
function getMinorSubdivisions(majorInterval: number, pixelsPerSecond?: number): number {
  const pps = Number.isFinite(pixelsPerSecond) ? (pixelsPerSecond ?? 0) : 0;
  if (pps <= 0) return 4; // no zoom info (duration-fit mode): quarter ticks
  if ((majorInterval / 4) * pps >= 8) return 4;
  if ((majorInterval / 2) * pps >= 8) return 2;
  return 0;
}

export function generateTicks(
  duration: number,
  pixelsPerSecond?: number,
): { major: number[]; minor: number[] } {
  if (duration <= 0 || !Number.isFinite(duration) || duration > 7200)
    return { major: [], minor: [] };
  const majorInterval = getMajorTickInterval(duration, pixelsPerSecond);
  const subdivisions = getMinorSubdivisions(majorInterval, pixelsPerSecond);
  const minorInterval = subdivisions > 0 ? majorInterval / subdivisions : 0;
  const major: number[] = [];
  const minor: number[] = [];
  const maxTicks = 2000; // Safety cap to prevent runaway tick generation
  for (let t = 0; t <= duration + 0.001 && major.length < maxTicks; t += majorInterval) {
    const rounded = Math.round(t * 100) / 100;
    major.push(rounded);
    // Emit the (subdivisions - 1) minor ticks between this major and the next.
    for (let k = 1; k < subdivisions && major.length + minor.length < maxTicks; k++) {
      const m = Math.round((t + k * minorInterval) * 100) / 100;
      if (m <= duration + 0.001) minor.push(m);
    }
  }
  return { major, minor };
}

export function formatTimelineTickLabel(time: number, duration: number, majorInterval: number) {
  if (!Number.isFinite(time)) return "00:00";
  const safeTime = Math.max(0, time);
  if (majorInterval < 0.1) {
    const totalHundredths = Math.round(safeTime * 100);
    const wholeSeconds = Math.floor(totalHundredths / 100);
    const hundredth = totalHundredths % 100;
    return `${formatTime(wholeSeconds)}.${hundredth.toString().padStart(2, "0")}`;
  }
  if (majorInterval < 1) {
    const totalTenths = Math.round(safeTime * 10);
    const wholeSeconds = Math.floor(totalTenths / 10);
    const tenth = totalTenths % 10;
    return `${formatTime(wholeSeconds)}.${tenth}`;
  }
  if (duration >= 3600 || safeTime >= 3600) {
    const totalSeconds = Math.floor(safeTime);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return formatTime(safeTime);
}

/* ── Width / duration derivation ──────────────────────────────────── */
/**
 * Fit-mode pixels-per-second: fill the viewport with the composition, but
 * never map fewer than MIN_TIMELINE_EXTENT_S seconds onto it — a short comp
 * takes a fraction of the width and the remaining ruler runs to 1:00.
 * Manual zoom multiplies this base, so the floor only anchors the default.
 */
export function getTimelineFitPps(viewportWidth: number, effectiveDuration: number): number {
  const safeDuration =
    Number.isFinite(effectiveDuration) && effectiveDuration > 0 ? effectiveDuration : 0;
  const span = Math.max(safeDuration, MIN_TIMELINE_EXTENT_S);
  if (!Number.isFinite(viewportWidth) || viewportWidth <= GUTTER) return 100;
  return (viewportWidth - GUTTER - 2) / span;
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
  pps: number;
  dragGhostEndPx?: number;
  resizeGhostEndPx?: number;
}): number {
  const safePps = Number.isFinite(input.pps) ? Math.max(input.pps, 0) : 0;
  return Math.max(
    input.trackContentWidth,
    input.viewportWidth - GUTTER - 2,
    input.dragGhostEndPx ?? 0,
    input.resizeGhostEndPx ?? 0,
    MIN_TIMELINE_EXTENT_S * safePps,
  );
}

/* ── Scroll / zoom helpers ────────────────────────────────────────── */
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
  gutter: number;
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
  const timelineX = Math.max(0, input.currentScrollLeft + input.pointerX - input.gutter);
  const timeAtPointer = Math.max(0, Math.min(input.duration, timelineX / currentPps));
  return Math.max(0, input.gutter + timeAtPointer * nextPps - input.pointerX);
}

/* ── Playhead / canvas ────────────────────────────────────────────── */
export function getTimelinePlayheadLeft(time: number, pixelsPerSecond: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(pixelsPerSecond)) return GUTTER;
  return GUTTER + Math.max(0, time) * Math.max(0, pixelsPerSecond);
}

export function getTimelineCanvasHeight(trackCount: number): number {
  // RULER_H + top pad + lanes + bottom pad. The old TIMELINE_SCROLL_BUFFER is
  // subsumed by TRACKS_BOTTOM_PAD (which is larger), so the drag-into-void space
  // below the last lane is real scrollable surface, not a hidden buffer.
  return RULER_H + TRACKS_TOP_PAD + Math.max(0, trackCount) * TRACK_H + TRACKS_BOTTOM_PAD;
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
    pixelsPerSecond: number;
    duration: number;
    trackHeight: number;
    trackOrder: number[];
  },
  clientX: number,
  clientY: number,
): { start: number; track: number } {
  const x = clientX - input.rectLeft + input.scrollLeft - GUTTER;
  const contentY = clientY - input.rectTop + input.scrollTop;
  const start = Math.max(
    0,
    Math.min(input.duration, Math.round((x / Math.max(input.pixelsPerSecond, 1)) * 100) / 100),
  );
  // Row from the shared row→y inverse so the top pad is honoured; a drop in the
  // pad above the first lane floors to row 0, a drop in the bottom pad rounds
  // past the last lane (getDefaultDroppedTrack then appends a new track).
  const rowIndex = Math.floor(getTimelineRowFromY(contentY));
  return {
    start,
    track: getDefaultDroppedTrack(input.trackOrder, rowIndex),
  };
}

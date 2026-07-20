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
// fallow-ignore-next-line complexity
function getMajorTickInterval(
  duration: number,
  pixelsPerSecond?: number,
  frameRate?: number,
): number {
  // "Nice" NLE steps: 1-2-5 sub-second decades, then 1s/2s/5s/10s/15s/30s,
  // minute multiples, and 15m/30m/1h so ultra-zoomed-out long comps still get
  // readable (non-colliding) labels instead of the old 10m fallback everywhere.
  const zoomIntervals = [
    0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
  ];
  let interval: number;
  if (Number.isFinite(pixelsPerSecond) && (pixelsPerSecond ?? 0) > 0) {
    const targetMajorPx = 88;
    interval =
      zoomIntervals.find((candidate) => candidate * (pixelsPerSecond ?? 0) >= targetMajorPx) ??
      3600;
  } else {
    const durationIntervals = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    const target = duration / 6;
    interval = durationIntervals.find((candidate) => candidate >= target) ?? 60;
  }
  // Frame display mode: labels are frame numbers, so a major step must be a
  // WHOLE number of frames — sub-frame steps produce duplicate/uneven labels
  // (e.g. 0.02s at 30fps is 0.6 frames → "0, 1, 1, 2, 2…"). Snap UP (ceil) so
  // the label spacing never drops below the readability target.
  if (Number.isFinite(frameRate) && (frameRate ?? 0) > 0) {
    const fps = frameRate ?? 0;
    return Math.max(1, Math.ceil(interval * fps - 1e-6)) / fps;
  }
  return interval;
}

// How many equal parts to split each major interval into for minor ticks. Prefer
// quarters (4) so the midpoint stays a minor tick; fall back to halves (2) then
// none (0) as ticks get too dense to read (< ~8px apart). In frame display mode
// the subdivision must also keep minor ticks on WHOLE frames (a minor tick at a
// sub-frame time is not a seekable position), so only divisors of the major
// step's frame count qualify — quarters, then fifths (15/30-frame majors),
// thirds, halves.
// fallow-ignore-next-line complexity
function getMinorSubdivisions(
  majorInterval: number,
  pixelsPerSecond?: number,
  frameRate?: number,
): number {
  const pps = Number.isFinite(pixelsPerSecond) ? (pixelsPerSecond ?? 0) : 0;
  if (pps <= 0) return 4; // no zoom info (duration-fit mode): quarter ticks
  const fps = Number.isFinite(frameRate) ? (frameRate ?? 0) : 0;
  const majorFrames = fps > 0 ? Math.round(majorInterval * fps) : 0;
  const candidates = fps > 0 ? [4, 5, 3, 2] : [4, 2];
  for (const parts of candidates) {
    if (fps > 0 && majorFrames % parts !== 0) continue;
    if ((majorInterval / parts) * pps >= 8) return parts;
  }
  return 0;
}

// Ticks are exact multiples of the interval (multiplied per index, never
// accumulated with `+=`, so long rulers don't drift), then rounded to 1µs to
// keep values/keys clean without disturbing frame-exact positions like 2/30s.
function roundTickValue(t: number): number {
  return Math.round(t * 1e6) / 1e6;
}

export function generateTicks(
  duration: number,
  pixelsPerSecond?: number,
  frameRate?: number,
): { major: number[]; minor: number[] } {
  if (duration <= 0 || !Number.isFinite(duration) || duration > 14400)
    return { major: [], minor: [] };
  const majorInterval = getMajorTickInterval(duration, pixelsPerSecond, frameRate);
  const subdivisions = getMinorSubdivisions(majorInterval, pixelsPerSecond, frameRate);
  const minorInterval = subdivisions > 0 ? majorInterval / subdivisions : 0;
  const major: number[] = [];
  const minor: number[] = [];
  const maxTicks = 2000; // Safety cap to prevent runaway tick generation
  for (let i = 0; major.length < maxTicks; i++) {
    const t = i * majorInterval;
    if (t > duration + 0.001) break;
    major.push(roundTickValue(t));
    // Emit the (subdivisions - 1) minor ticks between this major and the next.
    for (let k = 1; k < subdivisions && major.length + minor.length < maxTicks; k++) {
      const m = t + k * minorInterval;
      if (m <= duration + 0.001) minor.push(roundTickValue(m));
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
 * Fit-mode pixels-per-second: fill the viewport with the composition plus
 * FIT_ZOOM_HEADROOM trailing headroom (CapCut-style — the comp never slams
 * into the right edge), and never map fewer than MIN_TIMELINE_EXTENT_S
 * seconds onto it — a short comp takes a fraction of the width and the
 * remaining ruler runs to 1:00.
 * Manual zoom multiplies this base, so the floor only anchors the default.
 */
export function getTimelineFitPps(viewportWidth: number, effectiveDuration: number): number {
  const safeDuration =
    Number.isFinite(effectiveDuration) && effectiveDuration > 0 ? effectiveDuration : 0;
  const span = Math.max(safeDuration * FIT_ZOOM_HEADROOM, MIN_TIMELINE_EXTENT_S);
  if (!Number.isFinite(viewportWidth) || viewportWidth <= GUTTER + TRACKS_LEFT_PAD) return 100;
  return (viewportWidth - GUTTER - TRACKS_LEFT_PAD - 2) / span;
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
    input.viewportWidth - GUTTER - TRACKS_LEFT_PAD - 2,
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
/**
 * Width of the playhead wrapper element (== the diamond head chip's layout
 * width, which the wrapper shrink-wraps to). The 1px vertical line inside
 * PlayheadIndicator is centered at 50% of this wrapper, so the wrapper must be
 * shifted LEFT by half this width for the line's center to land exactly on
 * `GUTTER + time * pps` — see {@link getTimelinePlayheadLeft}.
 */
export const PLAYHEAD_HEAD_W = 9;

/**
 * The `left` for the playhead WRAPPER such that the vertical line's CENTER
 * sits exactly on `GUTTER + time * pps` (the same x the ruler ticks center
 * on) at every zoom level. Without the half-head offset the line sat
 * `PLAYHEAD_HEAD_W / 2` px to the right of its ruler tick.
 */
export function getTimelinePlayheadLeft(time: number, pixelsPerSecond: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(pixelsPerSecond)) {
    return GUTTER + TRACKS_LEFT_PAD - PLAYHEAD_HEAD_W / 2;
  }
  return (
    GUTTER +
    TRACKS_LEFT_PAD +
    Math.max(0, time) * Math.max(0, pixelsPerSecond) -
    PLAYHEAD_HEAD_W / 2
  );
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
    clampStartToDuration?: boolean;
    trackHeight: number;
    trackOrder: number[];
  },
  clientX: number,
  clientY: number,
): { start: number; track: number } {
  const x = clientX - input.rectLeft + input.scrollLeft - GUTTER - TRACKS_LEFT_PAD;
  const contentY = clientY - input.rectTop + input.scrollTop;
  const pointerStart = Math.round((x / Math.max(input.pixelsPerSecond, 1)) * 100) / 100;
  const start = Math.max(
    0,
    input.clampStartToDuration === false ? pointerStart : Math.min(input.duration, pointerStart),
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

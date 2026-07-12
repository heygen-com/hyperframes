import { formatTime } from "../lib/time";
import type { ZoomMode } from "../store/playerStore";

/* ── Layout constants ──────────────────────────────────────────────── */
export const GUTTER = 32;
export const TRACK_H = 48;
export const RULER_H = 24;
export const CLIP_Y = 3;
export const CLIP_HANDLE_W = 18;
const TIMELINE_SCROLL_BUFFER = 20;

/* ── Timeline duration ─────────────────────────────────────────────── */

// Committed timeline length: root duration or the furthest committed clip end,
// with NO live drag/resize preview. This drives the zoom (fit-to-width pps) so
// the pixels-per-second mapping stays fixed while you drag — otherwise a clip
// dragged past the end grows the duration, shrinks pps, and jumps under the
// pointer (a positive-feedback loop). The zoom re-fits once on drop.
export function computeTimelineBasisDuration(
  rootDuration: number,
  clipEnds: readonly number[],
): number {
  const safeDur = Number.isFinite(rootDuration) ? rootDuration : 0;
  if (clipEnds.length === 0) return safeDur;
  const maxEnd = Math.max(safeDur, ...clipEnds);
  return Number.isFinite(maxEnd) ? maxEnd : safeDur;
}

// Displayed length: the basis plus any active drag/resize preview end, so the
// ruler and track width grow to follow a clip dragged past the current end
// (with the zoom held fixed, the extra length becomes scrollable content).
export function computeTimelineEffectiveDuration(
  basisDuration: number,
  previewEnds: readonly (number | null)[],
): number {
  let maxEnd = basisDuration;
  for (const end of previewEnds) {
    if (end != null && Number.isFinite(end)) maxEnd = Math.max(maxEnd, end);
  }
  return maxEnd;
}

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

function getMinorTickInterval(majorInterval: number, pixelsPerSecond?: number): number {
  if (
    Number.isFinite(pixelsPerSecond) &&
    (pixelsPerSecond ?? 0) > 0 &&
    (majorInterval / 2) * (pixelsPerSecond ?? 0) < 12
  ) {
    return 0;
  }
  return majorInterval / 2;
}

export function generateTicks(
  duration: number,
  pixelsPerSecond?: number,
): { major: number[]; minor: number[] } {
  if (duration <= 0 || !Number.isFinite(duration) || duration > 7200)
    return { major: [], minor: [] };
  const majorInterval = getMajorTickInterval(duration, pixelsPerSecond);
  const minorInterval = getMinorTickInterval(majorInterval, pixelsPerSecond);
  const major: number[] = [];
  const minor: number[] = [];
  const maxTicks = 2000; // Safety cap to prevent runaway tick generation
  for (let t = 0; t <= duration + 0.001 && major.length < maxTicks; t += majorInterval) {
    const rounded = Math.round(t * 100) / 100;
    major.push(rounded);
    if (minorInterval > 0 && major.length + minor.length < maxTicks) {
      const midpoint = Math.round((t + minorInterval) * 100) / 100;
      if (midpoint <= duration + 0.001) minor.push(midpoint);
    }
  }
  return { major, minor };
}

/**
 * Ticks spanning the full visible ruler width, not just the composition, so a
 * zoomed-out ruler stays filled with labels instead of ending mid-panel. The
 * major/minor interval is driven by pixelsPerSecond (pixel spacing), so widening
 * the range keeps spacing identical — it only adds ticks past the content end.
 */
export function generateVisibleTicks(
  effectiveDuration: number,
  pixelsPerSecond: number,
  viewportWidth: number,
  gutter: number,
): { major: number[]; minor: number[] } {
  const visible = viewportWidth > gutter ? (viewportWidth - gutter) / pixelsPerSecond : 0;
  return generateTicks(Math.max(effectiveDuration, visible), pixelsPerSecond);
}

export function formatTimelineTickLabel(time: number, duration: number, majorInterval: number) {
  if (!Number.isFinite(time)) return "0:00";
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
  return RULER_H + Math.max(0, trackCount) * TRACK_H + TIMELINE_SCROLL_BUFFER;
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
  const y = clientY - input.rectTop + input.scrollTop - RULER_H;
  const start = Math.max(
    0,
    Math.min(input.duration, Math.round((x / Math.max(input.pixelsPerSecond, 1)) * 100) / 100),
  );
  const rowIndex = Math.floor(y / Math.max(input.trackHeight, 1));
  return {
    start,
    track: getDefaultDroppedTrack(input.trackOrder, rowIndex),
  };
}

import type { ZoomMode } from "../store/playerStore";

export const MIN_TIMELINE_ZOOM_PERCENT = 10;
export const MAX_TIMELINE_ZOOM_PERCENT = 2000;
const ZOOM_OUT_FACTOR = 0.8;
const ZOOM_IN_FACTOR = 1.25;
const PINCH_ZOOM_SENSITIVITY = 0.0035;

export function clampTimelineZoomPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  return Math.max(
    MIN_TIMELINE_ZOOM_PERCENT,
    Math.min(MAX_TIMELINE_ZOOM_PERCENT, Math.round(percent)),
  );
}

export function getTimelineZoomPercent(zoomMode: ZoomMode, manualZoomPercent: number): number {
  return zoomMode === "fit" ? 100 : clampTimelineZoomPercent(manualZoomPercent);
}

/**
 * The manual-zoom percent that, applied to `fitPixelsPerSecond`, reproduces the
 * CURRENT on-screen pixels-per-second exactly. Used to PIN the timeline zoom on
 * the first edit so a duration change (which recomputes fit-pps) no longer
 * rescales every clip: we switch `zoomMode` to "manual" with this percent, so
 * `getTimelinePixelsPerSecond` keeps returning today's pps regardless of the new
 * fit basis.
 *
 * Since `pps = fitPps * (percent / 100)` in manual mode, and while fitting
 * `pps === fitPps`, the pinned percent is `currentPps / fitPps * 100`. Clamped to
 * the manual-zoom range so the pin can't land outside the slider's bounds; falls
 * back to 100 (a no-op pin at the current fit) when either input is unusable.
 */
export function computePinnedZoomPercent(
  currentPixelsPerSecond: number,
  fitPixelsPerSecond: number,
): number {
  if (
    !Number.isFinite(currentPixelsPerSecond) ||
    currentPixelsPerSecond <= 0 ||
    !Number.isFinite(fitPixelsPerSecond) ||
    fitPixelsPerSecond <= 0
  ) {
    return 100;
  }
  return clampTimelineZoomPercent((currentPixelsPerSecond / fitPixelsPerSecond) * 100);
}

export function getTimelinePixelsPerSecond(
  fitPixelsPerSecond: number,
  zoomMode: ZoomMode,
  manualZoomPercent: number,
): number {
  if (!Number.isFinite(fitPixelsPerSecond) || fitPixelsPerSecond <= 0) return 100;
  const zoomPercent = getTimelineZoomPercent(zoomMode, manualZoomPercent);
  return zoomMode === "fit" ? fitPixelsPerSecond : fitPixelsPerSecond * (zoomPercent / 100);
}

export function getNextTimelineZoomPercent(
  direction: "in" | "out",
  zoomMode: ZoomMode,
  manualZoomPercent: number,
): number {
  const current = getTimelineZoomPercent(zoomMode, manualZoomPercent);
  const next = direction === "in" ? current * ZOOM_IN_FACTOR : current * ZOOM_OUT_FACTOR;
  return clampTimelineZoomPercent(next);
}

export function getPinchTimelineZoomPercent(
  deltaY: number,
  zoomMode: ZoomMode,
  manualZoomPercent: number,
): number {
  const current = getTimelineZoomPercent(zoomMode, manualZoomPercent);
  if (!Number.isFinite(deltaY) || deltaY === 0) return current;
  return clampTimelineZoomPercent(current * Math.exp(-deltaY * PINCH_ZOOM_SENSITIVITY));
}

const LOG_MIN = Math.log(MIN_TIMELINE_ZOOM_PERCENT);
const LOG_MAX = Math.log(MAX_TIMELINE_ZOOM_PERCENT);

/**
 * Maps a zoom percent (10–2000) to a slider position (0–100) using a log scale.
 * Log scale is used because the range spans 200×; linear would compress the
 * low end (10–100%) into a tiny sliver of the slider.
 */
export function timelineZoomPercentToSlider(percent: number): number {
  const clamped = clampTimelineZoomPercent(percent);
  return ((Math.log(clamped) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 100;
}

/**
 * Maps a slider position (0–100) to a zoom percent (10–2000) using a log scale.
 * Inverse of `timelineZoomPercentToSlider`.
 */
export function timelineSliderToZoomPercent(slider: number): number {
  const clampedSlider = Math.max(0, Math.min(100, slider));
  const logValue = LOG_MIN + (clampedSlider / 100) * (LOG_MAX - LOG_MIN);
  return clampTimelineZoomPercent(Math.exp(logValue));
}

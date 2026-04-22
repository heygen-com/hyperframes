import type { ZoomMode } from "../store/playerStore";

export const MIN_TIMELINE_ZOOM_PERCENT = 10;
export const MAX_TIMELINE_ZOOM_PERCENT = 2000;
const ZOOM_OUT_FACTOR = 0.8;
const ZOOM_IN_FACTOR = 1.25;

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

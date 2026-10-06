import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { TimelineTimeRange } from "../lib/timelineClipIndex";
import { usePlayerStore } from "../store/playerStore";
import { markTimelineMotion } from "./timelineMotion";
import { getTimelineRenderTimeRange } from "./timelineViewportGeometry";
import {
  clampTimelineZoomPercent,
  getNextTimelineZoomPercent,
  getTimelineZoomPercent,
} from "./timelineZoom";

/** Where a zoom holds its place: `time` stays `x` px from the viewport's left edge. */
export interface TimelineZoomAnchor {
  time: number;
  x: number;
}

/** The mounted timeline's scroll viewport, which zoom-to-range measures against. */
export interface TimelineZoomViewport {
  scroll: HTMLDivElement;
  contentOrigin: number;
}

/** How an eased zoom ended: it reached its range, or a person's zoom or the caller stopped it. */
export type TimelineZoomResult = "done" | "cancelled";

/**
 * A zoom drawn by scaling what is already laid out, on the compositor, until it is committed.
 * `shift` is the scrollLeft minus the scrollLeft the zoom will have: the translate that places it.
 */
interface ZoomPreview {
  percent: number;
  pps: number;
  shift: number;
  basePps: number;
  /** The times with clips mounted when the preview began; past them it would show gaps. */
  mounted: TimelineTimeRange;
  byPerson: boolean;
}

const RANGE_MARGIN_PX = 24;
const SMOOTH_ZOOM_MS = 220;
/** How long a gesture holds still before its zoom is laid out for real. */
const REST_MS = 150;
/** Past this the scaled-up preview turns soft. */
const MAX_PREVIEW_SCALE = 4;
const SCALED = "[data-timeline-zoom-scale]";

let viewport: TimelineZoomViewport | null = null;
let preview: ZoomPreview | null = null;
let frame = 0;
let restTimer: ReturnType<typeof setTimeout> | null = null;
let anchorForCommit: TimelineZoomAnchor | null = null;
let animation = 0;
let easingTo: number | null = null;
let settle: ((result: TimelineZoomResult) => void) | null = null;
const previewListeners = new Set<() => void>();

/** The percent the timeline is showing. */
export function currentTimelineZoomPercent(): number {
  if (preview) return preview.percent;
  const s = usePlayerStore.getState();
  return getTimelineZoomPercent(s.zoomMode, s.manualZoomPercent, s.timelineFitPps);
}

/** The scale the timeline shows and the scrollLeft that scale would have. */
function shown(scroll: HTMLDivElement): { pps: number; left: number } {
  if (preview) return { pps: preview.pps, left: scroll.scrollLeft - preview.shift };
  return { pps: usePlayerStore.getState().timelinePps, left: scroll.scrollLeft };
}

/** The time under `x` px from the timeline viewport's left edge, as it is drawn now. */
export function timelineTimeAtX(x: number): number | null {
  if (!viewport) return null;
  const { pps, left } = shown(viewport.scroll);
  return pps > 0 ? (left + x - viewport.contentOrigin) / pps : null;
}

/** The scale and time-zero position to place something at a time by, while a zoom is previewed. */
export function timelineZoomMapping(pps: number, contentOrigin: number) {
  return preview
    ? { pps: preview.pps, contentOrigin: contentOrigin + preview.shift }
    : { pps, contentOrigin };
}

/** Called each frame a zoom preview moves, and once when it is laid out. */
export function subscribeTimelineZoomPreview(listener: () => void): () => void {
  previewListeners.add(listener);
  return () => previewListeners.delete(listener);
}

const subscribeShownZoom = (listener: () => void) => {
  const unsubscribePreview = subscribeTimelineZoomPreview(listener);
  const unsubscribeStore = usePlayerStore.subscribe(listener);
  return () => {
    unsubscribePreview();
    unsubscribeStore();
  };
};

/** The zoom percent the timeline shows, kept current through a preview. */
export function useShownTimelineZoomPercent(): number {
  return useSyncExternalStore(subscribeShownZoom, currentTimelineZoomPercent);
}

function writeZoom(percent: number, anchor: TimelineZoomAnchor | null, byPerson: boolean) {
  anchorForCommit = anchor;
  usePlayerStore.setState((s) => {
    const clamped = clampTimelineZoomPercent(percent, s.timelineFitPps);
    return {
      zoomMode: "manual",
      manualZoomPercent: clamped,
      // Only a person's zoom counts: the timeline and its host read it as the person taking over.
      userZoomCount: s.userZoomCount + (byPerson ? 1 : 0),
      timelinePps: (s.timelineFitPps * clamped) / 100,
    };
  });
}

function clearScaled(scroll: HTMLElement) {
  scroll.querySelectorAll<HTMLElement>(SCALED).forEach((el) => {
    el.style.transform = "";
    el.style.transformOrigin = "";
    el.style.willChange = "";
  });
}

/** Whether the preview shows time outside what was mounted, or is scaled up too far. */
function previewNeedsLayout(p: ZoomPreview, scroll: HTMLDivElement, contentOrigin: number) {
  if (p.pps / p.basePps > MAX_PREVIEW_SCALE) return true;
  const left = scroll.scrollLeft - p.shift;
  const start = left / p.pps;
  const end = (left + scroll.clientWidth - contentOrigin) / p.pps;
  const duration = usePlayerStore.getState().duration || Number.POSITIVE_INFINITY;
  return (
    (p.mounted.start > 0 && start < p.mounted.start) ||
    (p.mounted.end < duration && end > p.mounted.end)
  );
}

function drawPreview() {
  frame = 0;
  const view = viewport;
  if (!preview || !view) return;
  if (previewNeedsLayout(preview, view.scroll, view.contentOrigin)) {
    commitPreview();
    return;
  }
  const scale = preview.pps / preview.basePps;
  const transform = `translateX(${preview.shift}px) scaleX(${scale})`;
  view.scroll.querySelectorAll<HTMLElement>(SCALED).forEach((el) => {
    // The attribute's value is where time zero sits in the element, when not at its left edge.
    el.style.transformOrigin = `${el.dataset.timelineZoomScale || 0}px 0`;
    el.style.willChange = "transform";
    el.style.transform = transform;
  });
  previewListeners.forEach((listener) => listener());
}

/** Lays the previewed zoom out for real and drops the scaling in the same frame. */
function commitPreview() {
  if (restTimer) clearTimeout(restTimer);
  restTimer = null;
  cancelAnimationFrame(frame);
  frame = 0;
  const view = viewport;
  const done = preview;
  if (!view || !done) return;
  const left = view.scroll.scrollLeft - done.shift;
  flushSync(() =>
    writeZoom(done.percent, { time: left / done.pps, x: view.contentOrigin }, done.byPerson),
  );
  preview = null;
  if (Math.abs(view.scroll.scrollLeft - left) >= 0.5) view.scroll.scrollLeft = left;
  clearScaled(view.scroll);
  previewListeners.forEach((listener) => listener());
}

/** The playhead's place if on screen, else the middle with the playhead brought to it. */
function defaultAnchor(view: TimelineZoomViewport, pps: number, left: number): TimelineZoomAnchor {
  const { currentTime } = usePlayerStore.getState();
  const x = view.contentOrigin + currentTime * pps - left;
  const onScreen = x >= view.contentOrigin && x <= view.scroll.clientWidth;
  return {
    time: currentTime,
    x: onScreen ? x : (view.contentOrigin + view.scroll.clientWidth) / 2,
  };
}

function request(percent: number, anchor: TimelineZoomAnchor | null, byPerson: boolean) {
  const view = viewport;
  const fitPps = usePlayerStore.getState().timelineFitPps;
  if (!view || !(fitPps > 0)) {
    writeZoom(percent, anchor, byPerson);
    return;
  }
  const clamped = clampTimelineZoomPercent(percent, fitPps);
  const pps = (fitPps * clamped) / 100;
  const { scroll, contentOrigin } = view;
  const now = shown(scroll);
  const at = anchor ?? defaultAnchor(view, now.pps, now.left);
  const duration = usePlayerStore.getState().duration || Number.POSITIVE_INFINITY;
  preview ??= {
    percent: clamped,
    pps,
    shift: 0,
    basePps: now.pps,
    mounted: getTimelineRenderTimeRange(scroll, now.pps, contentOrigin, duration),
    byPerson,
  };
  // The content's width at this scale: the fit track (getTimelineFitPps), never narrower.
  const fitTrack = scroll.clientWidth - contentOrigin - 2;
  const width = contentOrigin + fitTrack * Math.max(1, pps / fitPps);
  const maxLeft = Math.max(0, width - scroll.clientWidth);
  const left = Math.max(0, Math.min(maxLeft, at.time * pps + contentOrigin - at.x));
  preview.percent = clamped;
  preview.pps = pps;
  preview.shift = scroll.scrollLeft - left;
  preview.byPerson ||= byPerson;
  if (!frame) frame = requestAnimationFrame(drawPreview);
  if (restTimer) clearTimeout(restTimer);
  restTimer = setTimeout(commitPreview, REST_MS);
  // After the commit timer, so the zoom is laid out before the timeline counts as at rest.
  markTimelineMotion();
}

/** A person's zoom input: previewed each frame, laid out once it rests. */
export function requestTimelineZoom(percent: number, anchor: TimelineZoomAnchor | null = null) {
  stopEase();
  request(percent, anchor, true);
}

/** Lays out a pending zoom now, so what comes next (a press, a scroll) meets the real layout. */
export function settleTimelineZoom(): void {
  if (preview) commitPreview();
}

/** Drops any pending or easing zoom without laying it out, as Fit does. */
export function cancelTimelineZoom(): void {
  stopEase();
  dropPreview();
}

function dropPreview() {
  if (restTimer) clearTimeout(restTimer);
  restTimer = null;
  cancelAnimationFrame(frame);
  frame = 0;
  if (viewport && preview) clearScaled(viewport.scroll);
  preview = null;
}

function stopEase(result: TimelineZoomResult = "cancelled") {
  cancelAnimationFrame(animation);
  animation = 0;
  easingTo = null;
  const done = settle;
  settle = null;
  done?.(result);
}

/** The anchor of the zoom being committed; read once by the timeline as it lays the zoom out. */
export function takeTimelineZoomAnchor(): TimelineZoomAnchor | null {
  const anchor = anchorForCommit;
  anchorForCommit = null;
  return anchor;
}

export function registerTimelineZoomViewport(next: TimelineZoomViewport): () => void {
  viewport = next;
  return () => {
    // Another timeline mounted since keeps its registration.
    if (viewport !== next) return;
    viewport = null;
    // A re-render registers again in the same commit; only a real unmount drops the zoom.
    queueMicrotask(() => {
      if (!viewport) cancelTimelineZoom();
    });
  };
}

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The seconds the timeline shows between its margins: what zoomTimelineToRange would fill. */
export function currentTimelineRange(): { start: number; end: number } | null {
  const view = viewport;
  if (!view) return null;
  const { pps, left } = shown(view.scroll);
  if (!(pps > 0)) return null;
  const x = view.contentOrigin + RANGE_MARGIN_PX;
  const width = Math.max(1, view.scroll.clientWidth - x - RANGE_MARGIN_PX);
  const start = (left + x - view.contentOrigin) / pps;
  return { start, end: start + width / pps };
}

/**
 * Zooms and scrolls so `start`..`end` (seconds) fills the timeline's width, easing there unless
 * `smooth` is false or the person prefers reduced motion. Resolves once the range is laid out,
 * or as "cancelled" when a person zooms, `signal` aborts, or another range zoom starts.
 */
export function zoomTimelineToRange(
  start: number,
  end: number,
  options: { smooth?: boolean; signal?: AbortSignal } = {},
): Promise<TimelineZoomResult> {
  return easeToRange(start, end, options, false);
}

function easeToRange(
  start: number,
  end: number,
  { smooth = true, signal }: { smooth?: boolean; signal?: AbortSignal },
  byPerson: boolean,
): Promise<TimelineZoomResult> {
  const view = viewport;
  const fitPps = usePlayerStore.getState().timelineFitPps;
  stopEase();
  if (!view || !(end > start) || !(fitPps > 0) || signal?.aborted)
    return Promise.resolve("cancelled");
  let resolveThis: (result: TimelineZoomResult) => void = () => {};
  const result = new Promise<TimelineZoomResult>((resolve) => (resolveThis = resolve));
  settle = resolveThis;
  signal?.addEventListener("abort", () => settle === resolveThis && stopEase(), { once: true });
  const x = view.contentOrigin + RANGE_MARGIN_PX;
  const width = Math.max(1, view.scroll.clientWidth - x - RANGE_MARGIN_PX);
  const toPercent = clampTimelineZoomPercent((width / (end - start) / fitPps) * 100, fitPps);
  const finish = () => {
    commitPreview();
    stopEase("done");
  };
  if (!smooth || reducedMotion()) {
    request(toPercent, { time: start, x }, byPerson);
    // Laid out next frame, never inside a caller's render or effect.
    animation = requestAnimationFrame(finish);
    return result;
  }
  const fromPercent = currentTimelineZoomPercent();
  const from = shown(view.scroll);
  const toPps = (fitPps * toPercent) / 100;
  const fromStart = (from.left + x - view.contentOrigin) / from.pps;
  // The one point both views put at the same place on screen; zooming about it, in log space,
  // moves every frame straight from the old view to the new. Equal scales are a plain scroll.
  const shift = from.pps === toPps ? null : (start - fromStart) / (1 / from.pps - 1 / toPps);
  const anchorAt = (k: number): TimelineZoomAnchor =>
    shift === null
      ? { time: fromStart + (start - fromStart) * k, x }
      : { time: fromStart + shift / from.pps, x: x + shift };
  const began = performance.now();
  easingTo = toPercent;
  const step = (now: number) => {
    const t = Math.min(1, Math.max(0, (now - began) / SMOOTH_ZOOM_MS));
    const k = 1 - (1 - t) ** 3;
    request(fromPercent * (toPercent / fromPercent) ** k, anchorAt(k), byPerson);
    if (t < 1) animation = requestAnimationFrame(step);
    else finish();
  };
  animation = requestAnimationFrame(step);
  return result;
}

/**
 * A zoom button: twice or half the scale, eased, keeping the playhead where it is on screen,
 * or centring it when it is off screen.
 */
export function zoomTimelineStep(direction: "in" | "out"): void {
  const { timelineFitPps: fitPps, currentTime } = usePlayerStore.getState();
  const nextPercent = getNextTimelineZoomPercent(
    direction,
    "manual",
    easingTo ?? currentTimelineZoomPercent(),
    fitPps,
  );
  const view = viewport;
  if (!view || !(fitPps > 0)) {
    requestTimelineZoom(nextPercent);
    return;
  }
  const x = view.contentOrigin + RANGE_MARGIN_PX;
  const width = Math.max(1, view.scroll.clientWidth - x - RANGE_MARGIN_PX);
  const nextPps = (fitPps * nextPercent) / 100;
  const span = width / nextPps;
  const now = shown(view.scroll);
  const playheadX = view.contentOrigin + currentTime * now.pps - now.left;
  const onScreen = playheadX >= view.contentOrigin && playheadX <= view.scroll.clientWidth;
  const start = onScreen ? currentTime - (playheadX - x) / nextPps : currentTime - span / 2;
  void easeToRange(start, start + span, {}, true);
}

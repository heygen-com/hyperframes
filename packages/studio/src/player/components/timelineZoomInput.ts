import { usePlayerStore } from "../store/playerStore";
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

const RANGE_MARGIN_PX = 24;
const SMOOTH_ZOOM_MS = 220;

/** How an eased zoom ended: it reached its range, or a person's zoom or the caller stopped it. */
export type TimelineZoomResult = "done" | "cancelled";

let pending: { percent: number; anchor: TimelineZoomAnchor | null; byPerson: boolean } | null =
  null;
let frame = 0;
let anchorForCommit: TimelineZoomAnchor | null = null;
let viewport: TimelineZoomViewport | null = null;
let animation = 0;
let easingTo: number | null = null;
let settle: ((result: TimelineZoomResult) => void) | null = null;

/** The percent the timeline is showing, or will show next frame. */
export function currentTimelineZoomPercent(): number {
  if (pending) return pending.percent;
  const s = usePlayerStore.getState();
  return getTimelineZoomPercent(s.zoomMode, s.manualZoomPercent, s.timelineFitPps);
}

function flush() {
  frame = 0;
  const next = pending;
  pending = null;
  if (!next) return;
  anchorForCommit = next.anchor;
  // One store write per frame: percent, mode and the published scale together, so every reader
  // of the scale renders once with the clips instead of once more after them.
  usePlayerStore.setState((s) => {
    const percent = clampTimelineZoomPercent(next.percent, s.timelineFitPps);
    return {
      zoomMode: "manual",
      manualZoomPercent: percent,
      // Only a person's zoom counts: the timeline and its host read it as the person taking over.
      userZoomCount: s.userZoomCount + (next.byPerson ? 1 : 0),
      timelinePps: (s.timelineFitPps * percent) / 100,
    };
  });
}

function request(percent: number, anchor: TimelineZoomAnchor | null, byPerson: boolean) {
  pending = { percent, anchor, byPerson: byPerson || pending?.byPerson === true };
  if (!frame) frame = requestAnimationFrame(flush);
}

/** A person's zoom input; requests in the same frame collapse to the last, drawn once. */
export function requestTimelineZoom(percent: number, anchor: TimelineZoomAnchor | null = null) {
  stopEase();
  request(percent, anchor, true);
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

export function setTimelineZoomViewport(next: TimelineZoomViewport | null): void {
  viewport = next;
}

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Zooms and scrolls so `start`..`end` (seconds) fills the timeline's width, easing there unless
 * `smooth` is false or the person prefers reduced motion. Resolves once the last step is laid
 * out, or as "cancelled" when a person zooms, `signal` aborts, or another range zoom starts.
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
  const result = new Promise<TimelineZoomResult>((resolve) => (settle = resolve));
  signal?.addEventListener("abort", () => settle && stopEase(), { once: true });
  const x = view.contentOrigin + RANGE_MARGIN_PX;
  const width = Math.max(1, view.scroll.clientWidth - x - RANGE_MARGIN_PX);
  const toPercent = clampTimelineZoomPercent((width / (end - start) / fitPps) * 100, fitPps);
  // Resolved a frame after the last request: its write and layout have run by then.
  const finish = () => {
    animation = requestAnimationFrame(() => stopEase("done"));
  };
  if (!smooth || reducedMotion()) {
    request(toPercent, { time: start, x }, byPerson);
    finish();
    return result;
  }
  const fromPercent = currentTimelineZoomPercent();
  const fromPps = (fitPps * fromPercent) / 100;
  const toPps = (fitPps * toPercent) / 100;
  const fromStart = (view.scroll.scrollLeft + x - view.contentOrigin) / fromPps;
  // The one point both views put at the same place on screen; zooming about it, in log space,
  // moves every frame straight from the old view to the new. Equal scales are a plain scroll.
  const shift = fromPps === toPps ? null : (start - fromStart) / (1 / fromPps - 1 / toPps);
  const anchorAt = (k: number): TimelineZoomAnchor =>
    shift === null
      ? { time: fromStart + (start - fromStart) * k, x }
      : { time: fromStart + shift / fromPps, x: x + shift };
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
  const playheadX =
    view.contentOrigin +
    currentTime * ((fitPps * currentTimelineZoomPercent()) / 100) -
    view.scroll.scrollLeft;
  const onScreen = playheadX >= view.contentOrigin && playheadX <= view.scroll.clientWidth;
  const start = onScreen ? currentTime - (playheadX - x) / nextPps : currentTime - span / 2;
  void easeToRange(start, start + span, {}, true);
}

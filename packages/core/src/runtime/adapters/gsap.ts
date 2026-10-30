import type { RuntimeDeterministicAdapter, RuntimeTimelineLike } from "../types";

type GsapAdapterDeps = {
  getTimeline: () => RuntimeTimelineLike | null;
};

/**
 * Re-renders a timeline already at `t`, silently, from just below (above at 0) so same-time steps apply in authored
 * order. That step skips a keyframed tween at its start and undoes from-values of tweens starting within it: redo both.
 */
export function rerenderGsapTimelineAt(
  timeline: {
    totalTime: (time: number, suppressEvents?: boolean) => unknown;
    totalDuration?: () => number;
    getChildren?: RuntimeTimelineLike["getChildren"];
  },
  t: number,
  structure?: GsapStructureKey,
): void {
  timeline.totalDuration?.();
  const children = timeline.getChildren?.(false, true, true) ?? [];
  const marked = landingMarksOf(timeline, structure, t).map(
    (child) => [child, child.ratio, child._zTime, child._act] as const,
  );
  const skipped = childrenStartingAfter(children, t).map((child) => [child, child._ts] as const);
  const parents = new Set<GsapParent>();
  for (const [child] of skipped) {
    for (let parent = child.parent; parent && !parents.has(parent); parent = parent.parent)
      parents.add(parent);
  }
  const lengths = [...parents].map(
    (parent) => [parent, parent._dur, parent._tDur, parent._end, parent._dirty] as const,
  );
  for (const [child] of skipped) child._ts = 0;
  try {
    renderOntoInAuthoredOrder(timeline, children, t, structure);
  } finally {
    for (const [child, timeScale] of skipped) child._ts = timeScale;
    for (const [parent, dur, tDur, end, dirty] of lengths) {
      Object.assign(parent, { _dur: dur, _tDur: tDur, _end: end, _dirty: dirty });
    }
  }
  for (const [child, ratio, zTime, active] of marked) {
    child.ratio = ratio;
    child._zTime = zTime;
    child._act = active;
  }
}

function renderOntoInAuthoredOrder(
  timeline: Parameters<typeof rerenderGsapTimelineAt>[0],
  children: unknown[],
  t: number,
  structure: GsapStructureKey | undefined,
): void {
  const below = t >= REDRAW_STEP;
  timeline.totalTime(below ? t - REDRAW_STEP : t + REDRAW_STEP, true);
  primeTweensStartingAt(children, t, below ? REDRAW_STEP : 0);
  timeline.totalTime(t, true);
  if (!below && structure) reapplyStepsInAuthoredOrder(timeline, structure, t);
}

function reapplyStepsInAuthoredOrder(
  timeline: { getChildren?: RuntimeTimelineLike["getChildren"] },
  structure: GsapStructureKey,
  t: number,
): void {
  for (const step of stepsAt(timeline, structure, t)) {
    const { ratio, _zTime, _act } = step;
    step.render(0, true, true);
    Object.assign(step, { ratio, _zTime, _act });
  }
}

type GsapRenderState = { _initted?: number };

function gsapNeverRendered(timeline: RuntimeTimelineLike): boolean {
  const own = timeline as { _first?: { parent?: unknown } | null };
  const [child] =
    "_first" in own
      ? own._first
        ? [own._first]
        : []
      : ((timeline.getChildren?.(false, true, true) ?? []) as { parent?: unknown }[]);
  const rendered = child?.parent as GsapRenderState | undefined;
  return rendered !== undefined && !rendered._initted;
}

const lastRenderSeek = new WeakMap<object, number>();
const sharedPropertySpans = new WeakMap<object, { version: string; spans: [number, number][] }>();
const NOT_PROPERTIES = new Set([
  "duration",
  "ease",
  "delay",
  "repeat",
  "repeatDelay",
  "yoyo",
  "yoyoEase",
  "repeatRefresh",
  "stagger",
  "overwrite",
  "immediateRender",
  "lazy",
  "id",
  "paused",
  "reversed",
  "callbackScope",
  "runBackwards",
  "data",
  "inherit",
  "defaults",
]);
const EVERY_PROPERTY = new Set(["keyframes", "startAt", "transform"]);
const SAME_PROPERTY: Record<string, string> = {
  scaleX: "scale",
  scaleY: "scale",
  autoAlpha: "opacity",
  rotate: "rotation",
};

type PlacedTween = GsapPlaced & {
  vars?: Record<string, unknown>;
  targets?: () => object[];
};
type PropertyWrite = { start: number; end: number; properties: Set<string> | null };

function propertiesWritten(vars: Record<string, unknown>): Set<string> | null {
  const properties = new Set<string>();
  for (const key of Object.keys(vars)) {
    if (EVERY_PROPERTY.has(key)) return null;
    if (!key.startsWith("on") && !NOT_PROPERTIES.has(key))
      properties.add(SAME_PROPERTY[key] ?? key);
  }
  return properties;
}

function spanOnParent(
  [start, length]: [number, number],
  parent: GsapPlaced,
): [number, number] | null {
  const speed = Number(parent._ts);
  if (!speed) return null;
  const [from, span] =
    parent._repeat || speed < 0
      ? [0, Number(parent.totalDuration?.() ?? Infinity)]
      : [start, length];
  return [Number(parent._start) + from / Math.abs(speed), span / Math.abs(speed)];
}

function writeOf(tween: PlacedTween, timeline: RuntimeTimelineLike): PropertyWrite | null {
  let span: [number, number] | null = [Number(tween._start), Number(tween.totalDuration?.() ?? 0)];
  for (let parent = tween.parent; span && parent && parent !== timeline; parent = parent.parent) {
    span = spanOnParent(span, parent);
  }
  return (
    span && {
      start: span[0],
      end: span[0] + span[1],
      properties: propertiesWritten(tween.vars ?? {}),
    }
  );
}

function spansWhereTweensShareAProperty(timeline: RuntimeTimelineLike): [number, number][] {
  const writes = new Map<object, PropertyWrite[]>();
  for (const child of timeline.getChildren?.(true, true, false) ?? []) {
    const tween = child as PlacedTween;
    const write = writeOf(tween, timeline);
    if (!write) continue;
    for (const target of tween.targets?.() ?? [])
      writes.set(target, [...(writes.get(target) ?? []), write]);
  }
  return [...writes.values()].flatMap(overlapsOnOneTarget);
}

function sharesAProperty(a: PropertyWrite, b: PropertyWrite): boolean {
  return !a.properties || !b.properties || [...a.properties].some((p) => b.properties!.has(p));
}

function overlapsOnOneTarget(writes: PropertyWrite[]): [number, number][] {
  const spans: [number, number][] = [];
  writes.sort((x, y) => x.start - y.start);
  writes.forEach((first, i) => {
    for (const second of writes.slice(i + 1)) {
      if (second.start >= first.end) break;
      if (sharesAProperty(first, second))
        spans.push([second.start, Math.min(first.end, second.end)]);
    }
  });
  return spans;
}

function framesSkippedSinceLastSeek(
  timeline: RuntimeTimelineLike,
  t: number,
  fps: number,
  version = "",
): number[] {
  const last = lastRenderSeek.get(timeline);
  lastRenderSeek.set(timeline, t);
  const skipped =
    last === undefined ? Math.floor(t * fps + 1e-6) : Math.ceil((t - last) * fps - 1e-6) - 1;
  if (skipped < 1) return [];
  let cached = sharedPropertySpans.get(timeline);
  if (cached?.version !== version) {
    cached = { version, spans: spansWhereTweensShareAProperty(timeline) };
    sharedPropertySpans.set(timeline, cached);
  }
  const replay = new Set<number>();
  for (const [from, to] of cached.spans) {
    const nearest = Math.max(1, Math.ceil((t - to) * fps - 1e-6) - 1);
    const farthest = Math.min(skipped, Math.floor((t - from) * fps + 1e-6) + 1);
    for (let back = nearest; back <= farthest; back++) replay.add(back);
  }
  return [...replay].sort((x, y) => y - x).map((back) => t - back / fps);
}

export function seekGsapTimeline(
  timeline: RuntimeTimelineLike,
  t: number,
  suppressEvents: boolean,
  structure?: GsapStructureKey,
  renderFps?: number,
): boolean {
  if (typeof timeline.totalTime !== "function") {
    if (typeof timeline.seek === "function") timeline.seek(t, suppressEvents);
    return false;
  }
  if (renderFps) {
    for (const time of framesSkippedSinceLastSeek(timeline, t, renderFps, structure?.version)) {
      timeline.totalTime(time, suppressEvents);
    }
  }
  const from = Number(timeline.totalTime());
  timeline.totalTime(t, suppressEvents);
  if (t < from && structure) reapplyStepsInAuthoredOrder(timeline, structure, t);
  if (from !== t || !gsapNeverRendered(timeline)) return false;
  rerenderGsapTimelineAt(
    {
      totalTime: timeline.totalTime.bind(timeline),
      totalDuration: timeline.totalDuration?.bind(timeline),
      getChildren: timeline.getChildren?.bind(timeline),
    },
    t,
    structure,
  );
  return true;
}

type GsapParent = {
  _dur: number;
  _tDur: number;
  _end: number;
  _dirty: number;
  parent?: GsapParent | null;
};

type GsapChild = Pick<GsapAnimation, "startTime" | "getChildren"> & {
  _ts: number;
  parent?: GsapParent | null;
  endTime: () => number;
  time: () => number;
};

const PLAYHEAD_FLOAT_NOISE = 1e-6;

function childrenStartingAfter(
  children: unknown[],
  time: number,
  found: GsapChild[] = [],
): GsapChild[] {
  for (const child of children as GsapChild[]) {
    if (child.startTime() > time + PLAYHEAD_FLOAT_NOISE) found.push(child);
    else if (child.getChildren && child.endTime() >= time)
      childrenStartingAfter(child.getChildren(false, true, true), child.time(), found);
  }
  return found;
}

type GsapLandingMarks = { ratio: number; _zTime?: number; _act?: number };

type GsapStep = GsapLandingMarks & {
  render: (totalTime: number, suppressEvents: boolean, force: boolean) => unknown;
};

function childrenWithLandingMarksIn(timeline: {
  getChildren?: RuntimeTimelineLike["getChildren"];
}): GsapLandingMarks[] {
  return (timeline.getChildren?.(true, true, true) ?? []).filter((child) => {
    const animation = child as { totalDuration?: () => number; getChildren?: unknown };
    return typeof animation.getChildren === "function" || animation.totalDuration?.() === 0;
  }) as unknown as GsapLandingMarks[];
}

export type GsapStructureKey = { owner: object; version: string };

type PlacedMarks = {
  version: string;
  always: GsapLandingMarks[];
  points: { at: number; mark: GsapLandingMarks }[];
};

const landingMarksCache = new WeakMap<object, PlacedMarks>();

const LANDING_MARK_REACH = 0.05;

type GsapPlaced = {
  _start?: number;
  _ts?: number;
  _repeat?: number;
  parent?: GsapPlaced | null;
  getChildren?: unknown;
  totalDuration?: () => number;
};

function startOnOwner(child: GsapPlaced, owner: object): number | null {
  let at = Number(child._start);
  for (let parent = child.parent; parent && parent !== owner; parent = parent.parent) {
    if (parent._repeat || !parent._ts) return null;
    at = Number(parent._start) + at / parent._ts;
  }
  return Number.isFinite(at) ? at : null;
}

function placeLandingMarks(
  timeline: { getChildren?: RuntimeTimelineLike["getChildren"] },
  structure: GsapStructureKey,
): PlacedMarks {
  const placed: PlacedMarks = { version: structure.version, always: [], points: [] };
  for (const mark of childrenWithLandingMarksIn(timeline)) {
    const child = mark as unknown as GsapPlaced;
    const at =
      typeof child.getChildren === "function" ? null : startOnOwner(child, structure.owner);
    if (at === null) placed.always.push(mark);
    else placed.points.push({ at, mark });
  }
  placed.points.sort((a, b) => a.at - b.at);
  return placed;
}

function firstPointFrom(points: PlacedMarks["points"], time: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.at < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function placedLandingMarks(
  timeline: { getChildren?: RuntimeTimelineLike["getChildren"] },
  structure: GsapStructureKey,
): PlacedMarks {
  let placed = landingMarksCache.get(structure.owner);
  if (placed?.version !== structure.version) {
    placed = placeLandingMarks(timeline, structure);
    landingMarksCache.set(structure.owner, placed);
  }
  return placed;
}

function stepsAt(
  timeline: { getChildren?: RuntimeTimelineLike["getChildren"] },
  structure: GsapStructureKey,
  t: number,
): GsapStep[] {
  const { points } = placedLandingMarks(timeline, structure);
  const steps: GsapStep[] = [];
  for (let i = firstPointFrom(points, t - PLAYHEAD_FLOAT_NOISE); i < points.length; i++) {
    if (points[i]!.at > t + PLAYHEAD_FLOAT_NOISE) break;
    steps.push(points[i]!.mark as GsapStep);
  }
  return steps;
}

function landingMarksOf(
  timeline: { getChildren?: RuntimeTimelineLike["getChildren"] },
  structure: GsapStructureKey | undefined,
  t: number,
): GsapLandingMarks[] {
  if (!structure) return childrenWithLandingMarksIn(timeline);
  const placed = placedLandingMarks(timeline, structure);
  const { points } = placed;
  const near = [...placed.always];
  const last = t + LANDING_MARK_REACH;
  for (let i = firstPointFrom(points, t - LANDING_MARK_REACH); i < points.length; i++) {
    if (points[i]!.at > last) break;
    near.push(points[i]!.mark);
  }
  return near;
}

type GsapAnimation = {
  startTime: () => number;
  timeScale: () => number;
  totalDuration: () => number;
  paused: () => boolean;
  render: (totalTime: number, suppressEvents: boolean) => unknown;
  vars?: { keyframes?: unknown };
  _startAt?:
    | 0
    | { render: (totalTime: number, suppressEvents: boolean, force: boolean) => unknown };
  getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => unknown[];
  timeline?: Pick<GsapAnimation, "getChildren">;
};

const BELOW_GSAP_TIME_RESOLUTION = 2e-8;

const REDRAW_STEP = 0.001;

const playsForward = (value: unknown): value is GsapAnimation => {
  const animation = value as GsapAnimation | null;
  return (
    typeof animation?.render === "function" &&
    typeof animation.startTime === "function" &&
    typeof animation.paused === "function" &&
    typeof animation.timeScale === "function" &&
    animation.timeScale() > 0 &&
    !animation.paused()
  );
};

function primedAtItsStart(tween: GsapAnimation): boolean {
  if (tween.vars?.keyframes) {
    tween.render(BELOW_GSAP_TIME_RESOLUTION, true);
    tween.render(-BELOW_GSAP_TIME_RESOLUTION, true);
  }
  if (tween._startAt) tween._startAt.render(BELOW_GSAP_TIME_RESOLUTION, true, true);
  return Boolean(tween.vars?.keyframes || tween._startAt);
}

function primeTweensStartingAt(
  children: unknown[],
  time: number,
  stepBelowInTheirTime: number,
): void {
  for (const child of children.filter(playsForward)) {
    const local = (time - child.startTime()) * child.timeScale();
    if (Math.abs(local) < 1e-9 && primedAtItsStart(child)) continue;
    if (local > 0) primeStartedTween(child, local, stepBelowInTheirTime * child.timeScale());
  }
}

function primeStartedTween(child: GsapAnimation, local: number, stepBelow: number): void {
  if (local < stepBelow && child._startAt)
    child._startAt.render(BELOW_GSAP_TIME_RESOLUTION, true, true);
  const nested = child.getChildren ? child : child.timeline;
  if (nested?.getChildren && local <= child.totalDuration()) {
    primeTweensStartingAt(nested.getChildren(false, true, true), local, stepBelow);
  }
}

export function createGsapAdapter(deps: GsapAdapterDeps): RuntimeDeterministicAdapter {
  return {
    name: "gsap",
    discover: () => {},
    seek: (ctx) => {
      const timeline = deps.getTimeline();
      if (!timeline) return;
      timeline.pause();
      const safeTime = Math.max(0, Number(ctx.time) || 0);
      const suppressEvents = ctx.suppressEvents === true;
      if (typeof timeline.totalTime === "function") {
        timeline.totalTime(safeTime, suppressEvents);
        rerenderGsapTimelineAt(
          {
            totalTime: timeline.totalTime.bind(timeline),
            totalDuration: timeline.totalDuration?.bind(timeline),
            getChildren: timeline.getChildren?.bind(timeline),
          },
          safeTime,
        );
      } else {
        timeline.seek(safeTime, suppressEvents);
      }
    },
    pause: () => {
      const timeline = deps.getTimeline();
      if (!timeline) return;
      timeline.pause();
    },
  };
}

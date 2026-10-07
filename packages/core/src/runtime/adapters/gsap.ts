import type { RuntimeDeterministicAdapter, RuntimeTimelineLike } from "../types";

type GsapAdapterDeps = {
  getTimeline: () => RuntimeTimelineLike | null;
};

/**
 * A from-below refresh keeps same-time steps in authored order; keyframes at their start need priming.
 * Replay fromTo startAt in that order across the rewind: earlier writers must not override from-only values.
 */
export function rerenderGsapTimelineAt(
  timeline: {
    totalTime: (time: number, suppressEvents?: boolean) => unknown;
    totalDuration?: () => number;
    getChildren?: RuntimeTimelineLike["getChildren"];
  },
  t: number,
): void {
  timeline.totalDuration?.();
  const children = timeline.getChildren?.(false, true, true) ?? [];
  const marked = childrenWithLandingMarksIn(timeline).map(
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
  const fromTweens = t >= 0.001 ? initializedFromTweensCrossedByRewind(children, t) : [];
  const renders = fromTweens.map(
    (child) => [child, child.render, Object.getOwnPropertyDescriptor(child, "render")] as const,
  );
  try {
    for (const [child, render] of renders) {
      child.render = renderWithFromState(child, render);
    }
    timeline.totalTime(t >= 0.001 ? t - 0.001 : t + 0.001, true);
    primeTweensStartingAt(children, t);
    timeline.totalTime(t, true);
  } finally {
    for (const [child, , descriptor] of renders) {
      restoreRenderDescriptor(child, descriptor);
    }
    for (const [child, timeScale] of skipped) child._ts = timeScale;
    for (const [parent, dur, tDur, end, dirty] of lengths) {
      Object.assign(parent, { _dur: dur, _tDur: tDur, _end: end, _dirty: dirty });
    }
    for (const [child, ratio, zTime, active] of marked) {
      child.ratio = ratio;
      child._zTime = zTime;
      child._act = active;
    }
  }
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

function childrenWithLandingMarksIn(timeline: {
  getChildren?: RuntimeTimelineLike["getChildren"];
}): GsapLandingMarks[] {
  return (timeline.getChildren?.(true, true, true) ?? []).filter((child) => {
    const animation = child as { totalDuration?: () => number; getChildren?: unknown };
    return typeof animation.getChildren === "function" || animation.totalDuration?.() === 0;
  }) as unknown as GsapLandingMarks[];
}

type GsapAnimation = {
  startTime: () => number;
  timeScale: () => number;
  totalDuration: () => number;
  paused: () => boolean;
  render: (totalTime: number, suppressEvents: boolean, force?: boolean) => unknown;
  vars?: { keyframes?: unknown; startAt?: unknown };
  time?: () => number;
  _tTime?: number;
  _startAt?:
    | 0
    | { render: (totalTime: number, suppressEvents: boolean, force: boolean) => unknown };
  getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => unknown[];
  timeline?: Pick<GsapAnimation, "getChildren" | "time">;
};

const BELOW_GSAP_TIME_RESOLUTION = 2e-8;

function restoreRenderDescriptor(child: GsapAnimation, descriptor?: PropertyDescriptor): void {
  if (descriptor) Object.defineProperty(child, "render", descriptor);
  else Reflect.deleteProperty(child, "render");
}

function renderWithFromState(
  child: GsapAnimation,
  render: GsapAnimation["render"],
): GsapAnimation["render"] {
  return function (time, suppressEvents, force) {
    if (time >= 0 && child._startAt) {
      const renderedTime = child._tTime;
      child._startAt.render(0, true, true);
      force ||= child._tTime !== renderedTime;
    }
    return render.call(child, time, suppressEvents, force);
  };
}

function hasInitializedFromState(child: GsapAnimation): boolean {
  return Boolean(
    child.vars?.startAt && child._startAt && typeof child._startAt.render === "function",
  );
}

function initializedFromTweensCrossedByRewind(
  children: unknown[],
  time: number,
  rewind = 0.001,
  found: GsapAnimation[] = [],
): GsapAnimation[] {
  for (const child of children.filter(playsForward)) {
    const local = (time - child.startTime()) * child.timeScale();
    if (local < -PLAYHEAD_FLOAT_NOISE) continue;
    const childRewind = rewind * child.timeScale();
    if (local < childRewind && hasInitializedFromState(child)) found.push(child);
    const nested = child.getChildren ? child : child.timeline;
    if (nested?.getChildren)
      initializedFromTweensCrossedByRewind(
        nested.getChildren(false, true, true),
        nested.time ? nested.time() : local,
        childRewind,
        found,
      );
  }
  return found;
}

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

function primeTweensStartingAt(children: unknown[], time: number): void {
  for (const child of children.filter(playsForward)) {
    const local = (time - child.startTime()) * child.timeScale();
    if (Math.abs(local) < 1e-9 && primedAtItsStart(child)) continue;
    const nested = child.getChildren ? child : child.timeline;
    if (nested?.getChildren && local > 0 && local <= child.totalDuration()) {
      primeTweensStartingAt(nested.getChildren(false, true, true), local);
    }
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

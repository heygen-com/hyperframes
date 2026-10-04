import type { RuntimeDeterministicAdapter, RuntimeTimelineLike } from "../types";

type GsapAdapterDeps = {
  getTimeline: () => RuntimeTimelineLike | null;
};

/**
 * Re-renders a timeline already at `t`, silently, from just below (above at 0) so same-time steps apply in authored
 * order. That step skips a keyframed tween already at its start, so each one is first moved across its start alone.
 * Children starting after `t` sit out both steps: stepping below `t` would draw a reversed one at its end.
 */
export function rerenderGsapTimelineAt(
  timeline: {
    totalTime: (time: number, suppressEvents?: boolean) => unknown;
    totalDuration?: () => number;
    getChildren?: RuntimeTimelineLike["getChildren"];
  },
  t: number,
): void {
  // A stale duration is recomputed from children's time scales, so settle it before holding any at 0.
  timeline.totalDuration?.();
  const children = timeline.getChildren?.(false, true, true) ?? [];
  const steps = zeroDurationChildrenIn(timeline).map(
    (step) => [step, step.ratio, step._zTime] as const,
  );
  const held = childrenStartingAfter(children, t).map((child) => [child, child._ts] as const);
  for (const [child] of held) child._ts = 0;
  try {
    timeline.totalTime(t >= 0.001 ? t - 0.001 : t + 0.001, true);
    primeKeyframedTweensStartingAt(children, t);
    timeline.totalTime(t, true);
  } finally {
    for (const [child, timeScale] of held) child._ts = timeScale;
  }
  // GSAP reads these to decide whether a zero-duration child fires or redraws when next reached.
  for (const [step, ratio, zTime] of steps) {
    step.ratio = ratio;
    step._zTime = zTime;
  }
}

type GsapChild = Pick<GsapAnimation, "startTime" | "getChildren"> & {
  _ts: number;
  endTime: () => number;
  time: () => number;
};

// Nested local times carry float noise far below this; a child starting at the playhead stays in.
const AFTER_PLAYHEAD = 1e-6;

/** Children starting after `time`, also inside nested timelines playing over it. GSAP skips one at time scale 0. */
function childrenStartingAfter(
  children: unknown[],
  time: number,
  found: GsapChild[] = [],
): GsapChild[] {
  for (const child of children as GsapChild[]) {
    if (child.startTime() > time + AFTER_PLAYHEAD) found.push(child);
    else if (child.getChildren && child.endTime() >= time)
      childrenStartingAfter(child.getChildren(false, true, true), child.time(), found);
  }
  return found;
}

type GsapZeroDurationInternals = { ratio: number; _zTime?: number };

function zeroDurationChildrenIn(timeline: {
  getChildren?: RuntimeTimelineLike["getChildren"];
}): GsapZeroDurationInternals[] {
  return (timeline.getChildren?.(true, true, true) ?? []).filter(
    (child) => (child as { totalDuration?: () => number }).totalDuration?.() === 0,
  ) as unknown as GsapZeroDurationInternals[];
}

type GsapAnimation = {
  startTime: () => number;
  timeScale: () => number;
  totalDuration: () => number;
  paused: () => boolean;
  render: (totalTime: number, suppressEvents: boolean) => unknown;
  vars?: { keyframes?: unknown };
  getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => unknown[];
};

const BELOW_GSAP_TIME_RESOLUTION = 2e-8;

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

function primeKeyframedTweensStartingAt(children: unknown[], time: number): void {
  for (const child of children.filter(playsForward)) {
    const local = (time - child.startTime()) * child.timeScale();
    if (Math.abs(local) < 1e-9 && child.vars?.keyframes) {
      child.render(BELOW_GSAP_TIME_RESOLUTION, true);
      child.render(-BELOW_GSAP_TIME_RESOLUTION, true);
    } else if (child.getChildren && local > 0 && local <= child.totalDuration()) {
      primeKeyframedTweensStartingAt(child.getChildren(false, true, true), local);
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

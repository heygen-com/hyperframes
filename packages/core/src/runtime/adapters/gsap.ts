import type { RuntimeDeterministicAdapter, RuntimeTimelineLike } from "../types";

type GsapAdapterDeps = {
  getTimeline: () => RuntimeTimelineLike | null;
};

/**
 * Re-renders a timeline already at `t`, silently, from just below (above at 0) so same-time steps apply in authored
 * order. That step skips a keyframed tween already at its start, so each one is first moved across its start alone.
 */
export function rerenderGsapTimelineAt(
  timeline: {
    totalTime: (time: number, suppressEvents?: boolean) => unknown;
    getChildren?: RuntimeTimelineLike["getChildren"];
  },
  t: number,
): void {
  const children = timeline.getChildren?.(false, true, true) ?? [];
  const firedStates = callTweensIn(timeline).map(
    (call) => [call, call.ratio, call._zTime] as const,
  );
  timeline.totalTime(t >= 0.001 ? t - 0.001 : t + 0.001, true);
  primeKeyframedTweensStartingAt(children, t);
  timeline.totalTime(t, true);
  for (const [call, ratio, zTime] of firedStates) Object.assign(call, { ratio, _zTime: zTime });
}

type GsapCallInternals = { ratio: number; _zTime?: number };

export const GSAP_CALLBACK_NAMES = [
  "onStart",
  "onUpdate",
  "onComplete",
  "onReverseComplete",
  "onRepeat",
];

function callTweensIn(timeline: {
  getChildren?: RuntimeTimelineLike["getChildren"];
}): GsapCallInternals[] {
  return (timeline.getChildren?.(true, true, false) ?? []).filter((child) => {
    const tween = child as { totalDuration?: () => number; vars?: Record<string, unknown> };
    return (
      tween.totalDuration?.() === 0 &&
      GSAP_CALLBACK_NAMES.some((name) => typeof tween.vars?.[name] === "function")
    );
  }) as unknown as GsapCallInternals[];
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

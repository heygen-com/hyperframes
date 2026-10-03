import type { RuntimeDeterministicAdapter, RuntimeTimelineLike } from "../types";

type GsapAdapterDeps = {
  getTimeline: () => RuntimeTimelineLike | null;
};

/**
 * Re-renders a timeline already at `t`, silently, from just below (above at 0) so same-time steps apply in authored
 * order. That step skips a keyframes or stagger tween already at its start, so each one re-crosses its start alone.
 */
export function rerenderGsapTimelineAt(
  timeline: {
    totalTime: (time: number, suppressEvents?: boolean) => unknown;
    getChildren?: RuntimeTimelineLike["getChildren"];
  },
  t: number,
): void {
  timeline.totalTime(t >= 0.001 ? t - 0.001 : t + 0.001, true);
  timeline.totalTime(t, true);
  recrossTweensStartingAt(timeline.getChildren?.(false, true, true) ?? [], t);
}

type GsapAnimation = {
  startTime: () => number;
  timeScale: () => number;
  totalDuration: () => number;
  render: (totalTime: number, suppressEvents: boolean) => unknown;
  timeline?: unknown;
  getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => unknown[];
};

const isGsapAnimation = (value: unknown): value is GsapAnimation =>
  typeof (value as GsapAnimation | null)?.render === "function" &&
  typeof (value as GsapAnimation).startTime === "function" &&
  typeof (value as GsapAnimation).timeScale === "function";

function recrossTweensStartingAt(children: unknown[], time: number): void {
  for (const child of children.filter(isGsapAnimation)) {
    const local = (time - child.startTime()) * child.timeScale();
    if (Math.abs(local) < 1e-9 && child.timeline) {
      child.render(0.001, true);
      child.render(-0.001, true);
      child.render(0, true);
    } else if (child.getChildren && local > 0 && local <= child.totalDuration()) {
      recrossTweensStartingAt(child.getChildren(false, true, true), local);
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

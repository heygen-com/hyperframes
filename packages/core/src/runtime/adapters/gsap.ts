import type {
  RuntimeDeterministicAdapter,
  RuntimeTimelineChildLike,
  RuntimeTimelineLike,
} from "../types";

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
  recrossTweensStartingAt(timeline, t);
}

function recrossTweensStartingAt(
  timeline: Pick<RuntimeTimelineChildLike, "getChildren">,
  time: number,
): void {
  for (const child of timeline.getChildren?.(false, true, true) ?? []) {
    const local = (time - (child.startTime?.() ?? 0)) * (child.timeScale?.() ?? 1);
    if (Math.abs(local) < 1e-9 && child.timeline && child.render) {
      child.render(0.001, true);
      child.render(-0.001, true);
      child.render(0, true);
    } else if (child.getChildren && local > 0 && local <= (child.totalDuration?.() ?? 0)) {
      recrossTweensStartingAt(child, local);
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

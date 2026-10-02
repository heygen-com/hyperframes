import type { RuntimeDeterministicAdapter, RuntimeTimelineLike } from "../types";

type GsapAdapterDeps = {
  getTimeline: () => RuntimeTimelineLike | null;
};

/**
 * Re-renders a timeline already moved to `t`, arriving from just below: GSAP applies zero-duration
 * steps that share a time in authored order only on a forward arrival. Both moves are silent.
 */
export function rerenderGsapTimelineAt(
  timeline: { totalTime: (time: number, suppressEvents?: boolean) => unknown },
  t: number,
): void {
  timeline.totalTime(Math.max(0, t - 0.001), true);
  timeline.totalTime(t, true);
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
        rerenderGsapTimelineAt({ totalTime: timeline.totalTime.bind(timeline) }, safeTime);
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

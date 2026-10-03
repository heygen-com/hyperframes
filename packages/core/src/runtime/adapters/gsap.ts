import type { RuntimeDeterministicAdapter, RuntimeTimelineLike } from "../types";

type GsapAdapterDeps = {
  getTimeline: () => RuntimeTimelineLike | null;
};

/**
 * Re-renders a timeline already at `t`, silently. A forced render at the same time walks the children
 * forward in authored order and re-renders each one, including a child that starts exactly at `t`.
 */
export function rerenderGsapTimelineAt(timeline: Pick<RuntimeTimelineLike, "render">, t: number): void {
  timeline.render?.(t, true, true);
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
        rerenderGsapTimelineAt(timeline, safeTime);
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

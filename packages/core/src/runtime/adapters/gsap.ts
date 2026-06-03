import type { RuntimeDeterministicAdapter, RuntimeTimelineLike } from "../types";

type GsapAdapterDeps = {
  getTimeline: () => RuntimeTimelineLike | null;
};

export function createGsapAdapter(deps: GsapAdapterDeps): RuntimeDeterministicAdapter {
  return {
    name: "gsap",
    discover: () => {},
    seek: (ctx) => {
      const timeline = deps.getTimeline();
      if (!timeline) return;
      timeline.pause();
      const safeTime = Math.max(0, Number(ctx.time) || 0);
      if (typeof timeline.totalTime === "function") {
        // GSAP 3.x skips rendering when the new totalTime equals _tTime.
        // Nudge first to force a dirty state, then seek to the exact time.
        timeline.totalTime(safeTime + 0.001, true);
        timeline.totalTime(safeTime, false);
      } else {
        timeline.seek(safeTime, false);
      }
    },
    pause: () => {
      const timeline = deps.getTimeline();
      if (!timeline) return;
      timeline.pause();
    },
  };
}

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

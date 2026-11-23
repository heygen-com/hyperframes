import type gsap from "gsap";
import type { RuntimeTimelineLike } from "../types";

/** The shape the producer's GSAP stub hands a composition instead of the timeline it created. */
export function producerStandIn(real: gsap.core.Timeline): RuntimeTimelineLike {
  const standIn = {
    __hfReal: real,
    __hfIsProxy: true,
    totalTime: (...args: [number, boolean?]) =>
      args.length > 0 ? (real.totalTime(...args), standIn) : real.totalTime(),
    totalDuration: () => real.totalDuration(),
    getChildren: (...args: Parameters<typeof real.getChildren>) => real.getChildren(...args),
  };
  return standIn as unknown as RuntimeTimelineLike;
}

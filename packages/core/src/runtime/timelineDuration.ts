import { swallow } from "./diagnostics";
import type { RuntimeTimelineLike } from "./types";

type ChildTimeline = {
  paused?: () => boolean;
  startTime?: () => number;
  totalDuration?: () => number;
  timeScale?: () => number;
};

const pausedChildEnd = (child: ChildTimeline): number =>
  child.paused?.() === true
    ? (child.startTime?.() ?? 0) +
      (child.totalDuration?.() ?? 0) / Math.abs(child.timeScale?.() || 1)
    : 0;

/** A timeline's finite length, counting paused child timelines; a partial or throwing entry reads as null. */
export function readTimelineDurationSeconds(
  timeline: Pick<RuntimeTimelineLike, "duration" | "getChildren"> | null | undefined,
): number | null {
  try {
    if (typeof timeline?.duration !== "function") return null;
    const held: unknown = timeline.getChildren?.(false, false, true);
    const children = Array.isArray(held) ? (held as ChildTimeline[]) : [];
    const seconds = Math.max(Number(timeline.duration()), ...children.map(pausedChildEnd));
    return Number.isFinite(seconds) ? seconds : null;
  } catch (err) {
    swallow("runtime.timelineDuration", err);
    return null;
  }
}

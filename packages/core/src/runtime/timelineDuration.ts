import { swallow } from "./diagnostics";
import type { RuntimeTimelineLike } from "./types";

/** A registered timeline's finite duration(); a partial, throwing or non-numeric entry reads as null. */
export function readTimelineDurationSeconds(
  timeline: Pick<RuntimeTimelineLike, "duration"> | null | undefined,
): number | null {
  try {
    if (typeof timeline?.duration !== "function") return null;
    const seconds = Number(timeline.duration());
    return Number.isFinite(seconds) ? seconds : null;
  } catch (err) {
    swallow("runtime.timelineDuration", err);
    return null;
  }
}

import { quantizeTimeToFrame } from "./frameTiming.js";

/** Structural subset of a paused GSAP timeline registered in window.__timelines. */
export interface TimelineLike {
  duration(): number;
  seek(timeSeconds: number, suppressEvents?: boolean): unknown;
  pause(): unknown;
}

export type TimelineRegistry = Record<string, TimelineLike>;

export function resolveTimelineRegistry(root: Element): TimelineRegistry {
  const win = root.ownerDocument?.defaultView as
    | (Window & { __timelines?: TimelineRegistry })
    | null;
  return win?.__timelines ?? {};
}

export function masterTimeline(
  registry: TimelineRegistry,
  compositionId: string | null,
): TimelineLike | null {
  if (compositionId != null && registry[compositionId]) {
    return registry[compositionId];
  }
  return Object.values(registry)[0] ?? null;
}

export function resolveDuration(
  registry: TimelineRegistry,
  compositionId: string | null,
  override?: number,
): number {
  if (override != null && Number.isFinite(override) && override > 0) {
    return override;
  }
  const duration = masterTimeline(registry, compositionId)?.duration() ?? 0;
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

/**
 * Position every registered timeline at the quantized frame time, paused —
 * mirrors the producer's seekMasterAndSiblingTimelinesDeterministically so a
 * browser export samples the exact same states as a server render.
 */
export function seekTimelines(
  registry: TimelineRegistry,
  timeSeconds: number,
  fps: number,
): number {
  const quantized = quantizeTimeToFrame(timeSeconds, fps);
  for (const timeline of Object.values(registry)) {
    timeline.pause();
    timeline.seek(quantized, true);
  }
  return quantized;
}

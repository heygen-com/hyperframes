import type { TimelineElement } from "../player";
import { resolvePlacement } from "../player/components/timelineCollision";
import { resolveTimelineAssetDrop } from "../player/components/timelineLayout";

export const TIMELINE_COMPOSITION_MIME = "application/x-hyperframes-composition";

export interface TimelineCompositionPayload {
  sourcePath: string;
}

export function parseTimelineCompositionPayload(raw: string): TimelineCompositionPayload | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || !("sourcePath" in value)) return null;
    const sourcePath = value.sourcePath;
    return typeof sourcePath === "string" && sourcePath.trim() ? { sourcePath } : null;
  } catch {
    return null;
  }
}

export function resolveTimelineCompositionDrop(
  input: Parameters<typeof resolveTimelineAssetDrop>[0] & {
    elements: TimelineElement[];
    duration: number;
  },
  clientX: number,
  clientY: number,
): { start: number; track: number } {
  const pointer = resolveTimelineAssetDrop(
    { ...input, clampStartToDuration: false },
    clientX,
    clientY,
  );
  const placement = resolvePlacement({
    elements: input.elements,
    desiredTrack: pointer.track,
    start: pointer.start,
    duration: input.duration,
    trackOrder: input.trackOrder,
    excludeKey: null,
  });
  return {
    start: pointer.start,
    track: placement.needsInsert
      ? Math.max(pointer.track, ...input.trackOrder, -1) + 1
      : placement.track,
  };
}

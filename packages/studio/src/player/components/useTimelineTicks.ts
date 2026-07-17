import { useMemo } from "react";
import { STUDIO_PREVIEW_FPS } from "../lib/time";
import { generateTicks, getTimelineMajorTickInterval } from "./timelineLayout";
import type { TimelineTimeRange } from "../lib/timelineClipIndex";

export function useTimelineTicks(
  duration: number,
  pixelsPerSecond: number,
  timeDisplayMode: "time" | "frame",
  renderTimeRange?: TimelineTimeRange,
) {
  const frameRate = timeDisplayMode === "frame" ? STUDIO_PREVIEW_FPS : undefined;
  const ticks = useMemo(
    () => generateTicks(duration, pixelsPerSecond, frameRate, renderTimeRange),
    [duration, frameRate, pixelsPerSecond, renderTimeRange],
  );
  return {
    ...ticks,
    majorTickInterval: getTimelineMajorTickInterval(duration, pixelsPerSecond, frameRate),
  };
}

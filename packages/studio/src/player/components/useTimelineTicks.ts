import { useMemo } from "react";
import { STUDIO_PREVIEW_FPS } from "../lib/time";
import type { TimelineTimeDisplayMode } from "../../utils/studioUiPreferences";
import type { TimelineTimeRange } from "../lib/timelineClipIndex";
import { generateTicks, getTimelineMajorTickInterval } from "./timelineRulerGeometry";

export function useTimelineTicks(
  duration: number,
  pixelsPerSecond: number,
  timeDisplayMode: TimelineTimeDisplayMode,
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

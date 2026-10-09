import { useMemo } from "react";
import type { TimelineTimeDisplayMode } from "../../utils/studioUiPreferences";
import type { TimelineTimeRange } from "../lib/timelineClipIndex";
import {
  generateTicks,
  getTimelineMajorTickInterval,
  rulerFrameRate,
} from "./timelineRulerGeometry";

export function useTimelineTicks(
  duration: number,
  pixelsPerSecond: number,
  timeDisplayMode: TimelineTimeDisplayMode,
  renderTimeRange?: TimelineTimeRange,
) {
  const frameRate = rulerFrameRate(timeDisplayMode);
  const ticks = useMemo(
    () => generateTicks(duration, pixelsPerSecond, frameRate, renderTimeRange),
    [duration, frameRate, pixelsPerSecond, renderTimeRange],
  );
  return {
    ...ticks,
    majorTickInterval: getTimelineMajorTickInterval(duration, pixelsPerSecond, frameRate),
  };
}

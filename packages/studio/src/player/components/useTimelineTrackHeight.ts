import { usePlayerStore } from "../store/playerStore";
import { getTimelineTrackHeight } from "./timelineLayout";

export function useTimelineTrackHeight(): number {
  return usePlayerStore((s) => getTimelineTrackHeight(s.timelineTrackDensity));
}

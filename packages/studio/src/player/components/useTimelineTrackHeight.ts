import { create } from "zustand";
import {
  readStudioUiPreferences,
  writeStudioUiPreferences,
  type TimelineTrackDensity,
} from "../../utils/studioUiPreferences";
import { getTimelineTrackHeight } from "./timelineLayout";

/** Timeline track height preset; persisted, comfortable unless the user picked compact. */
export const useTimelineTrackDensity = create<{
  density: TimelineTrackDensity;
  setDensity: (density: TimelineTrackDensity) => void;
}>((set) => ({
  density: readStudioUiPreferences().timelineTrackDensity ?? "comfortable",
  setDensity: (density) => {
    writeStudioUiPreferences({ timelineTrackDensity: density });
    set({ density });
  },
}));

export function useTimelineTrackHeight(): number {
  return useTimelineTrackDensity((s) => getTimelineTrackHeight(s.density));
}

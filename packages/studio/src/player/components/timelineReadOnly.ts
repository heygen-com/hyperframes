import { createContext, useContext } from "react";
import {
  getTimelineEditCapabilities,
  type TimelineEditCapabilities,
} from "./timelineEditCapabilities";

export const TimelineReadOnlyContext = createContext<(() => void) | null>(null);

/** The refusal to report while the timeline is read-only; null while it is editable. */
export function useTimelineReadOnlyPress(): (() => void) | null {
  return useContext(TimelineReadOnlyContext);
}

const READ_ONLY_CLIP: TimelineEditCapabilities = {
  canMove: false,
  canTrimStart: false,
  canTrimEnd: false,
  readOnly: true,
};

/** Read-only locks every clip; its presses then take the blocked-edit path to the refusal. */
export function useTimelineClipCapabilities(): typeof getTimelineEditCapabilities {
  return useTimelineReadOnlyPress() ? () => READ_ONLY_CLIP : getTimelineEditCapabilities;
}

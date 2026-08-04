/**
 * Writes for the timeline's audio automation lanes.
 *
 * Kept out of TimelineLanes so that component does not grow another concern.
 * Reading lives in `automationLaneData`, shared with the row layout, which needs
 * the lane count to reserve height.
 *
 * Edits go to the *selected* element, because that is what the attribute commit
 * path targets. An unselected clip still draws its envelopes — they are just
 * read only, which is also what stops a stray drag from editing the wrong track.
 */

import { useCallback, useMemo } from "react";
import {
  HF_AUDIO_AUTOMATION_ATTR,
  serializeAutomation,
  type HfAutomation,
  type HfAutomationLane,
} from "@hyperframes/core/audio-automation";
import type { HfAudioFxChain } from "@hyperframes/core/audio-fx";
import { useDomEditActionsContextOptional } from "../../contexts/DomEditContext";
import type { TimelineElement } from "../store/playerStore";
import { elementAutomation, elementFxChain } from "./automationLaneData";

export interface AutomationLaneBinding {
  automation: HfAutomation;
  /** One entry per lane, in draw order — each gets its own row. */
  lanes: HfAutomationLane[];
  chain: HfAudioFxChain | null;
  /** Continuous write while dragging; does not persist. */
  onPreview(next: HfAutomation): void;
  /** Gesture-end write; this is the one that persists and lands in undo. */
  onCommit(next: HfAutomation): void;
  /**
   * Select this clip, which is what makes its lanes editable. A lane calls this
   * instead of writing when it is read-only — pressing the lane is the only
   * route in, since lanes sit below the clip bar where the timeline's own
   * selection handler never sees them.
   */
  onSelect(): void;
  readOnly: boolean;
}

export interface UseAutomationLanesResult {
  bind(element: TimelineElement, isSelected: boolean): AutomationLaneBinding;
}

export function useAutomationLanes(): UseAutomationLanesResult {
  // Optional: the player also runs outside Studio, where there is no edit
  // session. There the lanes render read-only, which is the right fallback.
  const domEdit = useDomEditActionsContextOptional();

  const bind = useCallback(
    (element: TimelineElement, isSelected: boolean): AutomationLaneBinding => {
      const chain = elementFxChain(element);
      const automation = elementAutomation(element);

      const write = (next: HfAutomation, persist: boolean): void => {
        if (!domEdit || !isSelected) return;
        const value = next.lanes.length > 0 ? serializeAutomation(next) : "";
        // Quiet, not the refreshing commit: releasing a dragged point used to
        // reload the preview, which restarts every playing track — the same chop
        // the live write during the drag exists to avoid. Quiet still persists
        // and still resyncs the selection, so the next edit sees this one.
        if (persist) void domEdit.handleDomAttributeQuietCommit(HF_AUDIO_AUTOMATION_ATTR, value);
        // Dragging a point writes live: no preview refresh, so the composition
        // does not reload and restart playback on every pixel.
        else void domEdit.handleDomAttributeLiveCommit(HF_AUDIO_AUTOMATION_ATTR, value || null);
      };

      return {
        automation,
        lanes: automation.lanes,
        chain,
        onPreview: (next) => write(next, false),
        onCommit: (next) => write(next, true),
        // Deliberately not awaited before an edit: the commit handlers close
        // over the selection as it was when they were built, so writing in the
        // same tick would land on whichever element was selected before.
        // Selecting is its own gesture; the lane goes live after it.
        onSelect: () => void domEdit?.handleTimelineElementSelect(element),
        readOnly: !domEdit || !isSelected,
      };
    },
    [domEdit],
  );

  return useMemo(() => ({ bind }), [bind]);
}

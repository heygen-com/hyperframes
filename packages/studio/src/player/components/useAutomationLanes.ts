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

import { useCallback, useMemo, useRef } from "react";
import {
  HF_AUDIO_AUTOMATION_ATTR,
  serializeAutomation,
  type HfAutomation,
  type HfAutomationLane,
} from "@hyperframes/core/audio-automation";
import type { HfAudioFxChain } from "@hyperframes/core/audio-fx";
import {
  useDomEditActionsContextOptional,
  useDomEditSelectionContextOptional,
} from "../../contexts/DomEditContext";
import { resolveTimelineIdForSelection } from "../../utils/studioHelpers";
import { getTimelineElementIdentity } from "../lib/timelineElementHelpers";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import type { AutomationSelection } from "../store/automationSelectionSlice";
import { elementAutomation, elementFxChain } from "./automationLaneData";
import { createAutomationGestureKeys } from "./automationGestureKeys";

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
  /**
   * The timeline clip `onCommit`/`onPreview` will ACTUALLY persist to, which is
   * whatever the dom-edit layer has selected — not necessarily the element this
   * binding was made for (see `onSelect` below). Null outside an edit session or
   * when the dom-edit selection maps to no clip. Resolved exactly the way
   * applyDomSelection resolves it, so in a settled selection it equals the bound
   * element's key; it lags only in the window a non-gesture caller can hit.
   */
  commitTargetKey: string | null;
  /** This element's active selection box, or null if none / it belongs to a
   *  different element. */
  selection: AutomationSelection | null;
  /** Live write while dragging a selection box on the given lane; does not
   *  persist — the selection is ephemeral store state, not part of the
   *  composition. */
  onRangeSelect(target: string, t0: number, t1: number, v0: number, v1: number): void;
  onRangeClear(): void;
}

export interface UseAutomationLanesResult {
  bind(element: TimelineElement, isSelected: boolean): AutomationLaneBinding;
}

export function useAutomationLanes(): UseAutomationLanesResult {
  // One per hook instance, held across renders: a gesture spans many commits and
  // they all have to record under the same key for undo to take the whole drag.
  const gestureKeys = useRef(createAutomationGestureKeys());
  // Optional: the player also runs outside Studio, where there is no edit
  // session. There the lanes render read-only, which is the right fallback.
  const domEdit = useDomEditActionsContextOptional();
  const domEditSelection = useDomEditSelectionContextOptional()?.domEditSelection ?? null;
  const elements = usePlayerStore((s) => s.elements);
  const automationSelection = usePlayerStore((s) => s.automationSelection);
  const setAutomationSelection = usePlayerStore((s) => s.setAutomationSelection);
  const clearAutomationSelection = usePlayerStore((s) => s.clearAutomationSelection);

  // Read from the SAME render as the commit handlers below: both contexts update
  // in one commit, so a handler and this key can never describe different
  // moments. activeCompPath is not needed — resolveTimelineIdForSelection only
  // uses it as a fallback for a selection with no sourceFile of its own, and
  // DomEditSelection always carries one.
  const commitTargetKey = useMemo(
    () =>
      domEditSelection ? resolveTimelineIdForSelection(domEditSelection, elements, null) : null,
    [domEditSelection, elements],
  );

  const bind = useCallback(
    (element: TimelineElement, isSelected: boolean): AutomationLaneBinding => {
      const chain = elementFxChain(element);
      const automation = elementAutomation(element);
      const elementKey = getTimelineElementIdentity(element);

      const write = (next: HfAutomation, persist: boolean): void => {
        if (!domEdit || !isSelected) return;
        const value = next.lanes.length > 0 ? serializeAutomation(next) : "";
        // Every write of one gesture under one key, so undo takes back the whole
        // drag rather than the last fragment history happened to keep.
        const coalesce = persist ? gestureKeys.current.commit() : gestureKeys.current.live();
        // Quiet, not the refreshing commit: releasing a dragged point used to
        // reload the preview, which restarts every playing track — the same chop
        // the live write during the drag exists to avoid. Quiet still persists
        // and still resyncs the selection, so the next edit sees this one.
        if (persist) {
          void domEdit.handleDomAttributeQuietCommit(HF_AUDIO_AUTOMATION_ATTR, value, coalesce);
        }
        // Dragging a point writes live: no preview refresh, so the composition
        // does not reload and restart playback on every pixel.
        else {
          // Preview only, because a gesture writes on every pointermove: the
          // preview and the running audio follow the pointer, and the release
          // below is the one write that reaches the file and the undo stack.
          void domEdit.handleDomAttributeLiveCommit(
            HF_AUDIO_AUTOMATION_ATTR,
            value || null,
            undefined,
            {
              coalesce,
              previewOnly: true,
            },
          );
        }
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
        commitTargetKey: domEdit ? commitTargetKey : null,
        selection: automationSelection?.elementKey === elementKey ? automationSelection : null,
        // Not gated on `isSelected`, unlike the writes above. A selection is
        // ephemeral store state, and the drag that draws one on a read-only lane is
        // the same press that selects the clip — refusing it here meant the first
        // drag on a lane silently did nothing and the author had to drag again.
        // Nothing can be written through it while the lane is read-only: every
        // consumer resolves the binding again and finds `readOnly`.
        onRangeSelect: (target, t0, t1, v0, v1) => {
          if (!domEdit) return;
          setAutomationSelection({ elementKey, target, t0, t1, v0, v1 });
        },
        onRangeClear: () => clearAutomationSelection(),
      };
    },
    [
      domEdit,
      commitTargetKey,
      automationSelection,
      setAutomationSelection,
      clearAutomationSelection,
    ],
  );

  return useMemo(() => ({ bind }), [bind]);
}

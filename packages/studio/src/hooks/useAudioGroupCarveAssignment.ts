import { useCallback } from "react";
import { useExpandedTimelineElements } from "../player/hooks/useExpandedTimelineElements";
import {
  createAudioGroupAndAssignMembers,
  type UseTimelineElementVisibilityEditingInput,
} from "./timelineTrackVisibility";

/**
 * The write behind B6's auto-group and behind C1's grouping pointer in a track
 * header: pick two or more voice clips (or press the pointer on an ungrouped
 * audio track) and they land in a group instead of naming each other by id.
 *
 * Its own module because this is not track-visibility work, and that file is at
 * the studio 600-line ceiling. Same
 * expanded-rows resolution as element-visibility, for the same reason — a
 * nested sub-composition child has no entry in the raw store list.
 */
export function useAudioGroupCarveAssignment({
  projectIdRef,
  activeCompPath,
  showToast,
  writeProjectFile,
  recordEdit,
  domEditSaveTimestampRef,
  previewIframeRef,
  pendingTimelineEditPathRef,
  isRecordingRef,
}: UseTimelineElementVisibilityEditingInput): (
  clipIds: readonly string[],
  groupId: string,
) => Promise<void> {
  const expandedElements = useExpandedTimelineElements();
  return useCallback(
    async (clipIds: readonly string[], groupId: string) => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return;
      }
      const pid = projectIdRef.current;
      if (!pid) return;
      const keys = new Set(clipIds);
      const elements = expandedElements.filter((item) => keys.has(item.key ?? item.id));
      // `createAudioGroupAndAssignMembers` returns [] for fewer than two
      // members, which is right for the carve picker (nothing to group) but
      // silent for a button the author just pressed: the timeline offers the
      // grouping pointer on `clipCount > 1`, so a request that resolves to
      // fewer than two clips is an id-space mismatch, not a no-op. Say so
      // rather than letting the click look like it did nothing.
      if (clipIds.length > 1 && elements.length < 2) {
        console.error("[Timeline] Grouping resolved too few clips", {
          requested: clipIds,
          resolved: elements.map((item) => item.key ?? item.id),
        });
        showToast("Could not group these clips — try expanding the track first", "error");
        return;
      }
      try {
        await createAudioGroupAndAssignMembers({
          projectId: pid,
          activeCompPath,
          elements,
          groupId,
          previewIframe: previewIframeRef.current,
          writeProjectFile,
          recordEdit,
          domEditSaveTimestampRef,
          pendingTimelineEditPathRef,
        });
      } catch (error) {
        console.error("[Timeline] Failed to group voice clips", error);
        const message = error instanceof Error ? error.message : "Failed to group voice clips";
        showToast(message);
      }
    },
    [
      activeCompPath,
      expandedElements,
      previewIframeRef,
      writeProjectFile,
      recordEdit,
      domEditSaveTimestampRef,
      pendingTimelineEditPathRef,
      isRecordingRef,
      showToast,
      projectIdRef,
    ],
  );
}

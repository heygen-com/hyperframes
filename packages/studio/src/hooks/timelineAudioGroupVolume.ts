import { useCallback } from "react";
import {
  buildPatchTarget,
  persistElementAttribute,
  type RecordEditInput,
} from "./timelineEditingHelpers";
import type {
  MutableRef,
  UseTimelineElementVisibilityEditingInput,
} from "./timelineTrackVisibility";

/** Direct DOM write on the group element for the gesture in progress — no
 *  file write, no history entry (mirrors FxParamRow's live/commit split). */
function patchLiveGroupAttribute(
  iframe: HTMLIFrameElement | null,
  groupId: string,
  attr: string,
  value: string | null,
): void {
  const target = iframe?.contentDocument?.getElementById(groupId);
  if (!target) return;
  if (value === null) target.removeAttribute(attr);
  else target.setAttribute(attr, value);
}

interface SetAudioGroupAttributeInput {
  projectId: string;
  activeCompPath: string | null;
  groupId: string;
  attr: string;
  value: string | null;
  label: string;
  previewIframe: HTMLIFrameElement | null;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  domEditSaveTimestampRef: MutableRef<number>;
  pendingTimelineEditPathRef: MutableRef<Set<string>>;
}

/**
 * Persist one attribute on the group element itself — e.g. the bus strip's
 * volume slider writing `data-volume` on release. One undo entry; mirrors
 * `createAudioGroupAndAssignMembers`'s save shape but for a single element
 * and attribute rather than a member-assignment sweep.
 */
async function setAudioGroupAttribute({
  projectId,
  activeCompPath,
  groupId,
  attr,
  value,
  label,
  previewIframe,
  writeProjectFile,
  recordEdit,
  domEditSaveTimestampRef,
  pendingTimelineEditPathRef,
}: SetAudioGroupAttributeInput): Promise<string[]> {
  const targetPath = activeCompPath || "index.html";
  const patchTarget = buildPatchTarget({ domId: groupId });
  if (!patchTarget) return [];

  return persistElementAttribute({
    projectId,
    targetPath,
    patchTarget,
    attr,
    value,
    label,
    writeProjectFile,
    recordEdit,
    domEditSaveTimestampRef,
    pendingTimelineEditPathRef,
    patchLive: (v) => patchLiveGroupAttribute(previewIframe, groupId, attr, v),
    readLive: () =>
      previewIframe?.contentDocument?.getElementById(groupId)?.getAttribute(attr) ?? null,
  });
}

/**
 * B7's bus strip: live-write the group's own attribute (`data-volume`, so
 * far — B5's mute will reuse this too) while dragging, persist one undo entry
 * on release. Unlike `useAudioGroupCarveAssignment`, this never touches
 * member elements — the group id doubles as its own DOM id, so no selection
 * or expanded-rows resolution is needed to find it.
 */
export function useSetAudioGroupAttribute({
  projectIdRef,
  activeCompPath,
  showToast,
  writeProjectFile,
  recordEdit,
  domEditSaveTimestampRef,
  previewIframeRef,
  pendingTimelineEditPathRef,
  isRecordingRef,
}: UseTimelineElementVisibilityEditingInput): {
  setLive: (groupId: string, attr: string, value: string | null) => void;
  setQuiet: (groupId: string, attr: string, value: string | null, label: string) => Promise<void>;
} {
  const setLive = useCallback(
    (groupId: string, attr: string, value: string | null) => {
      patchLiveGroupAttribute(previewIframeRef.current, groupId, attr, value);
    },
    [previewIframeRef],
  );
  const setQuiet = useCallback(
    async (groupId: string, attr: string, value: string | null, label: string) => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return;
      }
      const pid = projectIdRef.current;
      if (!pid) return;
      try {
        await setAudioGroupAttribute({
          projectId: pid,
          activeCompPath,
          groupId,
          attr,
          value,
          label,
          previewIframe: previewIframeRef.current,
          writeProjectFile,
          recordEdit,
          domEditSaveTimestampRef,
          pendingTimelineEditPathRef,
        });
      } catch (error) {
        console.error("[Timeline] Failed to set group attribute", error);
        const message = error instanceof Error ? error.message : "Failed to update group";
        showToast(message);
      }
    },
    [
      activeCompPath,
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
  return { setLive, setQuiet };
}

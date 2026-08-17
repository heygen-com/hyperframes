import { useCallback } from "react";
import { HF_AUDIO_FX_ATTR } from "@hyperframes/core/audio-fx";
import { usePlayerStore } from "../player";
import type { TimelineElementPatch } from "../player/store/timelineElement";
import { invalidateGroupInfoCache } from "../player/lib/timelineDOM";
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
  invalidateGroupInfoCache(iframe?.contentDocument);
}

/** Which store field each writable group attribute mirrors into. */
const GROUP_ATTR_TO_MIRROR: Record<
  string,
  (value: string | null, groupId: string) => TimelineElementPatch
> = {
  "data-hidden": (value) => ({ audioGroupHidden: value !== null }),
  "data-volume": (value) => ({
    audioGroupVolume: Number.isFinite(Number(value)) ? Number(value) : 1,
  }),
  "data-label": (value, groupId) => ({ audioGroupLabel: value ?? groupId }),
  [HF_AUDIO_FX_ATTR]: (value) => ({ audioGroupFxChain: value ?? undefined }),
};

/**
 * Mirror a group attribute onto the store copy every member carries.
 *
 * The timeline derives a group's label / volume / mute / chain from these
 * mirrored `audioGroup*` fields on its MEMBERS, not from the group element —
 * and a group write only ever touched the file and the live preview DOM.
 * Nothing re-parsed, so the header went on reading the old value: the observed
 * symptom was a muted group whose button stayed "Mute group", re-writing
 * `data-hidden` on every click and never offering to unmute.
 *
 * Invalidating the parse cache is necessary but not sufficient — it only
 * ensures the NEXT parse is honest, and a live attribute patch does not cause
 * one. Same reason `commitDataAttribute` carries `syncStoredAutomationFromPreview`.
 */
function syncStoredGroupAttribute(groupId: string, attr: string, value: string | null): void {
  const toPatch = GROUP_ATTR_TO_MIRROR[attr];
  if (!toPatch) return;
  const patch = toPatch(value, groupId);
  const store = usePlayerStore.getState();
  for (const element of store.elements) {
    if (element.audioGroup === groupId) store.updateElement(element.key ?? element.id, patch);
  }
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
      // Live too, not just on commit: a fader drag is `setLive` per frame and
      // `setQuiet` once on release, so without this the strip's own readout
      // fights the drag.
      syncStoredGroupAttribute(groupId, attr, value);
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
        syncStoredGroupAttribute(groupId, attr, value);
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

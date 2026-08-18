import { useCallback } from "react";
import { HF_AUDIO_FX_ATTR } from "@hyperframes/core/audio-fx";
import { usePlayerStore } from "../player";
import type { TimelineElementPatch } from "../player/store/timelineElement";
import { invalidateGroupInfoCache } from "../player/lib/timelineGroupInfo";
import { getTimelineElementSourceFile } from "../player/lib/timelineElementHelpers";
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

/**
 * `data-volume` exactly as core reads it (`readAudioGroupVolume`): an absent or
 * empty attribute is UNITY, not zero.
 *
 * `Number(null)` and `Number("")` are both 0 and both finite, so the obvious
 * `Number.isFinite(Number(value))` mirrored "silent" into the store for a
 * removed attribute while the DOM, the preview bus and the render all read 1 —
 * exactly the parse divergence this mirror exists to eliminate.
 */
function mirroredGroupVolume(value: string | null): number {
  if (!value) return 1;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 1;
}

/** Which store field each writable group attribute mirrors into. */
const GROUP_ATTR_TO_MIRROR: Record<
  string,
  (value: string | null, groupId: string) => TimelineElementPatch
> = {
  "data-hidden": (value) => ({ audioGroupHidden: value !== null }),
  "data-volume": (value) => ({ audioGroupVolume: mirroredGroupVolume(value) }),
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
  // ONE pass and one notification, rather than `updateElement` per member.
  // That helper maps the whole `elements` array per call, so a 3-member group on
  // a 500-clip composition was 1500 object spreads and 3 store notifications per
  // drag frame — at ~60/s, with every `elements`-keyed memo downstream
  // recomputing each time.
  usePlayerStore.setState((state) => ({
    elements: state.elements.map((el) => (el.audioGroup === groupId ? { ...el, ...patch } : el)),
  }));
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
  // The file that actually CONTAINS the group element, not just the active
  // composition. A hand-authored sub-composition can declare both the members
  // and their `<hf-audio-group>`, and until sub-comp children inherited
  // `audioGroup*` no group row existed for that case so nothing could reach
  // here. Now the row appears, and routing its writes at `activeCompPath`
  // means `readTagSnippetByTarget` finds nothing and every mute, fader move and
  // FX preset throws "Unable to patch element in index.html". Every sibling
  // timeline writer already routes `element.sourceFile || activeCompPath`.
  const groupEl = previewIframe?.contentDocument?.getElementById(groupId) ?? null;
  const targetPath =
    (groupEl ? getTimelineElementSourceFile(groupEl) : undefined) || activeCompPath || "index.html";
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
        // `persistElementAttribute` has already unwound the live DOM to the
        // previous value, but `setLive` mirrored the in-progress value into the
        // store on every drag frame — so without this the fader reads 0.4 while
        // the preview and the file are both back at 1.0, and nothing re-parses
        // to correct it (a live patch causing no parse is this mirror's whole
        // premise). Re-mirror from the DOM, which is now authoritative again.
        const live = previewIframeRef.current?.contentDocument?.getElementById(groupId);
        syncStoredGroupAttribute(groupId, attr, live?.getAttribute(attr) ?? null);
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

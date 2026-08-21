import { useCallback } from "react";
import { usePlayerStore, type TimelineElement } from "../player";
import { useExpandedTimelineElements } from "../player/hooks/useExpandedTimelineElements";
import {
  timelineTrackOrder,
  trackDisplayNumber,
  trackDisplaySuffix,
} from "../player/components/timelineTrackDisplay";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import { isAudioTimelineElement } from "../utils/timelineInspector";
import { HF_AUDIO_GROUP_ATTR } from "@hyperframes/core/audio-groups";
import { readTagSnippetByTarget, type PatchOperation } from "../utils/sourcePatcher";
import {
  applyPatchByTarget,
  buildPatchTarget,
  findTimelineElementInIframe,
  readFileContent,
  type RecordEditInput,
} from "./timelineEditingHelpers";

export interface MutableRef<T> {
  current: T;
}

interface ReadonlyRef<T> {
  readonly current: T;
}

interface ToggleTimelineTrackHiddenInput {
  projectId: string;
  activeCompPath: string | null;
  timelineElements: readonly TimelineElement[];
  track: number;
  hidden: boolean;
  /**
   * The display row the clicked control announced, when the caller has one.
   * Absent (a keyboard path or a programmatic call), the row is derived here
   * from ascending element-bearing keys — correct whenever no group has
   * reordered the header.
   */
  displayNumber?: number | null;
  previewIframe: HTMLIFrameElement | null;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  domEditSaveTimestampRef: MutableRef<number>;
  pendingTimelineEditPathRef: MutableRef<Set<string>>;
}

interface ToggleTimelineElementHiddenInput extends Omit<ToggleTimelineTrackHiddenInput, "track"> {
  /** One timeline key, or several to hide/show in a single atomic file write. */
  elementKey: string | readonly string[];
}

interface SetElementsHiddenInput {
  projectId: string;
  activeCompPath: string | null;
  elements: readonly TimelineElement[];
  hidden: boolean;
  label: string;
  previewIframe: HTMLIFrameElement | null;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  domEditSaveTimestampRef: MutableRef<number>;
  pendingTimelineEditPathRef: MutableRef<Set<string>>;
}

interface UseTimelineTrackVisibilityEditingInput extends Omit<
  ToggleTimelineTrackHiddenInput,
  "projectId" | "track" | "hidden" | "previewIframe"
> {
  projectIdRef: ReadonlyRef<string | null>;
  previewIframeRef: ReadonlyRef<HTMLIFrameElement | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  isRecordingRef?: ReadonlyRef<boolean>;
  forceReloadSdkSession?: () => void;
}

export interface UseTimelineElementVisibilityEditingInput extends Omit<
  ToggleTimelineElementHiddenInput,
  "projectId" | "elementKey" | "hidden" | "previewIframe" | "timelineElements"
> {
  projectIdRef: ReadonlyRef<string | null>;
  previewIframeRef: ReadonlyRef<HTMLIFrameElement | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  isRecordingRef?: ReadonlyRef<boolean>;
  forceReloadSdkSession?: () => void;
}

function getTimelineElementTargetPath(
  element: TimelineElement,
  activeCompPath: string | null,
): string {
  return element.sourceFile || activeCompPath || "index.html";
}

function patchLiveHiddenState(
  iframe: HTMLIFrameElement | null,
  elements: readonly TimelineElement[],
  hidden: boolean,
  activeCompPath: string | null,
): void {
  for (const element of elements) {
    const target = findTimelineElementInIframe(iframe, element, activeCompPath);
    if (!target) continue;
    if (hidden) {
      target.setAttribute("data-hidden", "");
    } else {
      target.removeAttribute("data-hidden");
    }
  }
}

function reseekPreviewRuntime(iframe: HTMLIFrameElement | null): void {
  try {
    const win: (Window & { __player?: { seek?: (time: number) => void } }) | null =
      iframe?.contentWindow ?? null;
    win?.__player?.seek?.(usePlayerStore.getState().currentTime);
  } catch {}
}

function groupElementsByTargetPath(
  elements: readonly TimelineElement[],
  activeCompPath: string | null,
): Map<string, TimelineElement[]> {
  const byPath = new Map<string, TimelineElement[]>();
  for (const element of elements) {
    const targetPath = getTimelineElementTargetPath(element, activeCompPath);
    const existing = byPath.get(targetPath);
    if (existing) {
      existing.push(element);
    } else {
      byPath.set(targetPath, [element]);
    }
  }
  return byPath;
}

// fallow-ignore-next-line complexity
async function setElementsHidden({
  projectId,
  activeCompPath,
  elements,
  hidden,
  label,
  previewIframe,
  writeProjectFile,
  recordEdit,
  domEditSaveTimestampRef,
  pendingTimelineEditPathRef,
}: SetElementsHiddenInput): Promise<string[]> {
  if (elements.length === 0) return [];

  patchLiveHiddenState(previewIframe, elements, hidden, activeCompPath);
  reseekPreviewRuntime(previewIframe);

  const hiddenOperation: PatchOperation = {
    type: "attribute",
    property: "hidden",
    value: hidden ? "" : null,
  };
  const originalByPath = new Map<string, string>();
  const files: Record<string, string> = {};

  try {
    for (const [targetPath, fileElements] of groupElementsByTargetPath(elements, activeCompPath)) {
      let patchedContent = await readFileContent(projectId, targetPath);
      originalByPath.set(targetPath, patchedContent);

      for (const element of fileElements) {
        const patchTarget = buildPatchTarget(element);
        if (!patchTarget) {
          throw new Error(`Timeline element ${element.id} is missing a patchable target`);
        }
        if (readTagSnippetByTarget(patchedContent, patchTarget) === undefined) {
          throw new Error(`Unable to patch timeline element ${element.id} in ${targetPath}`);
        }
        patchedContent = applyPatchByTarget(patchedContent, patchTarget, hiddenOperation);
      }

      files[targetPath] = patchedContent;
      pendingTimelineEditPathRef.current.add(targetPath);
    }

    domEditSaveTimestampRef.current = Date.now();
    const changedPaths = await saveProjectFilesWithHistory({
      projectId,
      label,
      kind: "timeline",
      files,
      readFile: async (path) => {
        const original = originalByPath.get(path);
        if (original !== undefined) return original;
        return readFileContent(projectId, path);
      },
      writeFile: writeProjectFile,
      recordEdit,
    });
    domEditSaveTimestampRef.current = Date.now();
    for (const element of elements) {
      usePlayerStore.getState().updateElement(element.key ?? element.id, { hidden });
    }
    return changedPaths;
  } catch (error) {
    // The optimistic live patch already ran; a patch-target/save failure here would
    // otherwise leave the preview showing the wrong visibility until a reload. Revert
    // the live DOM to the prior state so what's on screen matches what persisted.
    patchLiveHiddenState(previewIframe, elements, !hidden, activeCompPath);
    reseekPreviewRuntime(previewIframe);
    throw error;
  }
}

export async function toggleTimelineTrackHidden({
  projectId,
  activeCompPath,
  timelineElements,
  track,
  hidden,
  displayNumber,
  previewIframe,
  writeProjectFile,
  recordEdit,
  domEditSaveTimestampRef,
  pendingTimelineEditPathRef,
}: ToggleTimelineTrackHiddenInput): Promise<string[]> {
  // `track` is the fractional sort key the callback needs; the history entry is
  // read by a human, so it gets the display row instead — the one the clicked
  // control announced, when the caller passed it. Deriving it again here would
  // use ascending element-bearing keys, which stop matching the header as soon
  // as an audio group reorders the rows and inserts an anchor.
  const suffix = trackDisplaySuffix(
    displayNumber ?? trackDisplayNumber(timelineTrackOrder(timelineElements), track),
  );
  const trackElements = timelineElements.filter((element) => element.track === track);
  const isAudioOnlyTrack = trackElements.length > 0 && trackElements.every(isAudioTimelineElement);
  const label = isAudioOnlyTrack
    ? hidden
      ? `Mute track${suffix}`
      : `Unmute track${suffix}`
    : hidden
      ? `Hide track${suffix}`
      : `Show track${suffix}`;
  return setElementsHidden({
    projectId,
    activeCompPath,
    elements: trackElements,
    hidden,
    label,
    previewIframe,
    writeProjectFile,
    recordEdit,
    domEditSaveTimestampRef,
    pendingTimelineEditPathRef,
  });
}

export async function toggleTimelineElementHidden({
  projectId,
  activeCompPath,
  timelineElements,
  elementKey,
  hidden,
  previewIframe,
  writeProjectFile,
  recordEdit,
  domEditSaveTimestampRef,
  pendingTimelineEditPathRef,
}: ToggleTimelineElementHiddenInput): Promise<string[]> {
  const keys = new Set(typeof elementKey === "string" ? [elementKey] : elementKey);
  const elements = timelineElements.filter((item) => keys.has(item.key ?? item.id));
  return setElementsHidden({
    projectId,
    activeCompPath,
    elements,
    hidden,
    label:
      elements.length > 1
        ? hidden
          ? `Hide ${elements.length} elements`
          : `Show ${elements.length} elements`
        : hidden
          ? "Hide element"
          : "Show element",
    previewIframe,
    writeProjectFile,
    recordEdit,
    domEditSaveTimestampRef,
    pendingTimelineEditPathRef,
  });
}

function patchLiveAudioGroupState(
  iframe: HTMLIFrameElement | null,
  elements: readonly TimelineElement[],
  groupId: string | null,
  activeCompPath: string | null,
): void {
  for (const element of elements) {
    const target = findTimelineElementInIframe(iframe, element, activeCompPath);
    if (!target) continue;
    if (groupId) target.setAttribute(HF_AUDIO_GROUP_ATTR, groupId);
    else target.removeAttribute(HF_AUDIO_GROUP_ATTR);
  }
}

interface CreateAudioGroupAndAssignMembersInput {
  projectId: string;
  activeCompPath: string | null;
  elements: readonly TimelineElement[];
  groupId: string;
  previewIframe: HTMLIFrameElement | null;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  domEditSaveTimestampRef: MutableRef<number>;
  pendingTimelineEditPathRef: MutableRef<Set<string>>;
}

/**
 * Group two or more voice clips: write `data-audio-group="<groupId>"` on
 * every one of them, atomically, one undo entry — the same multi-target shape
 * `setElementsHidden` uses for mute. The group needs no `<hf-audio-group>`
 * element of its own to exist: `resolveAudioGroups` already degrades
 * gracefully to label = id when one is absent, and a naming dialog is out of
 * scope here — the id itself is the default name.
 */
// fallow-ignore-next-line complexity
export async function createAudioGroupAndAssignMembers({
  projectId,
  activeCompPath,
  elements,
  groupId,
  previewIframe,
  writeProjectFile,
  recordEdit,
  domEditSaveTimestampRef,
  pendingTimelineEditPathRef,
}: CreateAudioGroupAndAssignMembersInput): Promise<string[]> {
  if (elements.length < 2) return [];

  patchLiveAudioGroupState(previewIframe, elements, groupId, activeCompPath);
  reseekPreviewRuntime(previewIframe);

  const groupOperation: PatchOperation = {
    type: "attribute",
    property: HF_AUDIO_GROUP_ATTR,
    value: groupId,
  };
  const originalByPath = new Map<string, string>();
  const files: Record<string, string> = {};

  try {
    for (const [targetPath, fileElements] of groupElementsByTargetPath(elements, activeCompPath)) {
      let patchedContent = await readFileContent(projectId, targetPath);
      originalByPath.set(targetPath, patchedContent);

      for (const element of fileElements) {
        const patchTarget = buildPatchTarget(element);
        if (!patchTarget) {
          throw new Error(`Timeline element ${element.id} is missing a patchable target`);
        }
        if (readTagSnippetByTarget(patchedContent, patchTarget) === undefined) {
          throw new Error(`Unable to patch timeline element ${element.id} in ${targetPath}`);
        }
        patchedContent = applyPatchByTarget(patchedContent, patchTarget, groupOperation);
      }

      files[targetPath] = patchedContent;
      pendingTimelineEditPathRef.current.add(targetPath);
    }

    domEditSaveTimestampRef.current = Date.now();
    const changedPaths = await saveProjectFilesWithHistory({
      projectId,
      label: `Group ${elements.length} voice clips`,
      kind: "timeline",
      files,
      readFile: async (path) => {
        const original = originalByPath.get(path);
        if (original !== undefined) return original;
        return readFileContent(projectId, path);
      },
      writeFile: writeProjectFile,
      recordEdit,
    });
    domEditSaveTimestampRef.current = Date.now();
    for (const element of elements) {
      usePlayerStore.getState().updateElement(element.key ?? element.id, { audioGroup: groupId });
    }
    return changedPaths;
  } catch (error) {
    // Mirrors setElementsHidden's failure path: the optimistic live patch
    // already ran, so a save failure has to be unwound or the preview shows a
    // grouping that never made it to disk.
    patchLiveAudioGroupState(previewIframe, elements, null, activeCompPath);
    reseekPreviewRuntime(previewIframe);
    throw error;
  }
}

export function useTimelineTrackVisibilityEditing({
  projectIdRef,
  activeCompPath,
  showToast,
  writeProjectFile,
  recordEdit,
  domEditSaveTimestampRef,
  previewIframeRef,
  pendingTimelineEditPathRef,
  isRecordingRef,
  forceReloadSdkSession,
}: UseTimelineTrackVisibilityEditingInput): (
  track: number,
  hidden: boolean,
  displayNumber?: number | null,
) => Promise<void> {
  // Resolve the eye toggle against the EXPANDED rows the canvas actually renders:
  // virtual sub-comp children carry their own (display.track + idx) track numbers,
  // so filtering the raw store list by a virtual track number would hide the wrong
  // outer-scene sibling sharing that index.
  const expandedElements = useExpandedTimelineElements();
  return useCallback(
    async (track: number, hidden: boolean, displayNumber?: number | null) => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return;
      }
      const pid = projectIdRef.current;
      if (!pid) return;
      try {
        await toggleTimelineTrackHidden({
          projectId: pid,
          activeCompPath,
          timelineElements: expandedElements,
          track,
          hidden,
          displayNumber,
          previewIframe: previewIframeRef.current,
          writeProjectFile,
          recordEdit,
          domEditSaveTimestampRef,
          pendingTimelineEditPathRef,
        });
        forceReloadSdkSession?.();
      } catch (error) {
        console.error("[Timeline] Failed to toggle track visibility", error);
        const message =
          error instanceof Error ? error.message : "Failed to toggle track visibility";
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
      forceReloadSdkSession,
      projectIdRef,
    ],
  );
}

export function useTimelineElementVisibilityEditing({
  projectIdRef,
  activeCompPath,
  showToast,
  writeProjectFile,
  recordEdit,
  domEditSaveTimestampRef,
  previewIframeRef,
  pendingTimelineEditPathRef,
  isRecordingRef,
  forceReloadSdkSession,
}: UseTimelineElementVisibilityEditingInput): (
  elementKey: string | readonly string[],
  hidden: boolean,
) => Promise<void> {
  // Resolve against the EXPANDED rows, not the raw store list — a nested
  // sub-composition child has no entry of its own in the raw list (only its
  // host does), so an elementKey for such a child (the
  // `sourceFile#domId`-shaped virtual key `resolveTimelineIdForSelection`
  // falls back to) would never match anything there and Hide All would
  // silently no-op for it. The expanded list synthesizes a real, patchable
  // TimelineElement (with matching key/domId/sourceFile) for each visible
  // child whenever its host is currently expanded.
  const expandedElements = useExpandedTimelineElements();
  return useCallback(
    async (elementKey: string | readonly string[], hidden: boolean) => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return;
      }
      const pid = projectIdRef.current;
      if (!pid) return;
      try {
        await toggleTimelineElementHidden({
          projectId: pid,
          activeCompPath,
          timelineElements: expandedElements,
          elementKey,
          hidden,
          previewIframe: previewIframeRef.current,
          writeProjectFile,
          recordEdit,
          domEditSaveTimestampRef,
          pendingTimelineEditPathRef,
        });
        forceReloadSdkSession?.();
      } catch (error) {
        console.error("[Timeline] Failed to toggle element visibility", error);
        const message =
          error instanceof Error ? error.message : "Failed to toggle element visibility";
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
      forceReloadSdkSession,
      projectIdRef,
    ],
  );
}

/**
 * The write behind B6's auto-group: pick two or more voice clips in the carve
 * picker and they land in a group instead of naming each other by id. Same
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

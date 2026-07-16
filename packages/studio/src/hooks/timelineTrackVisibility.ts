import { useCallback } from "react";
import { usePlayerStore, type TimelineElement } from "../player";
import { useExpandedTimelineElements } from "../player/hooks/useExpandedTimelineElements";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import { readTagSnippetByTarget, type PatchOperation } from "../utils/sourcePatcher";
import {
  applyPatchByTarget,
  buildPatchTarget,
  findTimelineElementInIframe,
  readFileContent,
  type RecordEditInput,
} from "./timelineEditingHelpers";

interface MutableRef<T> {
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

interface UseTimelineElementVisibilityEditingInput extends Omit<
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
  previewIframe,
  writeProjectFile,
  recordEdit,
  domEditSaveTimestampRef,
  pendingTimelineEditPathRef,
}: ToggleTimelineTrackHiddenInput): Promise<string[]> {
  return setElementsHidden({
    projectId,
    activeCompPath,
    elements: timelineElements.filter((element) => element.track === track),
    hidden,
    label: hidden ? `Hide track ${track}` : `Show track ${track}`,
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
}: UseTimelineTrackVisibilityEditingInput): (track: number, hidden: boolean) => Promise<void> {
  // Resolve the eye toggle against the EXPANDED rows the canvas actually renders:
  // virtual sub-comp children carry their own (display.track + idx) track numbers,
  // so filtering the raw store list by a virtual track number would hide the wrong
  // outer-scene sibling sharing that index.
  const expandedElements = useExpandedTimelineElements();
  return useCallback(
    async (track: number, hidden: boolean) => {
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

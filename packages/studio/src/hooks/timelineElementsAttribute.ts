import { useCallback } from "react";
import type { TimelineEditCallbacks } from "../player/components/timelineCallbacks";
import { syncStoredElementAttribute } from "../player/lib/automationStoreSync";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import { applyPatchByTarget } from "../utils/sourcePatcher";
import {
  findTimelineElementInIframe,
  patchTimelineChangesInSource,
  readFileContent,
  type PersistTimelineBatchChange,
} from "./timelineEditingHelpers";
import type { UseTimelineElementVisibilityEditingInput } from "./timelineTrackVisibility";
import { projectForTimelineSave, type TimelineEditOutcome } from "./timelineEditPermission";

type ElementAttributeEdits = Parameters<
  NonNullable<TimelineEditCallbacks["onSetElementsAttributeQuiet"]>
>[0];

function editsByFile(
  edits: ElementAttributeEdits,
  attr: string,
  activeCompPath: string | null,
): Map<string, PersistTimelineBatchChange[]> {
  const byFile = new Map<string, PersistTimelineBatchChange[]>();
  for (const { element, value } of edits) {
    const path = element.sourceFile || activeCompPath || "index.html";
    const change: PersistTimelineBatchChange = {
      element,
      buildPatches: (html, target) =>
        applyPatchByTarget(html, target, { type: "attribute", property: attr, value }),
    };
    byFile.set(path, [...(byFile.get(path) ?? []), change]);
  }
  return byFile;
}

function patchLive(
  iframe: HTMLIFrameElement | null,
  edits: ElementAttributeEdits,
  attr: string,
  activeCompPath: string | null,
): void {
  for (const { element, value } of edits) {
    const node = findTimelineElementInIframe(iframe, element, activeCompPath);
    if (value === null) node?.removeAttribute(attr);
    else node?.setAttribute(attr, value);
    syncStoredElementAttribute(element, attr, value);
  }
}

/** One attribute written on several clips as a single save and a single undo step. */
export function useSetElementsAttribute({
  projectIdRef,
  activeCompPath,
  showToast,
  writeProjectFile,
  recordEdit,
  previewIframeRef,
  pendingTimelineEditPathRef,
  isRecordingRef,
}: UseTimelineElementVisibilityEditingInput) {
  return useCallback(
    async (
      edits: ElementAttributeEdits,
      attr: string,
      label: string,
    ): Promise<TimelineEditOutcome> => {
      const projectId = projectForTimelineSave(
        isRecordingRef?.current,
        projectIdRef.current,
        showToast,
      );
      if (typeof projectId !== "string") return projectId;
      if (edits.length === 0) return { status: "saved" };
      try {
        const byFile = editsByFile(edits, attr, activeCompPath);
        const files = Object.fromEntries(
          [...byFile].map(([path, changes]) => [
            path,
            (before: string) => patchTimelineChangesInSource(before, path, changes),
          ]),
        );
        for (const path of byFile.keys()) pendingTimelineEditPathRef.current.add(path);
        await saveProjectFilesWithHistory({
          projectId,
          label,
          files,
          readFile: (path) => readFileContent(projectId, path),
          writeFile: writeProjectFile,
          recordEdit,
        });
        patchLive(previewIframeRef.current, edits, attr, activeCompPath);
        return { status: "saved" };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Could not save the clips";
        showToast(reason, "error");
        return { status: "failed", reason };
      }
    },
    [
      projectIdRef,
      activeCompPath,
      showToast,
      writeProjectFile,
      recordEdit,
      previewIframeRef,
      pendingTimelineEditPathRef,
      isRecordingRef,
    ],
  );
}

import { useCallback } from "react";
import type { TimelineEditCallbacks } from "../player/components/timelineCallbacks";
import { syncStoredElementAttribute } from "../player/lib/automationStoreSync";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import { applyPatchByTarget } from "../utils/sourcePatcher";
import {
  buildPatchTarget,
  findTimelineElementInIframe,
  readFileContent,
} from "./timelineEditingHelpers";
import type { UseTimelineElementVisibilityEditingInput } from "./timelineTrackVisibility";

type ElementAttributeEdits = Parameters<
  NonNullable<TimelineEditCallbacks["onSetElementsAttributeQuiet"]>
>[0];

type PatchTarget = NonNullable<ReturnType<typeof buildPatchTarget>>;

function editsByFile(
  edits: ElementAttributeEdits,
  activeCompPath: string | null,
): Map<string, Array<{ target: PatchTarget; value: string | null }>> {
  const byFile = new Map<string, Array<{ target: PatchTarget; value: string | null }>>();
  for (const { element, value } of edits) {
    const target = buildPatchTarget(element);
    if (!target) throw new Error("A clip has no id to save it by");
    const path = element.sourceFile || activeCompPath || "index.html";
    byFile.set(path, [...(byFile.get(path) ?? []), { target, value }]);
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
}: UseTimelineElementVisibilityEditingInput) {
  return useCallback(
    async (edits: ElementAttributeEdits, attr: string, label: string): Promise<void> => {
      const projectId = projectIdRef.current;
      if (!projectId || edits.length === 0) return;
      try {
        const byFile = editsByFile(edits, activeCompPath);
        const files = Object.fromEntries(
          [...byFile].map(([path, patches]) => [
            path,
            (before: string) =>
              patches.reduce(
                (html, { target, value }) =>
                  applyPatchByTarget(html, target, { type: "attribute", property: attr, value }),
                before,
              ),
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
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Could not save the clips", "error");
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
    ],
  );
}

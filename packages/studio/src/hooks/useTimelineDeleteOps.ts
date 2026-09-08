// Timeline clip deletion: the marquee/multi path and the single-clip wrapper
// the context menu uses. Extracted verbatim from useTimelineEditing.ts to keep
// it under the studio 600-line cap, following useTimelineAssetDropOps.
import { useCallback, type MutableRefObject, type RefObject } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import { saveProjectFilesWithHistory, type RecordEditInput } from "../utils/studioFileHistory";
import { studioWriteHeaders } from "../utils/studioFileVersion";
import { getTimelineElementLabel } from "../utils/studioHelpers";
import { buildPatchTarget } from "./timelineEditingHelpers";
import { captureDurationRollback, readFileContent } from "./timelineTimingSync";
import { setCompositionDurationToContent } from "../utils/timelineAssetDrop";
import { furthestClipEndFromSource } from "../player/lib/timelineElementHelpers";

/** What a delete needs from the app, whichever entry point started it. */
interface TimelineDeleteDeps {
  activeCompPath: string | null;
  timelineElements: TimelineElement[];
  showToast: (message: string, tone?: "error" | "info") => void;
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  domEditSaveTimestampRef: MutableRefObject<number>;
  reloadPreview: () => void;
  forceReloadSdkSession?: () => void;
  previewIframeRef: RefObject<HTMLIFrameElement | null>;
}

interface UseTimelineDeleteOpsOptions extends TimelineDeleteDeps {
  projectIdRef: MutableRefObject<string | null>;
  isRecordingRef?: MutableRefObject<boolean>;
}

interface RunTimelineDeleteArgs extends TimelineDeleteDeps {
  projectId: string;
  targetPath: string;
  /** The selected clips that live in `targetPath`; the rest were dropped. */
  sameFile: TimelineElement[];
  label: string;
}

/**
 * One delete pass: remove every clip from the file, shrink the composition to
 * the remaining content, persist it as a single history entry, then resettle
 * the store and the preview. Throws on any failure; the caller reports it.
 *
 * A plain function rather than the hook callback's own body: the React Compiler
 * declines to lower a `throw` inside a `try`/`catch`, and this is where all of
 * them are.
 */
// fallow-ignore-next-line complexity
async function runTimelineDelete({
  projectId,
  targetPath,
  sameFile,
  label,
  activeCompPath,
  timelineElements,
  showToast,
  writeProjectFile,
  recordEdit,
  domEditSaveTimestampRef,
  reloadPreview,
  forceReloadSdkSession,
  previewIframeRef,
}: RunTimelineDeleteArgs): Promise<void> {
  const originalContent = await readFileContent(projectId, targetPath);

  // Remove every selected element before saving once. The server rewrites
  // the file per call, so `removedContent` after the last one holds them
  // all, which is what makes this a single history entry, and a single
  // undo, rather than one per clip.
  let removedContent = originalContent;
  for (const target of sameFile) {
    const patchTarget = buildPatchTarget(target);
    if (!patchTarget) {
      throw new Error(`Timeline element ${target.id} is missing a patchable target`);
    }

    const removeResponse = await fetch(
      `/api/projects/${projectId}/file-mutations/remove-element/${encodeURIComponent(targetPath)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...studioWriteHeaders() },
        body: JSON.stringify({ target: patchTarget }),
      },
    );
    if (!removeResponse.ok) {
      throw new Error(`Failed to delete ${target.id} from ${targetPath}`);
    }

    const removeData = (await removeResponse.json()) as {
      changed?: boolean;
      content?: string;
    };
    if (typeof removeData.content === "string") removedContent = removeData.content;
  }
  // Content-driven duration: shrink the composition to the furthest
  // remaining clip end, read from the post-removal SOURCE (raw
  // data-duration), so deleting the last/longest clip removes trailing
  // empty space. Measured from the source, not the store, whose
  // durations are runtime-truncated.
  const deleteContentEnd = furthestClipEndFromSource(removedContent);
  const patchedContent = setCompositionDurationToContent(removedContent, deleteContentEnd);
  // Optimistically reflect the shrunk length in the readout/seek bar,
  // rolling it back if the persist below fails (see captureDurationRollback).
  const rollbackDuration = captureDurationRollback(previewIframeRef.current);
  if (deleteContentEnd > 0 && targetPath === (activeCompPath || "index.html")) {
    usePlayerStore.getState().setDuration(deleteContentEnd);
  }

  domEditSaveTimestampRef.current = Date.now();
  try {
    await saveProjectFilesWithHistory({
      projectId,
      label: "Delete timeline clip",
      kind: "timeline",
      files: { [targetPath]: patchedContent },
      readFile: async () => originalContent,
      // remove-element already wrote the removal, so disk holds THAT, not the
      // content read at the top. Undo still goes back to the original.
      diskContent: { [targetPath]: removedContent },
      writeFile: writeProjectFile,
      recordEdit,
    });
  } catch (error) {
    rollbackDuration();
    throw error;
  }

  const deletedKeys = new Set(sameFile.map((te) => te.key ?? te.id));
  usePlayerStore
    .getState()
    .setElements(timelineElements.filter((te) => !deletedKeys.has(te.key ?? te.id)));
  usePlayerStore.getState().setSelectedElementId(null);
  usePlayerStore.getState().setSelectedElementIds(new Set());
  forceReloadSdkSession?.();
  reloadPreview();
  showToast(
    `Deleted ${label}. Use Undo to restore ${sameFile.length === 1 ? "it" : "them"}.`,
    "info",
  );
}

export function useTimelineDeleteOps({
  projectIdRef,
  activeCompPath,
  timelineElements,
  showToast,
  writeProjectFile,
  recordEdit,
  domEditSaveTimestampRef,
  reloadPreview,
  isRecordingRef,
  forceReloadSdkSession,
  previewIframeRef,
}: UseTimelineDeleteOpsOptions) {
  // fallow-ignore-next-line complexity
  const handleTimelineElementsDelete = useCallback(
    // fallow-ignore-next-line complexity
    async (selection: TimelineElement[]) => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return;
      }
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");
      const [element] = selection;
      if (!element) return;
      const label =
        selection.length === 1 ? getTimelineElementLabel(element) : `${selection.length} clips`;

      // One file per delete pass. Every element in a marquee selection lives in
      // the composition being edited, so they share a target; anything that
      // does not is dropped rather than written to the wrong file.
      const targetPath = element.sourceFile || activeCompPath || "index.html";
      const sameFile = selection.filter(
        (candidate) => (candidate.sourceFile || activeCompPath || "index.html") === targetPath,
      );
      await runTimelineDelete({
        projectId: pid,
        targetPath,
        sameFile,
        label,
        activeCompPath,
        timelineElements,
        showToast,
        writeProjectFile,
        recordEdit,
        domEditSaveTimestampRef,
        reloadPreview,
        forceReloadSdkSession,
        previewIframeRef,
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Failed to delete timeline clip";
        showToast(message);
      });
    },
    [
      activeCompPath,
      projectIdRef,
      recordEdit,
      showToast,
      timelineElements,
      writeProjectFile,
      domEditSaveTimestampRef,
      reloadPreview,
      isRecordingRef,
      forceReloadSdkSession,
      previewIframeRef,
    ],
  );

  /** Single-clip delete — the context menu and clip chrome path. */
  const handleTimelineElementDelete = useCallback(
    async (element: TimelineElement) => {
      await handleTimelineElementsDelete([element]);
    },
    [handleTimelineElementsDelete],
  );

  return { handleTimelineElementsDelete, handleTimelineElementDelete };
}

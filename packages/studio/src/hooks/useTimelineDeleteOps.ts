import { buildProjectApiPath } from "../utils/projectRouting";
// Timeline clip deletion: the marquee/multi path and the single-clip wrapper
// the context menu uses. Extracted verbatim from useTimelineEditing.ts to keep
// it under the studio 600-line cap, following useTimelineAssetDropOps.
import { useCallback, useRef, type MutableRefObject, type RefObject } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import { saveProjectFilesWithHistory, type RecordEditInput } from "../utils/studioFileHistory";
import { studioWriteHeaders } from "../utils/studioFileVersion";
import { getTimelineElementLabel } from "../utils/studioHelpers";
import { buildPatchTarget } from "./timelineEditingHelpers";
import { captureDurationRollback, readFileContent } from "./timelineTimingSync";
import { setCompositionDurationToContent } from "../utils/timelineAssetDrop";
import { furthestClipEndFromSource } from "../player/lib/timelineElementHelpers";
import {
  resolveMainTrackDeleteRippleShifts,
  resolveShiftedElements,
} from "../player/components/timelineGapCommit";
import type {
  TimelineGroupCommitOptions,
  TimelineGroupMoveChange,
} from "./useTimelineGroupEditing";

/** Apply already-resolved ripple changes to the surviving elements for the
 *  optimistic store update after a delete. Pure — no IO. */
export function applyRippleShifts(
  survivors: TimelineElement[],
  changes: readonly TimelineGroupMoveChange[] | null,
): TimelineElement[] {
  if (!changes) return survivors;
  const newStartByElement = new Map(changes.map((c) => [c.element, c.start]));
  return survivors.map((te) => {
    const newStart = newStartByElement.get(te);
    return newStart != null ? { ...te, start: newStart } : te;
  });
}

interface UseTimelineDeleteOpsOptions {
  projectIdRef: MutableRefObject<string | null>;
  activeCompPath: string | null;
  timelineElements: TimelineElement[];
  showToast: (message: string, tone?: "error" | "info") => void;
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  reloadPreview: () => void;
  isRecordingRef?: MutableRefObject<boolean>;
  forceReloadSdkSession?: () => void;
  previewIframeRef: RefObject<HTMLIFrameElement | null>;
  /** The same atomic multi-clip move commit the track-gap menu uses, reused
   *  to ripple the main track after a delete, folded into the delete's own
   *  undo entry via a shared coalesceKey. */
  handleTimelineGroupMove: (
    changes: TimelineGroupMoveChange[],
    options?: TimelineGroupCommitOptions,
  ) => Promise<void>;
}

// Per-gesture-unique coalesce key — a monotonic counter, not Date.now() /
// Math.random() (determinism rules), mirroring gapCloseGestureSeq in
// timelineGapCommit.ts.
let deleteGestureSeq = 0;

export function useTimelineDeleteOps({
  projectIdRef,
  activeCompPath,
  timelineElements,
  showToast,
  writeProjectFile,
  recordEdit,
  reloadPreview,
  isRecordingRef,
  forceReloadSdkSession,
  previewIframeRef,
  handleTimelineGroupMove,
}: UseTimelineDeleteOpsOptions) {
  // First-use-per-session notice for the ripple. Plain info toast: Studio's
  // toast system has no action buttons, so Undo and the toggle location are
  // named in words instead.
  const rippleNoticeShownRef = useRef(false);
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
      try {
        const originalContent = await readFileContent(pid, targetPath);

        // Remove every selected element before saving once. The server rewrites
        // the file per call, so `removedContent` after the last one holds them
        // all — which is what makes this a single history entry, and a single
        // undo, rather than one per clip.
        let removedContent = originalContent;
        for (const target of sameFile) {
          const patchTarget = buildPatchTarget(target);
          if (!patchTarget) {
            throw new Error(`Timeline element ${target.id} is missing a patchable target`);
          }

          const removeResponse = await fetch(
            buildProjectApiPath(
              pid,
              `/file-mutations/remove-element/${encodeURIComponent(targetPath)}`,
            ),
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

        // Shared with the ripple move below so a folded ripple is one undo
        // step with the delete, not two (editHistory.ts coalesces by key +
        // window across separate recordEdit calls, not by label).
        const coalesceKey = `main-track-ripple-delete:${deleteGestureSeq++}`;
        const deleteHistoryLabel = "Delete timeline clip";
        try {
          await saveProjectFilesWithHistory({
            projectId: pid,
            label: deleteHistoryLabel,
            kind: "timeline",
            coalesceKey,
            files: { [targetPath]: patchedContent },
            readFile: async () => originalContent,
            // remove-element already wrote the removal, so disk holds THAT — not the
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
        const survivors = timelineElements.filter((te) => !deletedKeys.has(te.key ?? te.id));

        // Ripple: close the gap the delete left on the main track. Pure decision
        // first (resolveMainTrackDeleteRippleShifts — off, no main-track clip
        // deleted, already gapless, or a locked survivor all resolve to null),
        // then the one write, folded into the delete's undo entry above.
        const rippleShifts = resolveMainTrackDeleteRippleShifts(
          survivors,
          sameFile,
          usePlayerStore.getState().rippleEditEnabled,
        );
        let rippleApplied: TimelineGroupMoveChange[] | null = null;
        if (rippleShifts) {
          const rippleChanges = resolveShiftedElements(survivors, rippleShifts);
          try {
            await handleTimelineGroupMove(rippleChanges, {
              coalesceKey,
              coalesceMs: Number.POSITIVE_INFINITY,
              // Coalescing keeps the LAST entry's label; without this the undo
              // toast reads "Undid Move timeline clips" after a delete, naming
              // the ripple's mechanics instead of what the user actually did.
              label: deleteHistoryLabel,
            });
            rippleApplied = rippleChanges;
          } catch (error) {
            // The delete already committed; a failed ripple leaves the gap the
            // toggle-off behaviour would have left anyway — not worth undoing
            // an otherwise-successful delete over.
            console.error("[Timeline] ripple-edit failed to persist after delete", error);
            showToast("Clip deleted, but the gap could not be closed.", "error");
          }
        }

        usePlayerStore.getState().setElements(applyRippleShifts(survivors, rippleApplied));
        usePlayerStore.getState().setSelectedElementId(null);
        usePlayerStore.getState().setSelectedElementIds(new Set());
        forceReloadSdkSession?.();
        reloadPreview();
        showToast(
          `Deleted ${label}. Use Undo to restore ${sameFile.length === 1 ? "it" : "them"}.`,
          "info",
        );
        if (rippleApplied && !rippleNoticeShownRef.current) {
          rippleNoticeShownRef.current = true;
          showToast(
            "Ripple closed the gap on the main track. Undo (⌘Z) restores it, or turn off " +
              "Ripple in the timeline toolbar.",
            "info",
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to delete timeline clip";
        showToast(message);
      }
    },
    [
      activeCompPath,
      projectIdRef,
      recordEdit,
      showToast,
      timelineElements,
      writeProjectFile,
      reloadPreview,
      isRecordingRef,
      forceReloadSdkSession,
      previewIframeRef,
      handleTimelineGroupMove,
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

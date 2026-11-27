import { buildProjectApiPath } from "../utils/projectRouting";
// Timeline clip deletion: the marquee/multi path and the single-clip wrapper
// the context menu uses. Extracted verbatim from useTimelineEditing.ts to keep
// it under the studio 600-line cap, following useTimelineAssetDropOps.
import { keyHint } from "../player/components/studioShortcuts";
import { useCallback, useRef, type MutableRefObject, type RefObject } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import { saveServerRewriteWithHistory, type RecordEditInput } from "../utils/studioFileHistory";
import { studioWriteHeaders } from "../utils/studioFileVersion";
import {
  deletedNotice,
  getTimelineElementLabel,
  resolveTimelineIdForSelection,
} from "../utils/studioHelpers";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { ApplyMarqueeSelection } from "./useTimelineEditingTypes";
import { buildPatchTarget, syncCompositionDurationWithEnd } from "./timelineEditingHelpers";
import { timingGestureStep } from "./timelineTimingSync";
import { captureDurationRollback, removeIframeTimelineElements } from "./previewTimingPatch";
import { setLinkInSource } from "../components/editor/mediaLinkEdits";
import {
  resolveMainTrackDeleteRippleShifts,
  resolveShiftedElements,
} from "../player/components/timelineGapCommit";
import type {
  TimelineGroupCommitOptions,
  TimelineGroupMoveChange,
} from "./useTimelineGroupEditing";
import { studioApiFetch } from "../utils/studioApiFetch";
import { countOf } from "../utils/countOf";
import {
  enqueueTimelineEdit,
  isClosed,
  whileShown,
  refuseWithEarlier,
  type TimelineEditQueue,
} from "./timelineEditQueue";
import { createStudioSaveHttpError } from "../utils/studioSaveDiagnostics";

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

/** Move the clips one delete's ripple shifted back on the timeline as it is now and put
 *  `restore` back, so a later delete still saving stays gone. */
function undoRippleShift(changes: TimelineGroupMoveChange[] | null, restore: TimelineElement[]) {
  const keyOf = (te: TimelineElement) => te.key ?? te.id;
  const back = new Map<string, number>(
    changes?.map((c) => [keyOf(c.element), c.element.start - c.start]),
  );
  const { elements, setElements } = usePlayerStore.getState();
  const unshifted = elements.map((te) => {
    const by = back.get(keyOf(te));
    return by ? { ...te, start: te.start + by } : te;
  });
  setElements([...unshifted, ...restore]);
}

interface UseTimelineDeleteOpsOptions {
  activeCompPath: string | null;
  showToast: (message: string, tone?: "error" | "info") => void;
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  reloadPreview: () => void;
  isRecordingRef?: MutableRefObject<boolean>;
  forceReloadSdkSession?: () => void;
  previewIframeRef: RefObject<HTMLIFrameElement | null>;
  /** The canvas selections (primary and group) when the delete starts. */
  canvasSelectionsRef?: RefObject<readonly DomEditSelection[]>;
  applyMarqueeSelectionRef?: RefObject<ApplyMarqueeSelection>;
  editQueueRef: TimelineEditQueue;
  /** The same atomic multi-clip move commit the track-gap menu uses, reused
   *  to ripple the main track after a delete, folded into the delete's own
   *  undo entry via a shared coalesceKey. */
  handleTimelineGroupMove: (
    changes: TimelineGroupMoveChange[],
    options?: TimelineGroupCommitOptions,
  ) => Promise<void>;
}

/** Each deleted element's canvas selection element, so a sealed frame can remove it without a lookup. */
function selectedElementsFor(
  deleted: readonly TimelineElement[],
  selections: readonly DomEditSelection[],
  elements: TimelineElement[],
  activeCompPath: string | null,
): Map<TimelineElement, Element> {
  const byKey = new Map<string, Element>();
  for (const selection of selections) {
    const key = resolveTimelineIdForSelection(selection, elements, activeCompPath);
    if (key) byKey.set(key, selection.element);
  }
  return new Map(
    deleted.flatMap((te) => {
      const element = byKey.get(te.key ?? te.id);
      return element ? [[te, element] as const] : [];
    }),
  );
}

function unlinkInSource(source: string, survivors: readonly TimelineElement[]): string {
  const targets = survivors.map(buildPatchTarget).filter((target) => target !== null);
  return targets.length > 0 ? setLinkInSource(source, targets, null) : source;
}

export function useTimelineDeleteOps({
  activeCompPath,
  showToast,
  writeProjectFile,
  recordEdit,
  reloadPreview,
  isRecordingRef,
  forceReloadSdkSession,
  previewIframeRef,
  canvasSelectionsRef,
  applyMarqueeSelectionRef,
  editQueueRef,
  handleTimelineGroupMove,
}: UseTimelineDeleteOpsOptions) {
  // First-use-per-session notice for the ripple. Plain info toast: Studio's
  // toast system has no action buttons, so Undo and the toggle location are
  // named in words instead.
  const rippleNoticeShownRef = useRef(false);
  // fallow-ignore-next-line complexity
  const handleTimelineElementsDelete = useCallback(
    // fallow-ignore-next-line complexity
    async (
      selection: TimelineElement[],
      alsoUnlink: readonly TimelineElement[] = [],
      onSettled?: (ok: boolean) => void,
    ) => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        onSettled?.(false);
        return;
      }
      if (!editQueueRef.projectId) {
        onSettled?.(false);
        throw new Error("No active project");
      }
      const [element] = selection;
      if (!element) {
        onSettled?.(false);
        return;
      }
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
        // Shared with the ripple move below so a folded ripple is one undo step with the delete.
        const step = timingGestureStep("main-track-ripple-delete");
        const deleteHistoryLabel = "Delete timeline clip";
        const deletedKeys = new Set(sameFile.map((te) => te.key ?? te.id));
        const { elements } = usePlayerStore.getState();
        const survivors = elements.filter((te) => !deletedKeys.has(te.key ?? te.id));

        // Ripple: close the gap the delete left on the main track. Pure decision
        // first (resolveMainTrackDeleteRippleShifts — off, no main-track clip
        // deleted, already gapless, or a locked survivor all resolve to null),
        // then the one write, folded into the delete's undo entry below.
        const rippleShifts = resolveMainTrackDeleteRippleShifts(
          survivors,
          sameFile,
          usePlayerStore.getState().rippleEditEnabled,
        );
        const rippleChanges = rippleShifts ? resolveShiftedElements(survivors, rippleShifts) : null;
        // Timeline and preview follow at once, so the next edit starts from this result. The preview goes
        // first: the timeline's re-render would hold back a sealed frame's removal.
        const rollbackDuration = captureDurationRollback(previewIframeRef.current);
        const selectedElements = selectedElementsFor(
          sameFile,
          canvasSelectionsRef?.current ?? [],
          elements,
          activeCompPath,
        );
        removeIframeTimelineElements(
          previewIframeRef.current,
          sameFile,
          activeCompPath,
          selectedElements,
        );
        const removed = new Set(selectedElements.values());
        const gone = (canvasSelectionsRef?.current ?? []).filter((s) => removed.has(s.element));
        if (gone.length > 0) applyMarqueeSelectionRef?.current(gone, "subtract");
        usePlayerStore.getState().setElements(applyRippleShifts(survivors, rippleChanges));
        const deleted = enqueueTimelineEdit(editQueueRef, async (pid) => {
          await saveServerRewriteWithHistory({
            projectId: pid,
            path: targetPath,
            label: deleteHistoryLabel,
            ...step,
            writeFile: writeProjectFile,
            recordEdit,
            rewrite: async (originalContent) => {
              // One request removes every selected element and rewrites the file once, so a
              // large selection is a single round trip and a single history entry.
              const patchTargets = sameFile.map((target) => {
                const patchTarget = buildPatchTarget(target);
                if (!patchTarget) {
                  throw new Error(`Timeline element ${target.id} is missing a patchable target`);
                }
                return patchTarget;
              });
              const removeResponse = await studioApiFetch(
                buildProjectApiPath(
                  pid,
                  `/file-mutations/remove-elements/${encodeURIComponent(targetPath)}`,
                ),
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json", ...studioWriteHeaders() },
                  body: JSON.stringify({ targets: patchTargets }),
                },
              );
              if (!removeResponse.ok) {
                throw await createStudioSaveHttpError(
                  removeResponse,
                  `Failed to delete ${countOf(sameFile.length, "clip")} from ${targetPath}`,
                  { path: targetPath },
                );
              }
              const removeData = (await removeResponse.json()) as { content?: string };
              const removedContent =
                typeof removeData.content === "string" ? removeData.content : originalContent;
              // Shrink to the furthest remaining clip end, read from the post-removal source:
              // store durations are runtime-truncated.
              const synced = syncCompositionDurationWithEnd(removedContent);
              const patchedContent = unlinkInSource(synced.source, alsoUnlink);
              // Optimistically reflect the shrunk length in the readout/seek bar,
              // rolling it back if the persist below fails (see captureDurationRollback).
              whileShown(editQueueRef, () => {
                if (synced.contentEnd > 0 && targetPath === (activeCompPath || "index.html")) {
                  usePlayerStore.getState().setDuration(synced.contentEnd);
                }
              });
              return { disk: removedContent, after: patchedContent };
            },
          });
        });
        // One call queues both, so no later edit can land between the delete and its shift.
        const shifted =
          rippleChanges &&
          handleTimelineGroupMove(rippleChanges, {
            beforeTiming: deleted,
            ifEarlierRefused: refuseWithEarlier,
            coalesceKey: step.coalesceKey,
            // Coalescing keeps the LAST entry's label; without this the undo
            // toast reads "Undid Move timeline clips" after a delete, naming
            // the ripple's mechanics instead of what the user actually did.
            label: deleteHistoryLabel,
            // This call gets its own, more specific failure toast below —
            // the generic one would tell the user about one action twice.
            suppressFailureToast: true,
          });
        try {
          await deleted;
        } catch (error) {
          void shifted?.catch(() => undefined);
          whileShown(editQueueRef, () => {
            rollbackDuration();
            undoRippleShift(rippleChanges, sameFile);
            reloadPreview();
          });
          throw error;
        }
        let rippleFailed = false;
        if (shifted) {
          try {
            await shifted;
          } catch (error) {
            // The delete already committed; a failed ripple leaves the gap the
            // toggle-off behaviour would have left anyway — not worth undoing
            // an otherwise-successful delete over.
            rippleFailed = true;
            whileShown(editQueueRef, () => undoRippleShift(rippleChanges, []));
            console.error("[Timeline] ripple-edit failed to persist after delete", error);
            showToast("Clip deleted, but the gap could not be closed.", "error");
          }
        }

        if (isClosed(editQueueRef)) {
          onSettled?.(true);
          return;
        }
        usePlayerStore.getState().setSelectedElementId(null);
        usePlayerStore.getState().setSelectedElementIds(new Set());
        forceReloadSdkSession?.();
        reloadPreview();
        onSettled?.(true);
        // A failed ripple already showed its own toast above; the user did one
        // thing (delete), so they get one message, not this generic follow-up too.
        if (!rippleFailed) {
          showToast(deletedNotice(label, sameFile.length), "info");
        }
        if (rippleChanges && !rippleFailed && !rippleNoticeShownRef.current) {
          rippleNoticeShownRef.current = true;
          showToast(
            `Ripple closed the gap on the main track. Undo (${keyHint("undo")}) restores it, or turn off ` +
              "Ripple in the timeline toolbar.",
            "info",
          );
        }
      } catch (error) {
        onSettled?.(false);
        const message = error instanceof Error ? error.message : "Failed to delete timeline clip";
        showToast(message);
      }
    },
    [
      activeCompPath,
      recordEdit,
      showToast,
      writeProjectFile,
      reloadPreview,
      isRecordingRef,
      forceReloadSdkSession,
      previewIframeRef,
      canvasSelectionsRef,
      applyMarqueeSelectionRef,
      editQueueRef,
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

// fallow-ignore-file code-duplication
// Move/resize operation families remain parallel until SDK graduation.
import { useCallback, type MutableRefObject, type RefObject } from "react";
import type { Composition } from "@hyperframes/sdk";
import type { TimelineElement } from "../player";
import { toAuthoredStart, toCompositionTime } from "../player/store/timelineElement";
import {
  cutoverCommittedOrThrow,
  sdkTimingBatchPersist,
  type PublishSdkSession,
} from "../utils/sdkCutover";
import {
  applyTimelineMoveAttributes,
  applyTimelineResizeAttributes,
  extendRootDurationIfNeeded,
  formatTimelineAttributeNumber,
  formatTimelineMediaOffset,
  persistTimelineBatchEdit,
  type PersistTimelineBatchChange,
  type RecordEditInput,
} from "./timelineEditingHelpers";
import { playbackStartAttributeForElement } from "../player/lib/timelineElementHelpers";
import {
  captureDurationRollback,
  patchIframeDomTiming,
  syncPreviewContentDuration,
} from "./previewTimingPatch";
import {
  finishGroupTimingGsapFallback,
  timingGestureStep,
  sdkTimingGsapSync,
  readFileContent,
  scaleGsapMutation,
  shiftGsapMutation,
} from "./timelineTimingSync";
import type { GsapMutationStatus } from "./gsapMutationClient";
import { getStudioSaveErrorMessage, getStudioSaveErrorTone } from "../utils/studioSaveDiagnostics";
import {
  enqueueTimelineEdit,
  refuseWithEarlier,
  isClosed,
  shownPreview,
  whileShown,
  type TimelineEditQueue,
} from "./timelineEditQueue";

export interface TimelineGroupMoveChange {
  element: TimelineElement;
  start: number;
  track?: number;
  audioGroup?: null;
}

export interface TimelineGroupResizeChange {
  element: TimelineElement;
  start: number;
  duration: number;
  playbackStart?: number;
}

export interface TimelineGroupCommitOptions {
  beforeTiming?: Promise<void>;
  /** Runs before writing when an edit queued earlier was refused; throwing refuses this one. */
  ifEarlierRefused?: (error: unknown) => void;
  coalesceKey?: string;
  /** Overrides the default "Move timeline clips" undo-history label. Coalescing
   *  keeps the LAST entry's label (editHistory.ts), so a mechanical follow-up
   *  move folded into another gesture's coalesceKey (e.g. the ripple after a
   *  delete) should carry that gesture's own label, not its own. */
  label?: string;
  /** Skips this call's own generic failure toast (the error is still logged
   *  to the console) — for a caller that shows its own more specific message
   *  on the same failure, so the user isn't told about one action twice. */
  suppressFailureToast?: boolean;
}

interface UseTimelineGroupEditingOptions {
  activeCompPath: string | null;
  editQueueRef: TimelineEditQueue;
  forceReloadSdkSession?: () => void;
  invalidateGsapCache?: () => void;
  isRecordingRef?: RefObject<boolean>;
  pendingTimelineEditPathRef: MutableRefObject<Set<string>>;
  previewIframeRef: RefObject<HTMLIFrameElement | null>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  reloadPreview: () => void;
  sdkSession?: Composition | null;
  publishSdkSession?: PublishSdkSession;
  showToast: (message: string, tone?: "error" | "info") => void;
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>;
}

function targetPathFor(element: TimelineElement, activeCompPath: string | null): string {
  return element.sourceFile || activeCompPath || "index.html";
}

function allChangesSharePath(
  changes: readonly { element: TimelineElement }[],
  activeCompPath: string | null,
): string | null {
  const firstPath = changes[0] ? targetPathFor(changes[0].element, activeCompPath) : null;
  if (!firstPath) return null;
  return changes.every((change) => targetPathFor(change.element, activeCompPath) === firstPath)
    ? firstPath
    : null;
}

function toSdkTimingChanges<T extends { element: TimelineElement }>(
  changes: readonly T[],
  timingUpdate: (change: T) => { start: number; duration?: number },
): Array<{ hfId: string; timingUpdate: { start: number; duration?: number } } | null> {
  return changes.map((change) =>
    change.element.hfId ? { hfId: change.element.hfId, timingUpdate: timingUpdate(change) } : null,
  );
}

function resizeHasPlaybackStartAdjustment(change: TimelineGroupResizeChange): boolean {
  return (
    change.playbackStart != null ||
    (change.start !== change.element.start && change.element.playbackStart != null)
  );
}

export function useTimelineGroupEditing({
  activeCompPath,
  editQueueRef,
  forceReloadSdkSession,
  invalidateGsapCache,
  isRecordingRef,
  pendingTimelineEditPathRef,
  previewIframeRef,
  recordEdit,
  reloadPreview,
  sdkSession,
  publishSdkSession,
  showToast,
  writeProjectFile,
}: UseTimelineGroupEditingOptions) {
  const enqueueGroupOperation = useCallback(
    (
      label: string,
      ifEarlierRefused: ((error: unknown) => void) | undefined,
      operation: (projectId: string) => Promise<void>,
    ): Promise<void> => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return Promise.reject(new Error(`${label}: blocked while recording`));
      }
      if (!editQueueRef.projectId) return Promise.reject(new Error(`${label}: no active project`));
      // The raw (rejecting) promise lets the gesture owner roll back on a real failure.
      return enqueueTimelineEdit(editQueueRef, operation, {
        label,
        ifEarlierRefused,
      });
    },
    [editQueueRef, isRecordingRef, showToast],
  );

  const persistServerBatch = useCallback(
    async (
      projectId: string,
      label: string,
      batchChanges: PersistTimelineBatchChange[],
      coalesceKey: string,
      coalesceMs?: number,
    ) => {
      await persistTimelineBatchEdit({
        projectId,
        activeCompPath,
        label,
        changes: batchChanges,
        writeProjectFile,
        recordEdit,
        pendingTimelineEditPathRef: isClosed(editQueueRef)
          ? { current: new Set<string>() }
          : pendingTimelineEditPathRef,
        coalesceKey,
        coalesceMs,
      });
      whileShown(editQueueRef, () => forceReloadSdkSession?.());
    },
    [
      activeCompPath,
      editQueueRef,
      forceReloadSdkSession,
      pendingTimelineEditPathRef,
      recordEdit,
      writeProjectFile,
    ],
  );

  // Shared SDK fast path for group move/resize: eligible when nothing needs the
  // server (no root-duration growth, one shared file, every change SDK-addressable
  // and `eligible` per the caller's own gate). Returns the SDK's GSAP sync (null: the
  // server syncs) when it handled the edit; null → caller falls through to the server.
  const trySdkBatchPersist = useCallback(
    async (input: {
      projectId: string;
      changes: readonly { element: TimelineElement }[];
      sdkChanges: Array<{
        hfId: string;
        timingUpdate: { start: number; duration?: number };
      } | null>;
      eligible: boolean;
      needsExtension: boolean;
      label: string;
      coalesceKey: string;
      coalesceMs?: number;
    }): Promise<{ sdkGsap: GsapMutationStatus | null } | null> => {
      const sharedPath = allChangesSharePath(input.changes, activeCompPath);
      const canUseSdk =
        !input.needsExtension &&
        sharedPath !== null &&
        input.eligible &&
        input.sdkChanges.every((change) => change !== null);
      if (!canUseSdk) return null;
      const shown = shownPreview(editQueueRef, {
        iframeRef: previewIframeRef,
        reloadPreview,
        publishSdkSession,
      });
      const result = await sdkTimingBatchPersist(
        input.sdkChanges.filter((change): change is NonNullable<typeof change> => change !== null),
        sharedPath,
        sdkSession,
        {
          editHistory: { recordEdit },
          writeProjectFile,
          reloadPreview: shown.reload,
          compositionPath: activeCompPath,
          readProjectFile: (path) => readFileContent(input.projectId, path),
          publishSession: shown.publish,
        },
        {
          label: input.label,
          coalesceKey: input.coalesceKey,
          coalesceMs: input.coalesceMs,
          skipRefresh: true,
        },
      );
      return cutoverCommittedOrThrow(result) ? { sdkGsap: sdkTimingGsapSync(result) } : null;
    },
    [
      activeCompPath,
      editQueueRef,
      previewIframeRef,
      publishSdkSession,
      recordEdit,
      reloadPreview,
      sdkSession,
      writeProjectFile,
    ],
  );

  const handleTimelineGroupMove = useCallback(
    (changes: TimelineGroupMoveChange[], options?: TimelineGroupCommitOptions) => {
      if (changes.length === 0) return Promise.resolve();
      for (const change of changes) {
        const attrs: Array<[string, string]> = [
          [
            "data-start",
            formatTimelineAttributeNumber(toAuthoredStart(change.element, change.start)),
          ],
        ];
        if (change.track != null) {
          attrs.push(["data-track-index", formatTimelineAttributeNumber(change.track)]);
        }
        patchIframeDomTiming(previewIframeRef.current, change.element, attrs, activeCompPath);
      }

      // TRACK-ONLY batch: every change keeps its start (moves never carry a
      // duration change), so nothing timing-related changed — the batch only
      // rewrites data-track-index, which the renderer never reads (documented
      // in core runtime/timeline.ts; track is a studio lane concept). The live
      // DOM patch above + the gesture owner's optimistic store update cover the
      // in-flight UI; after the complete lane + z transaction, that owner
      // refreshes the preview so its runtime manifest converges to disk. There
      // is still nothing to GSAP-shift here, so skip this fallback entirely.
      // Running it anyway is what made the mirrored z-order lane move blink —
      // a zero-delta batch yields no scriptText, and finishGroupTimingGsapFallback
      // used to full-reload the iframe when there was no script to soft-swap
      // (it now rebinds the runtime timing in place, but a track-only batch
      // needs NO preview sync at all, so the skip stays).
      const trackOnly = changes.every((change) => change.start === change.element.start);

      const maxEnd = Math.max(...changes.map((change) => change.start + change.element.duration));
      // Snapshot the duration BEFORE the optimistic updates below so a failed
      // persist can roll the readout + live root back (see captureDurationRollback).
      const rollbackDuration = captureDurationRollback(previewIframeRef.current);
      const shown = shownPreview(editQueueRef, { iframeRef: previewIframeRef, reloadPreview });
      // needsExtension gates the SDK path (setTiming can't grow the root duration),
      // so read the store BEFORE the readout sync below optimistically updates it.
      // Track-only batches leave every clip end unchanged, so both this and the
      // readout sync below are provable no-ops there — kept unconditional so the
      // duration machinery stays on one code path.
      const needsExtension = extendRootDurationIfNeeded(maxEnd);
      // Optimistic duration readout: content-driven (grow AND shrink), read from
      // the just-patched live DOM. See syncPreviewContentDuration.
      syncPreviewContentDuration(previewIframeRef.current);
      const { coalesceKey, coalesceMs } = timingGestureStep("timeline-group-move", options);
      const label = options?.label ?? "Move timeline clips";
      return enqueueGroupOperation(label, options?.ifEarlierRefused, async (projectId) => {
        await options?.beforeTiming;
        const sdk = await trySdkBatchPersist({
          projectId,
          changes,
          sdkChanges: toSdkTimingChanges(changes, (change) => ({
            start: toAuthoredStart(change.element, change.start),
          })),
          eligible: changes.every(
            (change) => change.track == null && change.audioGroup === undefined,
          ),
          needsExtension,
          label,
          coalesceKey,
          coalesceMs,
        });
        if (!sdk) {
          await persistServerBatch(
            projectId,
            label,
            changes.map((change) => ({
              element: change.element,
              buildPatches: (original, target) =>
                applyTimelineMoveAttributes(
                  original,
                  target,
                  toAuthoredStart(change.element, change.start),
                  change.element.duration,
                  change.track,
                  change.audioGroup,
                ),
            })),
            coalesceKey,
            coalesceMs,
          );
        }
        // Track-only: no timing delta → no GSAP positions to shift and no
        // reload (see the trackOnly doc above). Mixed batches (any start
        // change) keep the full fallback below.
        if (trackOnly) return;
        // The timing persist above already committed to disk, so the cached
        // GSAP read is stale whether or not the position rewrite succeeded —
        // invalidate on the error path too (matches the single-element path's
        // `.finally`), or a failed rewrite leaves the editor reading old tweens.
        try {
          await finishGroupTimingGsapFallback({
            projectId,
            iframe: shown.iframe(),
            reloadPreview: shown.reload,
            label,
            errorLabel: "Failed to shift GSAP positions",
            coalesceKey,
            recordEdit,
            writeProjectFile,
            activeCompPath,
            changes,
            sdkGsap: sdk?.sdkGsap,
            resolveChangePath: (element) => targetPathFor(element, activeCompPath),
            mutationFor: (change) =>
              shiftGsapMutation(change.element.domId, change.start - change.element.start),
          });
        } finally {
          whileShown(editQueueRef, () => invalidateGsapCache?.());
        }
      }).catch((error) => {
        // Failed persist: revert the optimistic duration readout + live root
        // alongside the gesture owner's store rollback.
        whileShown(editQueueRef, rollbackDuration);
        if (options?.suppressFailureToast) {
          console.error("[Timeline] group move failed to persist", error);
        } else {
          showToast(getStudioSaveErrorMessage(error), getStudioSaveErrorTone(error));
        }
        throw error;
      });
    },
    [
      activeCompPath,
      editQueueRef,
      enqueueGroupOperation,
      persistServerBatch,
      previewIframeRef,
      recordEdit,
      reloadPreview,
      trySdkBatchPersist,
      showToast,
      invalidateGsapCache,
      writeProjectFile,
    ],
  );

  const handleTimelineGroupResize = useCallback(
    (changes: TimelineGroupResizeChange[], options?: TimelineGroupCommitOptions) => {
      if (changes.length === 0) return Promise.resolve();
      for (const change of changes) {
        const liveAttrs: Array<[string, string]> = [
          [
            "data-start",
            formatTimelineAttributeNumber(toAuthoredStart(change.element, change.start)),
          ],
          ["data-duration", formatTimelineAttributeNumber(change.duration)],
        ];
        if (change.playbackStart != null) {
          const liveAttr = playbackStartAttributeForElement(change.element);
          liveAttrs.push([liveAttr, formatTimelineMediaOffset(change.playbackStart)]);
        }
        patchIframeDomTiming(previewIframeRef.current, change.element, liveAttrs, activeCompPath);
      }

      const maxEnd = Math.max(...changes.map((change) => change.start + change.duration));
      // Snapshot the duration BEFORE the optimistic updates below so a failed
      // persist can roll the readout + live root back (see captureDurationRollback).
      const rollbackDuration = captureDurationRollback(previewIframeRef.current);
      const shown = shownPreview(editQueueRef, { iframeRef: previewIframeRef, reloadPreview });
      // needsExtension gates the SDK path (setTiming can't grow the root duration),
      // so read the store BEFORE the readout sync below optimistically updates it.
      const needsExtension = extendRootDurationIfNeeded(maxEnd);
      // Optimistic duration readout: content-driven (grow AND shrink), read from
      // the just-patched live DOM. See syncPreviewContentDuration.
      syncPreviewContentDuration(previewIframeRef.current);
      const { coalesceKey, coalesceMs } = timingGestureStep("timeline-group-resize", options);
      const derivedStarts = refuseWithEarlier;
      return enqueueGroupOperation("Resize timeline clips", derivedStarts, async (projectId) => {
        await options?.beforeTiming;
        const sdk = await trySdkBatchPersist({
          projectId,
          changes,
          sdkChanges: toSdkTimingChanges(changes, (change) => ({
            start: toAuthoredStart(change.element, change.start),
            duration: change.duration,
          })),
          eligible: changes.every((change) => !resizeHasPlaybackStartAdjustment(change)),
          needsExtension,
          label: "Resize timeline clips",
          coalesceKey,
          coalesceMs,
        });
        if (!sdk) {
          await persistServerBatch(
            projectId,
            "Resize timeline clips",
            changes.map((change) => ({
              element: change.element,
              buildPatches: (original, target) =>
                applyTimelineResizeAttributes(original, target, change.element, {
                  start: change.start,
                  duration: change.duration,
                  playbackStart: change.playbackStart,
                }),
            })),
            coalesceKey,
            coalesceMs,
          );
        }
        // See the move path: the timing persist is already on disk, so the GSAP
        // cache must be invalidated even when the position rewrite throws.
        try {
          await finishGroupTimingGsapFallback({
            projectId,
            iframe: shown.iframe(),
            reloadPreview: shown.reload,
            label: "Resize timeline clips",
            errorLabel: "Failed to scale GSAP positions",
            coalesceKey,
            recordEdit,
            writeProjectFile,
            activeCompPath,
            changes,
            sdkGsap: sdk?.sdkGsap,
            resolveChangePath: (element) => targetPathFor(element, activeCompPath),
            mutationFor: (change) =>
              scaleGsapMutation(
                change.element.domId,
                toCompositionTime(change.element, change.element.start),
                change.element.duration,
                toCompositionTime(change.element, change.start),
                change.duration,
              ),
          });
        } finally {
          whileShown(editQueueRef, () => invalidateGsapCache?.());
        }
      }).catch((error) => {
        // Failed persist: revert the optimistic duration readout + live root
        // alongside the gesture owner's store rollback.
        whileShown(editQueueRef, rollbackDuration);
        showToast(getStudioSaveErrorMessage(error), getStudioSaveErrorTone(error));
        throw error;
      });
    },
    [
      activeCompPath,
      editQueueRef,
      enqueueGroupOperation,
      persistServerBatch,
      previewIframeRef,
      recordEdit,
      reloadPreview,
      trySdkBatchPersist,
      showToast,
      invalidateGsapCache,
      writeProjectFile,
    ],
  );

  return { handleTimelineGroupMove, handleTimelineGroupResize };
}

import { useCallback, type MutableRefObject, type RefObject } from "react";
import type { Composition } from "@hyperframes/sdk";
import type { TimelineElement } from "../player";
import { sdkTimingBatchPersist } from "../utils/sdkCutover";
import {
  buildTimelineMoveTimingPatch,
  buildTimelineResizeTimingPatch,
  extendRootDurationIfNeeded,
  formatTimelineAttributeNumber,
  patchIframeDomTiming,
  persistTimelineBatchEdit,
  type PersistTimelineBatchChange,
  type RecordEditInput,
} from "./timelineEditingHelpers";
import {
  captureDurationRollback,
  finishGroupTimingGsapFallback,
  readFileContent,
  scaleGsapPositions,
  shiftGsapPositions,
  syncPreviewContentDuration,
} from "./timelineTimingSync";

export interface TimelineGroupMoveChange {
  element: TimelineElement;
  start: number;
  track?: number;
}

export interface TimelineGroupResizeChange {
  element: TimelineElement;
  start: number;
  duration: number;
  playbackStart?: number;
}

export interface TimelineGroupCommitOptions {
  beforeTiming?: Promise<void>;
  coalesceKey?: string;
}

interface UseTimelineGroupEditingOptions {
  activeCompPath: string | null;
  domEditSaveTimestampRef: MutableRefObject<number>;
  editQueueRef: MutableRefObject<Promise<unknown>>;
  forceReloadSdkSession?: () => void;
  isRecordingRef?: RefObject<boolean>;
  pendingTimelineEditPathRef: MutableRefObject<Set<string>>;
  previewIframeRef: RefObject<HTMLIFrameElement | null>;
  projectIdRef: MutableRefObject<string | null>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  reloadPreview: () => void;
  sdkSession?: Composition | null;
  showToast: (message: string, tone?: "error" | "info") => void;
  writeProjectFile: (path: string, content: string) => Promise<void>;
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

function moveCoalesceKey(changes: readonly TimelineGroupMoveChange[]): string {
  return `timeline-group-move:${changes.map((change) => change.element.hfId ?? change.element.id).join(",")}`;
}

function resizeCoalesceKey(changes: readonly TimelineGroupResizeChange[]): string {
  return `timeline-group-resize:${changes.map((change) => change.element.hfId ?? change.element.id).join(",")}`;
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
  domEditSaveTimestampRef,
  editQueueRef,
  forceReloadSdkSession,
  isRecordingRef,
  pendingTimelineEditPathRef,
  previewIframeRef,
  projectIdRef,
  recordEdit,
  reloadPreview,
  sdkSession,
  showToast,
  writeProjectFile,
}: UseTimelineGroupEditingOptions) {
  const enqueueGroupOperation = useCallback(
    (label: string, operation: (projectId: string) => Promise<void>): Promise<void> => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return Promise.reject(new Error(`${label}: blocked while recording`));
      }
      const projectId = projectIdRef.current;
      if (!projectId) return Promise.reject(new Error(`${label}: no active project`));
      const run = editQueueRef.current.then(() => operation(projectId));
      // Keep the shared edit queue from wedging on a rejection, but return the raw
      // (rejecting) promise so the gesture owner can roll back on a real failure.
      editQueueRef.current = run.then(
        () => undefined,
        (error) => {
          console.error(`[Timeline] Failed to persist: ${label}`, error);
        },
      );
      return run;
    },
    [editQueueRef, isRecordingRef, projectIdRef, showToast],
  );

  const persistServerBatch = useCallback(
    async (
      projectId: string,
      label: string,
      batchChanges: PersistTimelineBatchChange[],
      coalesceKey: string,
    ) => {
      await persistTimelineBatchEdit({
        projectId,
        activeCompPath,
        label,
        changes: batchChanges,
        writeProjectFile,
        recordEdit,
        domEditSaveTimestampRef,
        pendingTimelineEditPathRef,
        coalesceKey,
      });
      forceReloadSdkSession?.();
    },
    [
      activeCompPath,
      domEditSaveTimestampRef,
      forceReloadSdkSession,
      pendingTimelineEditPathRef,
      recordEdit,
      writeProjectFile,
    ],
  );

  // Shared SDK fast path for group move/resize: eligible when nothing needs the
  // server (no root-duration growth, one shared file, every change SDK-addressable
  // and `eligible` per the caller's own gate). Returns whether the SDK handled it;
  // false → caller falls through to the server batch persist.
  const trySdkBatchPersist = useCallback(
    async (input: {
      changes: readonly { element: TimelineElement }[];
      sdkChanges: Array<{
        hfId: string;
        timingUpdate: { start: number; duration?: number };
      } | null>;
      eligible: boolean;
      needsExtension: boolean;
      label: string;
      coalesceKey: string;
    }): Promise<boolean> => {
      const sharedPath = allChangesSharePath(input.changes, activeCompPath);
      const canUseSdk =
        !input.needsExtension &&
        sharedPath !== null &&
        input.eligible &&
        input.sdkChanges.every((change) => change !== null);
      if (!canUseSdk) return false;
      return sdkTimingBatchPersist(
        input.sdkChanges.filter((change): change is NonNullable<typeof change> => change !== null),
        sharedPath,
        sdkSession,
        {
          editHistory: { recordEdit },
          writeProjectFile,
          reloadPreview,
          domEditSaveTimestampRef,
          compositionPath: activeCompPath,
          readProjectFile: (path) => readFileContent(projectIdRef.current ?? "", path),
        },
        { label: input.label, coalesceKey: input.coalesceKey },
      );
    },
    [
      activeCompPath,
      domEditSaveTimestampRef,
      projectIdRef,
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
          ["data-start", formatTimelineAttributeNumber(change.start)],
        ];
        if (change.track != null) {
          attrs.push(["data-track-index", formatTimelineAttributeNumber(change.track)]);
        }
        patchIframeDomTiming(previewIframeRef.current, change.element, attrs);
      }

      const maxEnd = Math.max(...changes.map((change) => change.start + change.element.duration));
      // Snapshot the duration BEFORE the optimistic updates below so a failed
      // persist can roll the readout + live root back (see captureDurationRollback).
      const rollbackDuration = captureDurationRollback(previewIframeRef.current);
      // needsExtension gates the SDK path (setTiming can't grow the root duration),
      // so read the store BEFORE the readout sync below optimistically updates it.
      const needsExtension = extendRootDurationIfNeeded(maxEnd);
      // Optimistic duration readout: content-driven (grow AND shrink), read from
      // the just-patched live DOM. See syncPreviewContentDuration.
      syncPreviewContentDuration(previewIframeRef.current);
      const coalesceKey = options?.coalesceKey ?? moveCoalesceKey(changes);
      return enqueueGroupOperation("Move timeline clips", async (projectId) => {
        await options?.beforeTiming;
        const handledBySdk = await trySdkBatchPersist({
          changes,
          sdkChanges: toSdkTimingChanges(changes, (change) => ({ start: change.start })),
          eligible: changes.every((change) => change.track == null),
          needsExtension,
          label: "Move timeline clips",
          coalesceKey,
        });
        if (handledBySdk) return;

        await persistServerBatch(
          projectId,
          "Move timeline clips",
          changes.map((change) => ({
            element: change.element,
            buildPatches: (original, target) =>
              buildTimelineMoveTimingPatch(
                original,
                target,
                change.start,
                change.element.duration,
                change.track,
              ),
          })),
          coalesceKey,
        );
        await finishGroupTimingGsapFallback({
          projectId,
          iframe: previewIframeRef.current,
          reloadPreview,
          label: "Move timeline clips",
          errorLabel: "Failed to shift GSAP positions",
          coalesceKey,
          recordEdit,
          activeCompPath,
          changes,
          resolveChangePath: (element) => targetPathFor(element, activeCompPath),
          mutateChange: (change, changePath) => {
            const delta = change.start - change.element.start;
            const domId = change.element.domId;
            if (delta === 0 || !domId) return null;
            return shiftGsapPositions(projectId, changePath, domId, delta);
          },
        });
      }).catch((error) => {
        // Failed persist: revert the optimistic duration readout + live root
        // alongside the gesture owner's store rollback.
        rollbackDuration();
        throw error;
      });
    },
    [
      activeCompPath,
      enqueueGroupOperation,
      persistServerBatch,
      previewIframeRef,
      recordEdit,
      reloadPreview,
      trySdkBatchPersist,
    ],
  );

  const handleTimelineGroupResize = useCallback(
    (changes: TimelineGroupResizeChange[], options?: TimelineGroupCommitOptions) => {
      if (changes.length === 0) return Promise.resolve();
      for (const change of changes) {
        const liveAttrs: Array<[string, string]> = [
          ["data-start", formatTimelineAttributeNumber(change.start)],
          ["data-duration", formatTimelineAttributeNumber(change.duration)],
        ];
        if (change.playbackStart != null) {
          const liveAttr =
            change.element.playbackStartAttr === "playback-start"
              ? "data-playback-start"
              : "data-media-start";
          liveAttrs.push([liveAttr, formatTimelineAttributeNumber(change.playbackStart)]);
        }
        patchIframeDomTiming(previewIframeRef.current, change.element, liveAttrs);
      }

      const maxEnd = Math.max(...changes.map((change) => change.start + change.duration));
      // Snapshot the duration BEFORE the optimistic updates below so a failed
      // persist can roll the readout + live root back (see captureDurationRollback).
      const rollbackDuration = captureDurationRollback(previewIframeRef.current);
      // needsExtension gates the SDK path (setTiming can't grow the root duration),
      // so read the store BEFORE the readout sync below optimistically updates it.
      const needsExtension = extendRootDurationIfNeeded(maxEnd);
      // Optimistic duration readout: content-driven (grow AND shrink), read from
      // the just-patched live DOM. See syncPreviewContentDuration.
      syncPreviewContentDuration(previewIframeRef.current);
      const coalesceKey = options?.coalesceKey ?? resizeCoalesceKey(changes);
      return enqueueGroupOperation("Resize timeline clips", async (projectId) => {
        await options?.beforeTiming;
        const handledBySdk = await trySdkBatchPersist({
          changes,
          sdkChanges: toSdkTimingChanges(changes, (change) => ({
            start: change.start,
            duration: change.duration,
          })),
          eligible: changes.every((change) => !resizeHasPlaybackStartAdjustment(change)),
          needsExtension,
          label: "Resize timeline clips",
          coalesceKey,
        });
        if (handledBySdk) return;

        await persistServerBatch(
          projectId,
          "Resize timeline clips",
          changes.map((change) => ({
            element: change.element,
            buildPatches: (original, target) =>
              buildTimelineResizeTimingPatch(original, target, change.element, {
                start: change.start,
                duration: change.duration,
                playbackStart: change.playbackStart,
              }),
          })),
          coalesceKey,
        );
        await finishGroupTimingGsapFallback({
          projectId,
          iframe: previewIframeRef.current,
          reloadPreview,
          label: "Resize timeline clips",
          errorLabel: "Failed to scale GSAP positions",
          coalesceKey,
          recordEdit,
          activeCompPath,
          changes,
          resolveChangePath: (element) => targetPathFor(element, activeCompPath),
          mutateChange: (change, changePath) => {
            const domId = change.element.domId;
            const timingChanged =
              change.start !== change.element.start || change.duration !== change.element.duration;
            if (!timingChanged || !domId) return null;
            return scaleGsapPositions(
              projectId,
              changePath,
              domId,
              change.element.start,
              change.element.duration,
              change.start,
              change.duration,
            );
          },
        });
      }).catch((error) => {
        // Failed persist: revert the optimistic duration readout + live root
        // alongside the gesture owner's store rollback.
        rollbackDuration();
        throw error;
      });
    },
    [
      activeCompPath,
      enqueueGroupOperation,
      persistServerBatch,
      previewIframeRef,
      recordEdit,
      reloadPreview,
      trySdkBatchPersist,
    ],
  );

  return { handleTimelineGroupMove, handleTimelineGroupResize };
}

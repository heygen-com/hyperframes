import { useCallback, type MutableRefObject, type RefObject } from "react";
import type { Composition } from "@hyperframes/sdk";
import type { TimelineElement } from "../player";
import { sdkTimingBatchPersist } from "../utils/sdkCutover";
import {
  buildTimelineMoveTimingPatch,
  buildTimelineResizeTimingPatch,
  extendRootDurationIfNeeded,
  finishTimelineTimingFallback,
  foldGsapMutationIntoHistory,
  formatTimelineAttributeNumber,
  patchIframeDomTiming,
  persistTimelineBatchEdit,
  readFileContent,
  scaleGsapPositions,
  shiftGsapPositions,
  type PersistTimelineBatchChange,
  type RecordEditInput,
} from "./timelineEditingHelpers";

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
      const needsExtension = extendRootDurationIfNeeded(maxEnd);
      const coalesceKey = options?.coalesceKey ?? moveCoalesceKey(changes);
      return enqueueGroupOperation("Move timeline clips", async (projectId) => {
        await options?.beforeTiming;
        const sharedPath = allChangesSharePath(changes, activeCompPath);
        const sdkChanges = changes.map((change) =>
          change.element.hfId
            ? { hfId: change.element.hfId, timingUpdate: { start: change.start } }
            : null,
        );
        const canUseSdk =
          !needsExtension &&
          sharedPath !== null &&
          changes.every((change) => change.track == null) &&
          sdkChanges.every((change) => change !== null);
        if (canUseSdk) {
          const handled = await sdkTimingBatchPersist(
            sdkChanges.filter((change): change is NonNullable<typeof change> => change !== null),
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
            { label: "Move timeline clips", coalesceKey },
          );
          if (handled) return;
        }

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
        await finishTimelineTimingFallback({
          iframe: previewIframeRef.current,
          needsExtension,
          rootDurationSeconds: maxEnd,
          reloadPreview,
          gsapMutation: () =>
            foldGsapMutationIntoHistory({
              projectId,
              paths: changes.map((change) => targetPathFor(change.element, activeCompPath)),
              label: "Move timeline clips",
              coalesceKey,
              recordEdit,
              gsapMutation: async () => {
                let mutated = false;
                for (const change of changes) {
                  const delta = change.start - change.element.start;
                  const domId = change.element.domId;
                  if (delta === 0 || !domId) continue;
                  const status = await shiftGsapPositions(
                    projectId,
                    targetPathFor(change.element, activeCompPath),
                    domId,
                    delta,
                  );
                  mutated = mutated || status.mutated;
                }
                return { mutated };
              },
            }),
          onGsapError: (err) => console.error("[Timeline] Failed to shift GSAP positions", err),
        });
      });
    },
    [
      activeCompPath,
      domEditSaveTimestampRef,
      enqueueGroupOperation,
      persistServerBatch,
      previewIframeRef,
      projectIdRef,
      recordEdit,
      reloadPreview,
      sdkSession,
      writeProjectFile,
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
      const needsExtension = extendRootDurationIfNeeded(maxEnd);
      const coalesceKey = options?.coalesceKey ?? resizeCoalesceKey(changes);
      return enqueueGroupOperation("Resize timeline clips", async (projectId) => {
        await options?.beforeTiming;
        const sharedPath = allChangesSharePath(changes, activeCompPath);
        const sdkChanges = changes.map((change) =>
          change.element.hfId
            ? {
                hfId: change.element.hfId,
                timingUpdate: { start: change.start, duration: change.duration },
              }
            : null,
        );
        const canUseSdk =
          !needsExtension &&
          sharedPath !== null &&
          changes.every((change) => !resizeHasPlaybackStartAdjustment(change)) &&
          sdkChanges.every((change) => change !== null);
        if (canUseSdk) {
          const handled = await sdkTimingBatchPersist(
            sdkChanges.filter((change): change is NonNullable<typeof change> => change !== null),
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
            { label: "Resize timeline clips", coalesceKey },
          );
          if (handled) return;
        }

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
        await finishTimelineTimingFallback({
          iframe: previewIframeRef.current,
          needsExtension,
          rootDurationSeconds: maxEnd,
          reloadPreview,
          gsapMutation: () =>
            foldGsapMutationIntoHistory({
              projectId,
              paths: changes.map((change) => targetPathFor(change.element, activeCompPath)),
              label: "Resize timeline clips",
              coalesceKey,
              recordEdit,
              gsapMutation: async () => {
                let mutated = false;
                for (const change of changes) {
                  const domId = change.element.domId;
                  const timingChanged =
                    change.start !== change.element.start ||
                    change.duration !== change.element.duration;
                  if (!timingChanged || !domId) continue;
                  const status = await scaleGsapPositions(
                    projectId,
                    targetPathFor(change.element, activeCompPath),
                    domId,
                    change.element.start,
                    change.element.duration,
                    change.start,
                    change.duration,
                  );
                  mutated = mutated || status.mutated;
                }
                return { mutated };
              },
            }),
          onGsapError: (err) => console.error("[Timeline] Failed to scale GSAP positions", err),
        });
      });
    },
    [
      activeCompPath,
      domEditSaveTimestampRef,
      enqueueGroupOperation,
      persistServerBatch,
      previewIframeRef,
      projectIdRef,
      recordEdit,
      reloadPreview,
      sdkSession,
      writeProjectFile,
    ],
  );

  return { handleTimelineGroupMove, handleTimelineGroupResize };
}

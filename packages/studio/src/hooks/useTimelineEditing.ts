// fallow-ignore-file complexity
import { useCallback, useRef } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import { useRazorSplit } from "./useRazorSplit";
import { selectSplittableElements } from "../utils/timelineElementSplit";
import { useTimelineAssetDropOps } from "./useTimelineAssetDropOps";
import {
  applyTimelineStackingReorder,
  patchIframeDomTiming,
  playbackStartAttributeForElement,
  persistTimelineEdit,
  formatTimelineAttributeNumber,
  extendRootDurationIfNeeded,
  buildTimelineMoveTimingPatch,
  buildTimelineResizeTimingPatch,
} from "./timelineEditingHelpers";
import {
  captureDurationRollback,
  finishClipTimingFallback,
  readFileContent,
  syncPreviewContentDuration,
} from "./timelineTimingSync";
import type { PersistTimelineEditInput } from "./timelineEditingHelpers";
import { useSetAudioGroupAttribute } from "./timelineAudioGroupVolume";
import { useSetElementAttribute } from "./timelineElementFxAttribute";
import { useTimelineDeleteOps } from "./useTimelineDeleteOps";
import { useTrackPendingTimelineEdit } from "./useTrackPendingTimelineEdit";
import { useAudioGroupCarveAssignment } from "./timelineAudioGroupCreate";
import {
  useTimelineElementVisibilityEditing,
  useTimelineTrackVisibilityEditing,
} from "./timelineTrackVisibility";
import { useTimelineGroupEditing } from "./useTimelineGroupEditing";
import { useBlockedTimelineEditToast } from "./useBlockedTimelineEditToast";
import {
  timelineEditRefusal,
  useTimelineEditGate,
  type TimelineEditOutcome,
} from "./timelineEditPermission";
import { serializeZLaneGesture } from "../components/nle/zLaneGesture";
import { cutoverCommittedOrThrow, sdkTimingPersist } from "../utils/sdkCutover";
import type { TimelineMoveUpdates, UseTimelineEditingOptions } from "./useTimelineEditingTypes";
import { getStudioSaveErrorMessage } from "../utils/studioSaveDiagnostics";

type GuardedTimelineHandler = (...args: never[]) => Promise<unknown>;
type GuardedTimelineResolver = (...args: never[]) => readonly TimelineElement[];
type GuardedTimelineRefusal = (...args: never[]) => unknown;

interface GuardedTimelineEntry {
  resolveTargets: GuardedTimelineResolver;
  onRefused?: GuardedTimelineRefusal;
  wrapped: GuardedTimelineHandler;
}

export function useTimelineEditing({
  projectId,
  activeCompPath,
  timelineElements,
  showToast,
  writeProjectFile,
  observeProjectFileVersion,
  recordEdit,
  reloadPreview,
  previewIframeRef,
  pendingTimelineEditPathRef,
  uploadProjectFiles,
  isRecordingRef,
  sdkSession,
  publishSdkSession,
  forceReloadSdkSession,
  invalidateGsapCache,
  handleDomZIndexReorderCommitRef,
  canEdit,
}: UseTimelineEditingOptions) {
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const editQueueRef = useRef(Promise.resolve());
  const track = useTrackPendingTimelineEdit();
  const checkEditable = useTimelineEditGate(canEdit, showToast);
  const checkEditableRef = useRef(checkEditable);
  checkEditableRef.current = checkEditable;
  const guardedRef = useRef(new WeakMap<GuardedTimelineHandler, GuardedTimelineEntry>());
  // Refuses (no call, no write, no history entry) when any target is
  // blocked; otherwise runs fn as before. Cached by fn identity — like
  // track() — so a fresh closure here doesn't defeat track's own cache.
  const guard = useCallback(
    <H extends (...args: never[]) => Promise<unknown>>(
      resolveTargets: (...args: Parameters<H>) => readonly TimelineElement[],
      fn: H,
      onRefused?: (...args: Parameters<H>) => Awaited<ReturnType<H>>,
    ): H => {
      const key = fn as unknown as GuardedTimelineHandler;
      const cached = guardedRef.current.get(key);
      if (cached) {
        cached.resolveTargets = resolveTargets as unknown as GuardedTimelineResolver;
        cached.onRefused = onRefused as unknown as GuardedTimelineRefusal | undefined;
        return cached.wrapped as H;
      }
      const entry = {} as GuardedTimelineEntry;
      entry.resolveTargets = resolveTargets as unknown as GuardedTimelineResolver;
      entry.onRefused = onRefused as unknown as GuardedTimelineRefusal | undefined;
      entry.wrapped = ((...args: Parameters<H>) => {
        if (!checkEditableRef.current(entry.resolveTargets(...(args as never[])))) {
          return Promise.resolve(entry.onRefused?.(...(args as never[])));
        }
        return fn(...args);
      }) as H as unknown as GuardedTimelineHandler;
      guardedRef.current.set(key, entry);
      return entry.wrapped as H;
    },
    [],
  );

  const enqueueEdit = useCallback(
    (
      element: TimelineElement,
      label: string,
      buildPatches: PersistTimelineEditInput["buildPatches"],
      coalesceKey?: string,
    ): Promise<void> => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return Promise.resolve();
      }
      const pid = projectIdRef.current;
      if (!pid) return Promise.resolve();
      const queued = editQueueRef.current
        .then(() =>
          persistTimelineEdit({
            projectId: pid,
            element,
            activeCompPath,
            label,
            buildPatches,
            writeProjectFile,
            recordEdit,
            pendingTimelineEditPathRef,
            coalesceKey,
          }),
        )
        .then(() => {
          forceReloadSdkSession?.();
        });
      editQueueRef.current = queued.catch((error) => {
        console.error(`[Timeline] Failed to persist: ${label}`, error);
      });
      return queued;
    },
    [
      activeCompPath,
      recordEdit,
      writeProjectFile,
      pendingTimelineEditPathRef,
      showToast,
      isRecordingRef,
      forceReloadSdkSession,
    ],
  );
  const groupEditing = useTimelineGroupEditing({
    activeCompPath,
    editQueueRef,
    forceReloadSdkSession,
    invalidateGsapCache,
    isRecordingRef,
    pendingTimelineEditPathRef,
    previewIframeRef,
    projectIdRef,
    recordEdit,
    reloadPreview,
    sdkSession,
    publishSdkSession,
    showToast,
    writeProjectFile,
  });
  const handleTimelineElementMove = useCallback(
    // fallow-ignore-next-line complexity
    (element: TimelineElement, updates: TimelineMoveUpdates) => {
      const commitMove = () => {
        const targetPath = element.sourceFile || activeCompPath || "index.html";
        const startChanged = updates.start !== element.start;
        // A vertical-only lane move arrives with start unchanged but track changed
        // (on this single-element path the drag commit has already folded the
        // AUTHORED persist track into updates.track). It must persist like any
        // other move — early-returning on !startChanged alone silently dropped
        // the file write, so the lane snapped back on reload.
        const trackChanged = updates.track !== element.track;

        if (startChanged || trackChanged) {
          const liveAttrs: Array<[string, string]> = [];
          if (startChanged) {
            liveAttrs.push(["data-start", formatTimelineAttributeNumber(updates.start)]);
          }
          if (trackChanged) {
            liveAttrs.push(["data-track-index", formatTimelineAttributeNumber(updates.track)]);
          }
          patchIframeDomTiming(previewIframeRef.current, element, liveAttrs, activeCompPath);
        }

        const reorderDone = applyTimelineStackingReorder({
          element,
          stackingReorder: updates.stackingReorder,
          timelineElements,
          iframe: previewIframeRef.current,
          activeCompPath,
          commit: handleDomZIndexReorderCommitRef?.current,
        });

        if (!startChanged && !trackChanged) return reorderDone;

        // Snapshot the duration BEFORE the optimistic updates below so a failed
        // persist can roll the readout + live root back (see captureDurationRollback).
        const rollbackDuration = captureDurationRollback(previewIframeRef.current);
        // needsExtension gates the SDK path (setTiming can't grow the root duration), so read the store BEFORE the readout sync below optimistically updates it.
        const needsExtension = extendRootDurationIfNeeded(updates.start + element.duration);
        // Optimistic duration readout: content-driven (grow AND shrink), from the just-patched live DOM. See syncPreviewContentDuration.
        syncPreviewContentDuration(previewIframeRef.current);

        const buildMovePatches: PersistTimelineEditInput["buildPatches"] = (original, target) => {
          // Persist lane changes too — data-start-only writes let reload snap the lane back.
          const track = trackChanged ? updates.track : undefined;
          return buildTimelineMoveTimingPatch(
            original,
            target,
            updates.start,
            element.duration,
            track,
          );
        };
        const coalesceKey = `timeline-move:${element.hfId ?? element.id}`;
        const finishMoveGsapSync = () =>
          // Every timing writer converges the same GSAP positions after its
          // durable clip-start commit. The SDK owns the attribute write; this
          // sync owns only the dependent animation rewrite and preview refresh.
          finishClipTimingFallback({
            iframe: previewIframeRef.current,
            reloadPreview,
            projectId: projectIdRef.current,
            targetPath,
            domId: element.domId,
            label: "Move timeline clip",
            coalesceKey,
            recordEdit,
            edit: { kind: "shift", delta: updates.start - element.start },
          }).finally(() => invalidateGsapCache?.());
        const moveFallback = () =>
          enqueueEdit(element, "Move timeline clip", buildMovePatches, coalesceKey).then(
            finishMoveGsapSync,
          );
        return reorderDone
          .then(() => {
            // The SDK setTiming path writes start only — a lane change must take
            // the fallback, whose patch builder writes data-track-index too.
            if (sdkSession && element.hfId && !needsExtension && !trackChanged) {
              return sdkTimingPersist(
                element.hfId,
                targetPath,
                { start: updates.start },
                sdkSession,
                {
                  editHistory: { recordEdit },
                  writeProjectFile,
                  reloadPreview,
                  compositionPath: activeCompPath,
                  // Capture on-disk bytes as the undo `before` so undoing a timing move
                  // restores the file verbatim, not a normalized full-DOM re-emit.
                  readProjectFile: (path) => readFileContent(projectIdRef.current ?? "", path),
                  publishSession: publishSdkSession,
                },
                { label: "Move timeline clip", coalesceKey, skipRefresh: true },
              ).then((result) => {
                if (!cutoverCommittedOrThrow(result)) return moveFallback();
                return finishMoveGsapSync();
              });
            }
            return moveFallback();
          })
          .catch((error) => {
            // Failed persist: revert the optimistic duration readout + live root.
            rollbackDuration();
            showToast(getStudioSaveErrorMessage(error), "error");
            throw error;
          });
      };
      return updates.stackingReorder ? serializeZLaneGesture(commitMove) : commitMove();
    },
    [
      previewIframeRef,
      enqueueEdit,
      activeCompPath,
      sdkSession,
      publishSdkSession,
      recordEdit,
      writeProjectFile,
      reloadPreview,
      timelineElements,
      handleDomZIndexReorderCommitRef,
      showToast,
      invalidateGsapCache,
    ],
  );

  const handleTimelineElementResize = useCallback(
    // fallow-ignore-next-line complexity
    (
      element: TimelineElement,
      updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
    ) => {
      const liveAttrs: Array<[string, string]> = [
        ["data-start", formatTimelineAttributeNumber(updates.start)],
        ["data-duration", formatTimelineAttributeNumber(updates.duration)],
      ];
      if (updates.playbackStart != null) {
        const liveAttr = playbackStartAttributeForElement(element);
        liveAttrs.push([liveAttr, formatTimelineAttributeNumber(updates.playbackStart)]);
      }
      patchIframeDomTiming(previewIframeRef.current, element, liveAttrs, activeCompPath);
      // Snapshot the duration BEFORE the optimistic updates below so a failed
      // persist can roll the readout + live root back (see captureDurationRollback).
      const rollbackDuration = captureDurationRollback(previewIframeRef.current);
      // needsExtension gates the SDK path (setTiming can't grow the root duration), so read the store BEFORE the readout sync below optimistically updates it.
      const needsExtension = extendRootDurationIfNeeded(updates.start + updates.duration);
      // Optimistic duration readout: content-driven (grow AND shrink), from the just-patched live DOM. See syncPreviewContentDuration.
      syncPreviewContentDuration(previewIframeRef.current);
      const targetPath = element.sourceFile || activeCompPath || "index.html";
      const buildResizePatches: PersistTimelineEditInput["buildPatches"] = (original, target) => {
        return buildTimelineResizeTimingPatch(original, target, element, updates);
      };
      const hasPbsAdjustment =
        updates.playbackStart != null ||
        (updates.start !== element.start && element.playbackStart != null);
      // Server-path fallback: after persisting the attr patch, scale GSAP tween
      // positions/durations on the server, then soft-reload with the rewritten
      // script (timing-only resize) — same no-flash path as move; full reload is
      // the fallback.
      const coalesceKey = `timeline-resize:${element.hfId ?? element.id}`;
      const finishResizeGsapSync = () =>
        finishClipTimingFallback({
          iframe: previewIframeRef.current,
          reloadPreview,
          projectId: projectIdRef.current,
          targetPath,
          domId: element.domId,
          label: "Resize timeline clip",
          coalesceKey,
          recordEdit,
          edit: {
            kind: "scale",
            from: { start: element.start, duration: element.duration },
            to: { start: updates.start, duration: updates.duration },
          },
        }).finally(() => invalidateGsapCache?.());
      const resizeFallback = () =>
        enqueueEdit(element, "Resize timeline clip", buildResizePatches, coalesceKey).then(
          finishResizeGsapSync,
        );
      const persistDone =
        sdkSession && element.hfId && !hasPbsAdjustment && !needsExtension
          ? sdkTimingPersist(
              element.hfId,
              targetPath,
              { start: updates.start, duration: updates.duration },
              sdkSession,
              {
                editHistory: { recordEdit },
                writeProjectFile,
                reloadPreview,
                compositionPath: activeCompPath,
                // Capture on-disk bytes as the undo `before` so undoing a timing
                // resize restores the file verbatim, not a normalized full-DOM re-emit.
                readProjectFile: (path) => readFileContent(projectIdRef.current ?? "", path),
                publishSession: publishSdkSession,
              },
              { label: "Resize timeline clip", coalesceKey, skipRefresh: true },
            ).then((result) => {
              if (!cutoverCommittedOrThrow(result)) return resizeFallback();
              return finishResizeGsapSync();
            })
          : resizeFallback();
      return persistDone.catch((error) => {
        // Failed persist: revert the optimistic duration readout + live root.
        rollbackDuration();
        showToast(getStudioSaveErrorMessage(error), "error");
        throw error;
      });
    },
    [
      previewIframeRef,
      enqueueEdit,
      activeCompPath,
      sdkSession,
      publishSdkSession,
      recordEdit,
      writeProjectFile,
      reloadPreview,
      showToast,
      invalidateGsapCache,
    ],
  );

  const handleToggleTrackHidden = useTimelineTrackVisibilityEditing({
    projectIdRef,
    activeCompPath,
    timelineElements,
    showToast,
    writeProjectFile,
    recordEdit,
    previewIframeRef,
    pendingTimelineEditPathRef,
    isRecordingRef,
    forceReloadSdkSession,
  });

  const handleToggleElementHidden = useTimelineElementVisibilityEditing({
    projectIdRef,
    activeCompPath,
    showToast,
    writeProjectFile,
    recordEdit,
    previewIframeRef,
    pendingTimelineEditPathRef,
    isRecordingRef,
    forceReloadSdkSession,
  });

  const handleAutoGroupCarveSources = useAudioGroupCarveAssignment({
    projectIdRef,
    activeCompPath,
    showToast,
    writeProjectFile,
    recordEdit,
    previewIframeRef,
    pendingTimelineEditPathRef,
    isRecordingRef,
    checkEditable,
  });

  const { revertLive: revertElementFxLive, ...setElementFxAttribute } = useSetElementAttribute({
    projectIdRef,
    activeCompPath,
    showToast,
    writeProjectFile,
    recordEdit,
    previewIframeRef,
    pendingTimelineEditPathRef,
    isRecordingRef,
  });

  const { revertLive: revertAudioGroupLive, ...setAudioGroupAttribute } = useSetAudioGroupAttribute(
    {
      projectIdRef,
      activeCompPath,
      showToast,
      writeProjectFile,
      recordEdit,
      previewIframeRef,
      pendingTimelineEditPathRef,
      isRecordingRef,
    },
  );

  const { handleTimelineElementsDelete, handleTimelineElementDelete } = useTimelineDeleteOps({
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
    handleTimelineGroupMove: groupEditing.handleTimelineGroupMove,
  });

  const { handleTimelineAssetDrop, handleTimelineFileDrop, handleTimelineCompositionDrop } =
    useTimelineAssetDropOps({
      projectIdRef,
      activeCompPath,
      timelineElements,
      showToast,
      writeProjectFile,
      recordEdit,
      reloadPreview,
      uploadProjectFiles,
      isRecordingRef,
      forceReloadSdkSession,
      observeProjectFileVersion,
      checkEditable,
    });

  const handleBlockedTimelineEdit = useBlockedTimelineEditToast(showToast);

  const { handleRazorSplit, handleRazorSplitAll } = useRazorSplit({
    projectId,
    activeCompPath,
    showToast,
    writeProjectFile,
    observeProjectFileVersion,
    recordEdit,
    reloadPreview,
    isRecordingRef,
    forceReloadSdkSession,
  });

  const refused = (targets: readonly TimelineElement[]): TimelineEditOutcome => ({
    status: "refused",
    reason: timelineEditRefusal(canEdit, targets) ?? "",
  });
  const audioGroupMembers = (groupId: string): TimelineElement[] => {
    const state = usePlayerStore.getState();
    const flatMembers = state.elements.filter((el) => el.audioGroup === groupId);
    const domMembers = state.domClipChildren
      .filter((child) => child.audioGroup === groupId)
      .map(
        (child): TimelineElement => ({
          id: child.id,
          domId: child.id,
          tag: "div",
          start: 0,
          duration: 0,
          track: -1,
        }),
      );
    return [...flatMembers, ...domMembers];
  };

  // Every write-handler is tracked here, the one place all hand edits
  // converge, so undo never races a write; canEdit gates the same point.
  // Coverage boundary: see the PR body, not every kind resolves an element.
  const trackedRazorSplit = track(guard((element) => [element], handleRazorSplit));
  return {
    handleTimelineElementMove: track(guard((element) => [element], handleTimelineElementMove)),
    handleTimelineElementResize: track(guard((element) => [element], handleTimelineElementResize)),
    handleToggleTrackHidden: track(
      guard(
        (trackIndex) => timelineElements.filter((el) => el.track === trackIndex),
        handleToggleTrackHidden,
      ),
    ),
    handleToggleElementHidden: track(
      guard((elementKey) => {
        const keys = new Set(Array.isArray(elementKey) ? elementKey : [elementKey]);
        return timelineElements.filter((el) => keys.has(el.key ?? el.id));
      }, handleToggleElementHidden),
    ),
    handleAutoGroupCarveSources: track(handleAutoGroupCarveSources),
    setAudioGroupAttribute: {
      ...setAudioGroupAttribute,
      // Same two-array member lookup syncStoredGroupAttribute mirrors into
      // (timelineAudioGroupVolume.ts): a sub-composition's group members have
      // no flat twin, only a domClipChildren entry, so both are checked.
      setQuiet: track(
        guard(audioGroupMembers, setAudioGroupAttribute.setQuiet, (groupId, attr) => {
          revertAudioGroupLive(groupId, attr);
          return refused(audioGroupMembers(groupId));
        }),
      ),
    },
    setElementFxAttribute: {
      ...setElementFxAttribute,
      setQuiet: track(
        guard(
          (element) => [element],
          setElementFxAttribute.setQuiet,
          (element, attr) => {
            revertElementFxLive(element, attr);
            return refused([element]);
          },
        ),
      ),
    },
    handleTimelineElementDelete: track(guard((element) => [element], handleTimelineElementDelete)),
    handleTimelineElementsDelete: track(
      guard((elements) => elements, handleTimelineElementsDelete),
    ),
    handleTimelineElementSplit: trackedRazorSplit,
    handleRazorSplit: trackedRazorSplit,
    // Same selection the handler itself splits (useRazorSplit.ts).
    handleRazorSplitAll: track(
      guard(
        (splitTime) => selectSplittableElements(usePlayerStore.getState().elements, splitTime),
        handleRazorSplitAll,
      ),
    ),
    handleTimelineAssetDrop: track(handleTimelineAssetDrop),
    handleTimelineFileDrop: track(handleTimelineFileDrop),
    handleTimelineCompositionDrop: track(handleTimelineCompositionDrop),
    handleBlockedTimelineEdit,
    handleTimelineGroupMove: track(
      guard((changes) => changes.map((c) => c.element), groupEditing.handleTimelineGroupMove),
    ),
    handleTimelineGroupResize: track(
      guard((changes) => changes.map((c) => c.element), groupEditing.handleTimelineGroupResize),
    ),
  };
}

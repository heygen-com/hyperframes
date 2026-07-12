// fallow-ignore-file complexity
import { useCallback, useRef } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import { useRazorSplit } from "./useRazorSplit";
import {
  buildTimelineAssetId,
  buildTimelineAssetInsertHtml,
  buildTimelineFileDropPlacements,
  getTimelineAssetKind,
  insertTimelineAssetIntoSource,
  resolveTimelineAssetInitialGeometry,
  resolveTimelineAssetSrc,
} from "../utils/timelineAssetDrop";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import {
  getTimelineElementLabel,
  collectHtmlIds,
  resolveDroppedAssetDuration,
} from "../utils/studioHelpers";
import {
  applyTimelineStackingReorder,
  buildPatchTarget,
  patchIframeDomTiming,
  persistTimelineEdit,
  readFileContent,
  foldedShiftGsapMutation,
  foldedScaleGsapMutation,
  formatTimelineAttributeNumber,
  finishTimelineTimingFallback,
  extendRootDurationIfNeeded,
  buildTimelineMoveTimingPatch,
  buildTimelineResizeTimingPatch,
} from "./timelineEditingHelpers";
import type { PersistTimelineEditInput } from "./timelineEditingHelpers";
import type { TimelineStackingReorderIntent } from "../player/components/timelineEditing";
import {
  useTimelineElementVisibilityEditing,
  useTimelineTrackVisibilityEditing,
} from "./timelineTrackVisibility";
import { useTimelineGroupEditing } from "./useTimelineGroupEditing";
import { sdkTimingPersist } from "../utils/sdkCutover";
import type { UseTimelineEditingOptions } from "./useTimelineEditingTypes";

type TimelineMoveUpdates = Pick<TimelineElement, "start" | "track"> & {
  stackingReorder?: TimelineStackingReorderIntent | null;
};

export function useTimelineEditing({
  projectId,
  activeCompPath,
  timelineElements,
  showToast,
  writeProjectFile,
  recordEdit,
  domEditSaveTimestampRef,
  reloadPreview,
  previewIframeRef,
  pendingTimelineEditPathRef,
  uploadProjectFiles,
  isRecordingRef,
  sdkSession,
  forceReloadSdkSession,
  handleDomZIndexReorderCommitRef,
}: UseTimelineEditingOptions) {
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const editQueueRef = useRef(Promise.resolve());
  const lastBlockedTimelineToastAtRef = useRef(0);

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
            domEditSaveTimestampRef,
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
      domEditSaveTimestampRef,
      pendingTimelineEditPathRef,
      showToast,
      isRecordingRef,
      forceReloadSdkSession,
    ],
  );
  const groupEditing = useTimelineGroupEditing({
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
  });

  const handleTimelineElementMove = useCallback(
    // fallow-ignore-next-line complexity
    (element: TimelineElement, updates: TimelineMoveUpdates) => {
      const targetPath = element.sourceFile || activeCompPath || "index.html";
      const startChanged = updates.start !== element.start;

      if (startChanged) {
        patchIframeDomTiming(previewIframeRef.current, element, [
          ["data-start", formatTimelineAttributeNumber(updates.start)],
        ]);
      }

      const reorderDone = applyTimelineStackingReorder({
        element,
        stackingReorder: updates.stackingReorder,
        timelineElements,
        iframe: previewIframeRef.current,
        activeCompPath,
        commit: handleDomZIndexReorderCommitRef?.current,
      });

      if (!startChanged) return reorderDone;

      const buildMovePatches: PersistTimelineEditInput["buildPatches"] = (original, target) => {
        return buildTimelineMoveTimingPatch(original, target, updates.start, element.duration);
      };
      const coalesceKey = `timeline-move:${element.hfId ?? element.id}`;
      const moveFallback = () =>
        enqueueEdit(element, "Move timeline clip", buildMovePatches, coalesceKey).then(() => {
          const pid = projectIdRef.current;
          const delta = updates.start - element.start;
          const domId = element.domId;
          return finishTimelineTimingFallback({
            iframe: previewIframeRef.current,
            needsExtension,
            rootDurationSeconds: updates.start + element.duration,
            reloadPreview,
            gsapMutation:
              delta !== 0 && domId && pid
                ? foldedShiftGsapMutation({
                    projectId: pid,
                    targetPath,
                    domId,
                    delta,
                    label: "Move timeline clip",
                    coalesceKey,
                    recordEdit,
                  })
                : undefined,
            onGsapError: (err) => console.error("[Timeline] Failed to shift GSAP positions", err),
          });
        });
      const needsExtension = extendRootDurationIfNeeded(updates.start + element.duration);
      return reorderDone.then(() => {
        if (sdkSession && element.hfId && !needsExtension) {
          return sdkTimingPersist(
            element.hfId,
            targetPath,
            { start: updates.start },
            sdkSession,
            {
              editHistory: { recordEdit },
              writeProjectFile,
              reloadPreview,
              domEditSaveTimestampRef,
              compositionPath: activeCompPath,
              // Capture on-disk bytes as the undo `before` so undoing a timing move
              // restores the file verbatim, not a normalized full-DOM re-emit.
              readProjectFile: (path) => readFileContent(projectIdRef.current ?? "", path),
            },
            { label: "Move timeline clip", coalesceKey },
          ).then((handled) => {
            if (!handled) return moveFallback();
          });
        }
        return moveFallback();
      });
    },
    [
      previewIframeRef,
      enqueueEdit,
      activeCompPath,
      sdkSession,
      recordEdit,
      writeProjectFile,
      reloadPreview,
      domEditSaveTimestampRef,
      timelineElements,
      handleDomZIndexReorderCommitRef,
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
      // Patch the live playback-start/media-start attr too, or a resize that
      // trims the playback start leaves the preview showing the old in-point
      // until the next reload (the persisted patch handles it via pbs below).
      if (updates.playbackStart != null) {
        const liveAttr =
          element.playbackStartAttr === "playback-start"
            ? "data-playback-start"
            : "data-media-start";
        liveAttrs.push([liveAttr, formatTimelineAttributeNumber(updates.playbackStart)]);
      }
      patchIframeDomTiming(previewIframeRef.current, element, liveAttrs);
      const targetPath = element.sourceFile || activeCompPath || "index.html";
      const buildResizePatches: PersistTimelineEditInput["buildPatches"] = (original, target) => {
        return buildTimelineResizeTimingPatch(original, target, element, updates);
      };
      const hasPbsAdjustment =
        updates.playbackStart != null ||
        (updates.start !== element.start && element.playbackStart != null);
      // Server-path fallback: after persisting the attr patch, scale GSAP tween
      // positions/durations on the server. Extending edits can keep the iframe
      // live unless a GSAP source rewrite needs a fresh run.
      const coalesceKey = `timeline-resize:${element.hfId ?? element.id}`;
      const timingChanged =
        updates.start !== element.start || updates.duration !== element.duration;
      const needsExtension = extendRootDurationIfNeeded(updates.start + updates.duration);
      const resizeFallback = () =>
        enqueueEdit(element, "Resize timeline clip", buildResizePatches, coalesceKey).then(() => {
          const pid = projectIdRef.current;
          const domId = element.domId;
          return finishTimelineTimingFallback({
            iframe: previewIframeRef.current,
            needsExtension,
            rootDurationSeconds: updates.start + updates.duration,
            reloadPreview,
            gsapMutation:
              timingChanged && domId && pid
                ? foldedScaleGsapMutation({
                    projectId: pid,
                    targetPath,
                    domId,
                    from: { start: element.start, duration: element.duration },
                    to: { start: updates.start, duration: updates.duration },
                    label: "Resize timeline clip",
                    coalesceKey,
                    recordEdit,
                  })
                : undefined,
            onGsapError: (err) => console.error("[Timeline] Failed to scale GSAP positions", err),
          });
        });
      if (sdkSession && element.hfId && !hasPbsAdjustment && !needsExtension) {
        return sdkTimingPersist(
          element.hfId,
          targetPath,
          { start: updates.start, duration: updates.duration },
          sdkSession,
          {
            editHistory: { recordEdit },
            writeProjectFile,
            reloadPreview,
            domEditSaveTimestampRef,
            compositionPath: activeCompPath,
            // Capture on-disk bytes as the undo `before` so undoing a timing
            // resize restores the file verbatim, not a normalized full-DOM re-emit.
            readProjectFile: (path) => readFileContent(projectIdRef.current ?? "", path),
          },
          { label: "Resize timeline clip", coalesceKey },
        ).then((handled) => {
          if (!handled) return resizeFallback();
        });
      }
      return resizeFallback();
    },
    [
      previewIframeRef,
      enqueueEdit,
      activeCompPath,
      sdkSession,
      recordEdit,
      writeProjectFile,
      reloadPreview,
      domEditSaveTimestampRef,
    ],
  );

  const handleToggleTrackHidden = useTimelineTrackVisibilityEditing({
    projectIdRef,
    activeCompPath,
    timelineElements,
    showToast,
    writeProjectFile,
    recordEdit,
    domEditSaveTimestampRef,
    previewIframeRef,
    pendingTimelineEditPathRef,
    isRecordingRef,
    forceReloadSdkSession,
  });

  const handleToggleElementHidden = useTimelineElementVisibilityEditing({
    projectIdRef,
    activeCompPath,
    timelineElements,
    showToast,
    writeProjectFile,
    recordEdit,
    domEditSaveTimestampRef,
    previewIframeRef,
    pendingTimelineEditPathRef,
    isRecordingRef,
    forceReloadSdkSession,
  });

  // fallow-ignore-next-line complexity
  const handleTimelineElementDelete = useCallback(
    // fallow-ignore-next-line complexity
    async (element: TimelineElement) => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return;
      }
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");
      const label = getTimelineElementLabel(element);

      const targetPath = element.sourceFile || activeCompPath || "index.html";
      try {
        const originalContent = await readFileContent(pid, targetPath);

        const patchTarget = buildPatchTarget(element);
        if (!patchTarget) {
          throw new Error(`Timeline element ${element.id} is missing a patchable target`);
        }

        const removeResponse = await fetch(
          `/api/projects/${pid}/file-mutations/remove-element/${encodeURIComponent(targetPath)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target: patchTarget }),
          },
        );
        if (!removeResponse.ok) {
          throw new Error(`Failed to delete ${element.id} from ${targetPath}`);
        }

        const removeData = (await removeResponse.json()) as {
          changed?: boolean;
          content?: string;
        };
        const patchedContent =
          typeof removeData.content === "string" ? removeData.content : originalContent;

        domEditSaveTimestampRef.current = Date.now();
        await saveProjectFilesWithHistory({
          projectId: pid,
          label: "Delete timeline clip",
          kind: "timeline",
          files: { [targetPath]: patchedContent },
          readFile: async () => originalContent,
          writeFile: writeProjectFile,
          recordEdit,
        });

        usePlayerStore
          .getState()
          .setElements(
            timelineElements.filter((te) => (te.key ?? te.id) !== (element.key ?? element.id)),
          );
        usePlayerStore.getState().setSelectedElementId(null);
        forceReloadSdkSession?.();
        reloadPreview();
        showToast(`Deleted ${label}. Use Undo to restore it.`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to delete timeline clip";
        showToast(message);
      }
    },
    [
      activeCompPath,
      recordEdit,
      showToast,
      timelineElements,
      writeProjectFile,
      domEditSaveTimestampRef,
      reloadPreview,
      isRecordingRef,
      forceReloadSdkSession,
    ],
  );

  // fallow-ignore-next-line complexity
  const handleTimelineAssetDrop = useCallback(
    // fallow-ignore-next-line complexity
    async (
      assetPath: string,
      placement: Pick<TimelineElement, "start" | "track">,
      durationOverride?: number,
    ) => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return;
      }
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");

      const kind = getTimelineAssetKind(assetPath);
      if (!kind) {
        showToast("Only image, video, and audio assets can be dropped onto the timeline.");
        return;
      }

      const targetPath = activeCompPath || "index.html";
      try {
        const originalContent = await readFileContent(pid, targetPath);

        const normalizedStart = Number(formatTimelineAttributeNumber(placement.start));
        const duration =
          Number.isFinite(durationOverride) && durationOverride != null && durationOverride > 0
            ? durationOverride
            : await resolveDroppedAssetDuration(pid, assetPath, kind);
        const normalizedDuration = Number(formatTimelineAttributeNumber(duration));
        const newId = buildTimelineAssetId(assetPath, collectHtmlIds(originalContent));
        const resolvedAssetSrc = resolveTimelineAssetSrc(targetPath, assetPath);

        const resolvedTargetPath = targetPath || "index.html";
        const relevantElements = timelineElements.filter(
          (te) => (te.sourceFile || activeCompPath || "index.html") === resolvedTargetPath,
        );
        const newElementZIndex = Math.max(1, relevantElements.length + 1);

        const patchedContent = insertTimelineAssetIntoSource(
          originalContent,
          buildTimelineAssetInsertHtml({
            id: newId,
            assetPath: resolvedAssetSrc,
            kind,
            start: normalizedStart,
            duration: normalizedDuration,
            track: placement.track,
            zIndex: newElementZIndex,
            geometry: resolveTimelineAssetInitialGeometry(originalContent),
          }),
        );

        domEditSaveTimestampRef.current = Date.now();
        await saveProjectFilesWithHistory({
          projectId: pid,
          label: "Add timeline asset",
          kind: "timeline",
          files: { [targetPath]: patchedContent },
          readFile: async () => originalContent,
          writeFile: writeProjectFile,
          recordEdit,
        });

        forceReloadSdkSession?.();
        reloadPreview();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to drop asset onto timeline";
        showToast(message);
      }
    },
    [
      activeCompPath,
      recordEdit,
      showToast,
      timelineElements,
      writeProjectFile,
      domEditSaveTimestampRef,
      reloadPreview,
      isRecordingRef,
      forceReloadSdkSession,
    ],
  );

  // fallow-ignore-next-line complexity
  const handleTimelineFileDrop = useCallback(
    // fallow-ignore-next-line complexity
    async (files: File[], placement?: Pick<TimelineElement, "start" | "track">) => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return;
      }
      const pid = projectIdRef.current;
      if (!pid) return;
      const uploaded = await uploadProjectFiles(files);
      if (uploaded.length === 0) return;
      const durations: number[] = [];
      for (const assetPath of uploaded) {
        const kind = getTimelineAssetKind(assetPath);
        const duration = kind ? await resolveDroppedAssetDuration(pid, assetPath, kind) : 0;
        durations.push(Number(formatTimelineAttributeNumber(duration)));
      }
      const placements = buildTimelineFileDropPlacements(
        placement ?? { start: 0, track: 0 },
        durations,
        timelineElements
          .filter(
            (te) =>
              (te.sourceFile || activeCompPath || "index.html") ===
              (activeCompPath || "index.html"),
          )
          .map((te) => ({
            start: te.start,
            duration: te.duration,
            track: te.track,
          })),
      );
      for (const [index, assetPath] of uploaded.entries()) {
        await handleTimelineAssetDrop(
          assetPath,
          placements[index] ?? placements[0],
          durations[index],
        );
      }
    },
    [
      activeCompPath,
      handleTimelineAssetDrop,
      timelineElements,
      uploadProjectFiles,
      isRecordingRef,
      showToast,
    ],
  );

  const handleBlockedTimelineEdit = useCallback(
    (_element: TimelineElement) => {
      const now = Date.now();
      if (now - lastBlockedTimelineToastAtRef.current < 1500) return;
      lastBlockedTimelineToastAtRef.current = now;
      showToast("This clip can't be moved or resized from the timeline yet.", "info");
    },
    [showToast],
  );

  const { handleRazorSplit, handleRazorSplitAll } = useRazorSplit({
    projectId,
    activeCompPath,
    showToast,
    writeProjectFile,
    recordEdit,
    domEditSaveTimestampRef,
    reloadPreview,
    isRecordingRef,
  });

  return {
    handleTimelineElementMove,
    handleTimelineElementResize,
    handleToggleTrackHidden,
    handleToggleElementHidden,
    handleTimelineElementDelete,
    handleTimelineElementSplit: handleRazorSplit,
    handleRazorSplit,
    handleRazorSplitAll,
    handleTimelineAssetDrop,
    handleTimelineFileDrop,
    handleBlockedTimelineEdit,
    ...groupEditing,
  };
}

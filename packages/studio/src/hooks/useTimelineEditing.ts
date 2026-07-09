// Pre-existing-complex timeline hook (DOM patch + GSAP position shift/scale + pbs resolution).
// fallow-ignore-file complexity
import { useCallback, useRef } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import {
  furthestClipEndFromDocument,
  furthestClipEndFromSource,
} from "../player/lib/timelineElementHelpers";
import { useRazorSplit } from "./useRazorSplit";
import {
  buildTimelineAssetId,
  extendCompositionDurationIfNeeded,
  setCompositionDurationToContent,
  buildTimelineAssetInsertHtml,
  buildTimelineFileDropPlacements,
  fitTimelineAssetGeometry,
  getTimelineAssetKind,
  insertTimelineAssetIntoSource,
  resolveTimelineAssetCompositionSize,
  resolveTimelineAssetSrc,
} from "../utils/timelineAssetDrop";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import {
  getTimelineElementLabel,
  collectHtmlIds,
  resolveDroppedAssetDuration,
  resolveDroppedAssetDimensions,
} from "../utils/studioHelpers";
import { generateId } from "../utils/generateId";
import {
  buildPatchTarget,
  patchIframeDomTiming,
  resolveResizePlaybackStart,
  persistTimelineEdit,
  readFileContent,
  applyPatchByTarget,
  formatTimelineAttributeNumber,
  shiftGsapPositions,
  scaleGsapPositions,
} from "./timelineEditingHelpers";
import type { PersistTimelineEditInput } from "./timelineEditingHelpers";
import {
  useTimelineElementVisibilityEditing,
  useTimelineTrackVisibilityEditing,
} from "./timelineTrackVisibility";
import { sdkTimingPersist } from "../utils/sdkCutover";
import { useTimelineElementsMove } from "./timelineElementsMove";
import type { UseTimelineEditingOptions } from "./useTimelineEditingTypes";

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
          // Server wrote the file; resync the stale in-memory SDK doc.
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

  // Optimistically push the composition's content-driven length into the player
  // store right after the live DOM patch, so the duration readout + seek bar
  // update immediately. The readout binds to store.duration (PlayerControls);
  // edits only patched store.elements, so the number stayed frozen (esp. on
  // shrink) until a manual refresh. Read from the just-patched preview DOM (raw
  // data-duration) so it's immune to the runtime's truncated live durations.
  const syncReadoutDurationFromPreview = useCallback(() => {
    const end = furthestClipEndFromDocument(previewIframeRef.current?.contentDocument ?? null);
    if (end > 0) usePlayerStore.getState().setDuration(end);
  }, [previewIframeRef]);

  // fallow-ignore-next-line complexity
  const handleTimelineElementMove = useCallback(
    // fallow-ignore-next-line complexity
    (element: TimelineElement, updates: Pick<TimelineElement, "start" | "track">) => {
      patchIframeDomTiming(previewIframeRef.current, element, [
        ["data-start", formatTimelineAttributeNumber(updates.start)],
        ["data-track-index", String(updates.track)],
      ]);
      syncReadoutDurationFromPreview();
      const targetPath = element.sourceFile || activeCompPath || "index.html";
      const buildMovePatches: PersistTimelineEditInput["buildPatches"] = (original, target) => {
        let patched = applyPatchByTarget(original, target, {
          type: "attribute",
          property: "start",
          value: formatTimelineAttributeNumber(updates.start),
        });
        patched = applyPatchByTarget(patched, target, {
          type: "attribute",
          property: "track-index",
          value: String(updates.track),
        });
        // Content-driven duration: sync data-duration to the furthest clip end
        // read from the PATCHED SOURCE (raw data-duration), so it grows if a clip
        // moved past the end and shrinks if the furthest clip moved left. Measured
        // from the source, NOT the store — store durations are runtime-truncated
        // to the current comp length, which would ratchet the duration down every
        // move (HANDOFF-3 §6.1 feedback loop).
        return setCompositionDurationToContent(patched, furthestClipEndFromSource(patched));
      };
      // Server-path fallback (no SDK session): persist the attr patch, then
      // shift GSAP tween positions on the server and reload the preview — the
      // SDK path folds both into setTiming, but the fallback must do them
      // explicitly or the clip moves while its GSAP tweens stay put + the
      // preview never refreshes. coalesceKey mirrors the SDK branch so undo
      // granularity is identical on either path.
      const coalesceKey = `timeline-move:${element.hfId ?? element.id}`;
      const moveFallback = () =>
        enqueueEdit(element, "Move timeline clip", buildMovePatches, coalesceKey).then(() => {
          const pid = projectIdRef.current;
          const delta = updates.start - element.start;
          if (delta !== 0 && element.domId && pid) {
            return shiftGsapPositions(pid, targetPath, element.domId, delta)
              .then(() => reloadPreview())
              .catch((err) => console.error("[Timeline] Failed to shift GSAP positions", err));
          }
          return reloadPreview();
        });
      if (sdkSession && element.hfId) {
        return sdkTimingPersist(
          element.hfId,
          targetPath,
          { start: updates.start, trackIndex: updates.track },
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
      syncReadoutDurationFromPreview,
    ],
  );

  // Batched, atomic multi-clip move — one read/patch/write/GSAP-shift/reload for
  // ALL edits (single undo). Used by the drag commit for main-track ripple and
  // track-insert; single-clip moves keep the SDK-aware handler above.
  const handleTimelineElementsMove = useTimelineElementsMove({
    projectIdRef,
    activeCompPath,
    previewIframeRef,
    writeProjectFile,
    recordEdit,
    reloadPreview,
    forceReloadSdkSession,
    domEditSaveTimestampRef,
    isRecordingRef,
    showToast,
  });

  // fallow-ignore-next-line complexity
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
      // Patch the live playback-start/media-start attr too, or a start-trim shows
      // the old in-point until the next reload (persisted patch handles pbs below).
      if (updates.playbackStart != null) {
        const liveAttr =
          element.playbackStartAttr === "playback-start"
            ? "data-playback-start"
            : "data-media-start";
        liveAttrs.push([liveAttr, formatTimelineAttributeNumber(updates.playbackStart)]);
      }
      patchIframeDomTiming(previewIframeRef.current, element, liveAttrs);
      syncReadoutDurationFromPreview();
      const targetPath = element.sourceFile || activeCompPath || "index.html";
      const buildResizePatches: PersistTimelineEditInput["buildPatches"] = (original, target) => {
        const pbs = resolveResizePlaybackStart(original, target, element, updates);
        let patched = applyPatchByTarget(original, target, {
          type: "attribute",
          property: "start",
          value: formatTimelineAttributeNumber(updates.start),
        });
        patched = applyPatchByTarget(patched, target, {
          type: "attribute",
          property: "duration",
          value: formatTimelineAttributeNumber(updates.duration),
        });
        if (pbs) {
          patched = applyPatchByTarget(patched, target, {
            type: "attribute",
            property: pbs.attrName,
            value: formatTimelineAttributeNumber(pbs.value),
          });
        }
        // Content-driven duration from the PATCHED SOURCE (raw data-duration) —
        // grows/shrinks to the furthest clip end. Not from the store, whose
        // durations are runtime-truncated (HANDOFF-3 §6.1 feedback loop).
        return setCompositionDurationToContent(patched, furthestClipEndFromSource(patched));
      };
      // SDK path: skip when a playback-start adjustment is needed (setTiming has no pbs field).
      // The second clause fires because trimming the start of a clip that has a
      // playback-start attribute implicitly shifts that in-point — which the SDK
      // setTiming op can't express — so those resizes must take the server path.
      const hasPbsAdjustment =
        updates.playbackStart != null ||
        (updates.start !== element.start && element.playbackStart != null);
      // Server-path fallback: after persisting the attr patch, scale GSAP tween
      // positions/durations on the server and reload the preview. The SDK path
      // folds both into setTiming; the fallback must do them explicitly or the
      // clip resizes while its GSAP tweens keep their old timing + the preview
      // never refreshes. coalesceKey mirrors the SDK branch for undo parity.
      const coalesceKey = `timeline-resize:${element.hfId ?? element.id}`;
      const timingChanged =
        updates.start !== element.start || updates.duration !== element.duration;
      const resizeFallback = () =>
        enqueueEdit(element, "Resize timeline clip", buildResizePatches, coalesceKey).then(() => {
          const pid = projectIdRef.current;
          if (timingChanged && element.domId && pid) {
            return scaleGsapPositions(
              pid,
              targetPath,
              element.domId,
              element.start,
              element.duration,
              updates.start,
              updates.duration,
            )
              .then(() => reloadPreview())
              .catch((err) => console.error("[Timeline] Failed to scale GSAP positions", err));
          }
          return reloadPreview();
        });
      if (sdkSession && element.hfId && !hasPbsAdjustment) {
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
      syncReadoutDurationFromPreview,
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
        const removedContent =
          typeof removeData.content === "string" ? removeData.content : originalContent;
        // Content-driven duration: shrink the composition to the furthest remaining
        // clip end, read from the post-removal SOURCE (raw data-duration), so
        // deleting the last/longest clip removes trailing empty space. Measured
        // from the source, not the store, whose durations are runtime-truncated
        // (HANDOFF-3 §6.1 feedback loop).
        const deleteContentEnd = furthestClipEndFromSource(removedContent);
        const patchedContent = setCompositionDurationToContent(removedContent, deleteContentEnd);
        // Optimistically reflect the shrunk length in the readout/seek bar.
        if (deleteContentEnd > 0) usePlayerStore.getState().setDuration(deleteContentEnd);
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
        const hfId = `hf-${generateId()}`;
        const compSize = resolveTimelineAssetCompositionSize(originalContent);
        const natural =
          kind === "audio" ? null : await resolveDroppedAssetDimensions(pid, assetPath, kind);
        const resolvedAssetSrc = resolveTimelineAssetSrc(targetPath, assetPath);

        const resolvedTargetPath = targetPath || "index.html";
        const relevantElements = timelineElements.filter(
          (te) => (te.sourceFile || activeCompPath || "index.html") === resolvedTargetPath,
        );
        const newElementZIndex = Math.max(1, relevantElements.length + 1);

        const patchedContent = extendCompositionDurationIfNeeded(
          insertTimelineAssetIntoSource(
            originalContent,
            buildTimelineAssetInsertHtml({
              id: newId,
              hfId,
              assetPath: resolvedAssetSrc,
              kind,
              start: normalizedStart,
              duration: normalizedDuration,
              track: placement.track,
              zIndex: newElementZIndex,
              geometry: fitTimelineAssetGeometry(natural, compSize),
            }),
          ),
          normalizedStart + normalizedDuration,
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
      const uploaded = await uploadProjectFiles(files, "assets");
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
      );
      for (const [index, assetPath] of uploaded.entries()) {
        await handleTimelineAssetDrop(
          assetPath,
          placements[index] ?? placements[0],
          durations[index],
        );
      }
    },
    [handleTimelineAssetDrop, uploadProjectFiles, isRecordingRef, showToast],
  );

  const handleAddAssetAtPlayhead = useCallback(
    async (assetPath: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const kind = getTimelineAssetKind(assetPath);
      if (!kind) {
        showToast("Only image, video, and audio assets can be added to the timeline.");
        return;
      }
      const start = usePlayerStore.getState().currentTime;
      const duration = await resolveDroppedAssetDuration(pid, assetPath, kind);
      // Add on track 0 at the playhead (no bump — placing onto an occupied track is fine).
      await handleTimelineAssetDrop(assetPath, { start, track: 0 }, duration);
    },
    [handleTimelineAssetDrop, showToast],
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
    handleTimelineElementsMove,
    handleTimelineElementResize,
    handleToggleTrackHidden,
    handleToggleElementHidden,
    handleTimelineElementDelete,
    handleTimelineElementSplit: handleRazorSplit,
    handleRazorSplit,
    handleRazorSplitAll,
    handleTimelineAssetDrop,
    handleTimelineFileDrop,
    handleAddAssetAtPlayhead,
    handleBlockedTimelineEdit,
  };
}

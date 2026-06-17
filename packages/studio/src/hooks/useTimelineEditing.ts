// Pre-existing-complex timeline hook (DOM patch + GSAP position shift/scale +
// playback-start resolution).
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
import type { EditHistoryKind } from "../utils/editHistory";
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
import { sdkTimingPersist } from "../utils/sdkCutover";
import type { Composition } from "@hyperframes/sdk";

// ── Types ──

interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

interface UseTimelineEditingOptions {
  projectId: string | null;
  activeCompPath: string | null;
  timelineElements: TimelineElement[];
  showToast: (message: string, tone?: "error" | "info") => void;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  reloadPreview: () => void;
  previewIframeRef: React.RefObject<HTMLIFrameElement | null>;
  pendingTimelineEditPathRef: React.MutableRefObject<Set<string>>;
  uploadProjectFiles: (files: Iterable<File>, dir?: string) => Promise<string[]>;
  isRecordingRef?: React.RefObject<boolean>;
  /** Stage 7 §3.2: SDK session for routing timing ops through setTiming. */
  sdkSession?: Composition | null;
  /** Resync the SDK session after a server-authoritative timeline write. */
  forceReloadSdkSession?: () => void;
}

// ── Hook ──

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

  // fallow-ignore-next-line complexity
  const handleTimelineElementMove = useCallback(
    // fallow-ignore-next-line complexity
    (element: TimelineElement, updates: Pick<TimelineElement, "start" | "track">) => {
      patchIframeDomTiming(previewIframeRef.current, element, [
        ["data-start", formatTimelineAttributeNumber(updates.start)],
        ["data-track-index", String(updates.track)],
      ]);
      const targetPath = element.sourceFile || activeCompPath || "index.html";
      const buildMovePatches: PersistTimelineEditInput["buildPatches"] = (original, target) => {
        let patched = applyPatchByTarget(original, target, {
          type: "attribute",
          property: "start",
          value: formatTimelineAttributeNumber(updates.start),
        });
        return applyPatchByTarget(patched, target, {
          type: "attribute",
          property: "track-index",
          value: String(updates.track),
        });
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
    ],
  );

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
        return patched;
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
    ],
  );

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
    handleTimelineElementDelete,
    handleTimelineElementSplit: handleRazorSplit,
    handleRazorSplit,
    handleRazorSplitAll,
    handleTimelineAssetDrop,
    handleTimelineFileDrop,
    handleBlockedTimelineEdit,
  };
}

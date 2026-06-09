import { useCallback, useRef } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
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
} from "./timelineEditingHelpers";
import type { PatchTarget, PersistTimelineEditInput } from "./timelineEditingHelpers";

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
    ): Promise<void> => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return Promise.resolve();
      }
      const pid = projectIdRef.current;
      if (!pid) return Promise.resolve();
      const queued = editQueueRef.current.then(() =>
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
        }),
      );
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
    ],
  );

  const handleTimelineElementMove = useCallback(
    (element: TimelineElement, updates: Pick<TimelineElement, "start" | "track">) => {
      patchIframeDomTiming(previewIframeRef.current, element, [
        ["data-start", formatTimelineAttributeNumber(updates.start)],
        ["data-track-index", String(updates.track)],
      ]);
      return enqueueEdit(element, "Move timeline clip", (original, target) => {
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
      });
    },
    [previewIframeRef, enqueueEdit],
  );

  const handleTimelineElementResize = useCallback(
    (
      element: TimelineElement,
      updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
    ) => {
      patchIframeDomTiming(previewIframeRef.current, element, [
        ["data-start", formatTimelineAttributeNumber(updates.start)],
        ["data-duration", formatTimelineAttributeNumber(updates.duration)],
      ]);
      return enqueueEdit(element, "Resize timeline clip", (original, target) => {
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
      });
    },
    [previewIframeRef, enqueueEdit],
  );

  const handleTimelineElementDelete = useCallback(
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
    ],
  );

  const handleTimelineAssetDrop = useCallback(
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
    ],
  );

  const handleTimelineFileDrop = useCallback(
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

  const handleTimelineElementSplit = useCallback(
    async (element: TimelineElement, splitTime: number) => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return;
      }
      const pid = projectIdRef.current;
      if (!pid) return;

      const splittableTags = new Set(["video", "audio", "img"]);
      if (
        element.timelineLocked ||
        element.timingSource === "implicit" ||
        element.compositionSrc ||
        !splittableTags.has(element.tag) ||
        !element.duration ||
        !Number.isFinite(element.duration)
      ) {
        return;
      }

      if (splitTime <= element.start || splitTime >= element.start + element.duration) {
        showToast("Playhead must be inside the clip to split.", "error");
        return;
      }

      const patchTarget = buildPatchTarget(element);
      if (!patchTarget) {
        showToast("Clip is missing a patchable target.", "error");
        return;
      }

      const targetPath = element.sourceFile || activeCompPath || "index.html";
      try {
        const originalContent = await readFileContent(pid, targetPath);
        const existingIds = collectHtmlIds(originalContent);
        const baseId = element.domId || "clip";
        let newId = `${baseId}-split`;
        let suffix = 2;
        while (existingIds.includes(newId)) {
          newId = `${baseId}-split-${suffix++}`;
        }

        const response = await fetch(
          `/api/projects/${pid}/file-mutations/split-element/${encodeURIComponent(targetPath)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target: patchTarget, splitTime, newId }),
          },
        );
        if (!response.ok) {
          throw new Error("Split request failed");
        }

        const data = (await response.json()) as {
          ok?: boolean;
          changed?: boolean;
          content?: string;
        };
        if (!data.ok || !data.changed) {
          showToast("Failed to split clip — playhead may be outside the clip.", "error");
          return;
        }

        const patchedContent = typeof data.content === "string" ? data.content : originalContent;

        domEditSaveTimestampRef.current = Date.now();
        await saveProjectFilesWithHistory({
          projectId: pid,
          label: "Split timeline clip",
          kind: "timeline",
          files: { [targetPath]: patchedContent },
          readFile: async () => originalContent,
          writeFile: writeProjectFile,
          recordEdit,
        });

        reloadPreview();
        const label = getTimelineElementLabel(element);
        showToast(`Split ${label} at ${splitTime.toFixed(2)}s`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to split timeline clip";
        showToast(message, "error");
      }
    },
    [
      activeCompPath,
      recordEdit,
      showToast,
      writeProjectFile,
      domEditSaveTimestampRef,
      reloadPreview,
      isRecordingRef,
    ],
  );

  return {
    handleTimelineElementMove,
    handleTimelineElementResize,
    handleTimelineElementDelete,
    handleTimelineElementSplit,
    handleTimelineAssetDrop,
    handleTimelineFileDrop,
    handleBlockedTimelineEdit,
  };
}

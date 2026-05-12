import { useCallback, useRef } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import { applyPatchByTarget, readAttributeByTarget } from "../utils/sourcePatcher";
import {
  buildTrackZIndexMap,
  formatTimelineAttributeNumber,
} from "../player/components/timelineEditing";
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
  uploadProjectFiles: (files: Iterable<File>, dir?: string) => Promise<string[]>;
}

// ── Helpers ──

function buildPatchTarget(element: { domId?: string; selector?: string; selectorIndex?: number }) {
  if (element.domId) {
    return { id: element.domId, selector: element.selector, selectorIndex: element.selectorIndex };
  }
  if (element.selector) {
    return { selector: element.selector, selectorIndex: element.selectorIndex };
  }
  return null;
}

async function readFileContent(projectId: string, targetPath: string): Promise<string> {
  const response = await fetch(
    `/api/projects/${projectId}/files/${encodeURIComponent(targetPath)}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to read ${targetPath}`);
  }
  const data = (await response.json()) as { content?: string };
  if (typeof data.content !== "string") {
    throw new Error(`Missing file contents for ${targetPath}`);
  }
  return data.content;
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
  uploadProjectFiles,
}: UseTimelineEditingOptions) {
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const lastBlockedTimelineToastAtRef = useRef(0);

  const handleTimelineElementMove = useCallback(
    async (element: TimelineElement, updates: Pick<TimelineElement, "start" | "track">) => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");

      const targetPath = element.sourceFile || activeCompPath || "index.html";
      const originalContent = await readFileContent(pid, targetPath);

      const patchTarget = buildPatchTarget(element);
      if (!patchTarget) {
        throw new Error(`Timeline element ${element.id} is missing a patchable target`);
      }

      const resolvedTargetPath = targetPath || "index.html";
      const relevantElements = timelineElements
        .map((te) =>
          (te.key ?? te.id) === (element.key ?? element.id)
            ? { ...te, start: updates.start, track: updates.track }
            : te,
        )
        .filter((te) => (te.sourceFile || activeCompPath || "index.html") === resolvedTargetPath);
      const trackZIndices = buildTrackZIndexMap(relevantElements.map((te) => te.track));

      let patchedContent = applyPatchByTarget(originalContent, patchTarget, {
        type: "attribute",
        property: "start",
        value: formatTimelineAttributeNumber(updates.start),
      });
      patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
        type: "attribute",
        property: "track-index",
        value: String(updates.track),
      });
      for (const te of relevantElements) {
        const elementTarget = buildPatchTarget(te);
        if (!elementTarget) continue;
        const nextZIndex = trackZIndices.get(te.track);
        if (nextZIndex == null) continue;
        patchedContent = applyPatchByTarget(patchedContent, elementTarget, {
          type: "inline-style",
          property: "z-index",
          value: String(nextZIndex),
        });
      }

      if (patchedContent === originalContent) {
        throw new Error(`Unable to patch timeline element ${element.id} in ${targetPath}`);
      }

      domEditSaveTimestampRef.current = Date.now();
      await saveProjectFilesWithHistory({
        projectId: pid,
        label: "Move timeline clip",
        kind: "timeline",
        files: { [targetPath]: patchedContent },
        readFile: async () => originalContent,
        writeFile: writeProjectFile,
        recordEdit,
      });

      reloadPreview();
    },
    [
      activeCompPath,
      recordEdit,
      timelineElements,
      writeProjectFile,
      domEditSaveTimestampRef,
      reloadPreview,
    ],
  );

  const handleTimelineElementResize = useCallback(
    async (
      element: TimelineElement,
      updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
    ) => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");

      const targetPath = element.sourceFile || activeCompPath || "index.html";
      const originalContent = await readFileContent(pid, targetPath);

      const patchTarget = buildPatchTarget(element);
      if (!patchTarget) {
        throw new Error(`Timeline element ${element.id} is missing a patchable target`);
      }

      const playbackStartAttrName =
        element.playbackStartAttr === "playback-start" ? "playback-start" : "media-start";
      const currentPlaybackStartValue =
        readAttributeByTarget(originalContent, patchTarget, "playback-start") ??
        readAttributeByTarget(originalContent, patchTarget, "media-start");
      const currentPlaybackStart =
        currentPlaybackStartValue != null ? parseFloat(currentPlaybackStartValue) : undefined;
      const trimDelta = updates.start - element.start;
      const fallbackPlaybackStart =
        updates.playbackStart == null &&
        trimDelta !== 0 &&
        Number.isFinite(currentPlaybackStart) &&
        currentPlaybackStart != null
          ? Math.max(0, currentPlaybackStart + trimDelta * Math.max(element.playbackRate ?? 1, 0.1))
          : undefined;
      const nextPlaybackStart = updates.playbackStart ?? fallbackPlaybackStart;

      let patchedContent = originalContent;
      patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
        type: "attribute",
        property: "start",
        value: formatTimelineAttributeNumber(updates.start),
      });
      patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
        type: "attribute",
        property: "duration",
        value: formatTimelineAttributeNumber(updates.duration),
      });
      if (nextPlaybackStart != null) {
        patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
          type: "attribute",
          property: playbackStartAttrName,
          value: formatTimelineAttributeNumber(nextPlaybackStart),
        });
      }

      if (patchedContent === originalContent) {
        throw new Error(`Unable to patch timeline element ${element.id} in ${targetPath}`);
      }

      domEditSaveTimestampRef.current = Date.now();
      await saveProjectFilesWithHistory({
        projectId: pid,
        label: "Resize timeline clip",
        kind: "timeline",
        files: { [targetPath]: patchedContent },
        readFile: async () => originalContent,
        writeFile: writeProjectFile,
        recordEdit,
      });

      reloadPreview();
    },
    [activeCompPath, recordEdit, writeProjectFile, domEditSaveTimestampRef, reloadPreview],
  );

  const handleTimelineElementDelete = useCallback(
    async (element: TimelineElement) => {
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

        const resolvedTargetPath = targetPath || "index.html";
        const remainingElements = timelineElements.filter(
          (te) =>
            (te.key ?? te.id) !== (element.key ?? element.id) &&
            (te.sourceFile || activeCompPath || "index.html") === resolvedTargetPath,
        );
        const trackZIndices = buildTrackZIndexMap(remainingElements.map((te) => te.track));

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
        let patchedContent =
          typeof removeData.content === "string" ? removeData.content : originalContent;
        for (const te of remainingElements) {
          const elementTarget = buildPatchTarget(te);
          if (!elementTarget) continue;
          const nextZIndex = trackZIndices.get(te.track);
          if (nextZIndex == null) continue;
          patchedContent = applyPatchByTarget(patchedContent, elementTarget, {
            type: "inline-style",
            property: "z-index",
            value: String(nextZIndex),
          });
        }

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
    ],
  );

  const handleTimelineAssetDrop = useCallback(
    async (
      assetPath: string,
      placement: Pick<TimelineElement, "start" | "track">,
      durationOverride?: number,
    ) => {
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
        const trackZIndices = buildTrackZIndexMap([
          ...relevantElements.map((te) => te.track),
          placement.track,
        ]);

        let patchedContent = originalContent;
        for (const te of relevantElements) {
          const elementTarget = buildPatchTarget(te);
          if (!elementTarget) continue;
          const nextZIndex = trackZIndices.get(te.track);
          if (nextZIndex == null) continue;
          patchedContent = applyPatchByTarget(patchedContent, elementTarget, {
            type: "inline-style",
            property: "z-index",
            value: String(nextZIndex),
          });
        }

        patchedContent = insertTimelineAssetIntoSource(
          patchedContent,
          buildTimelineAssetInsertHtml({
            id: newId,
            assetPath: resolvedAssetSrc,
            kind,
            start: normalizedStart,
            duration: normalizedDuration,
            track: placement.track,
            zIndex: trackZIndices.get(placement.track) ?? 1,
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
    ],
  );

  const handleTimelineFileDrop = useCallback(
    async (files: File[], placement?: Pick<TimelineElement, "start" | "track">) => {
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
    [activeCompPath, handleTimelineAssetDrop, timelineElements, uploadProjectFiles],
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

  return {
    handleTimelineElementMove,
    handleTimelineElementResize,
    handleTimelineElementDelete,
    handleTimelineAssetDrop,
    handleTimelineFileDrop,
    handleBlockedTimelineEdit,
  };
}

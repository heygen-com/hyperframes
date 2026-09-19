// Asset-drop handlers for the timeline: drop an existing project asset at a
// placement, or upload dragged-in OS files and place them sequentially.
// Extracted verbatim from useTimelineEditing.ts to keep it under the studio
// 600-line cap.
import { useCallback, type MutableRefObject, type RefObject } from "react";
import type { TimelineElement } from "../player";
import type { TimelineDropPlacement } from "../player/components/timelineCallbacks";
import { resolveDropTrack } from "../utils/timelineDropTrackInsert";
import {
  buildTimelineAssetId,
  buildTimelineAssetInsertHtml,
  buildTimelineFileDropPlacements,
  fitTimelineAssetGeometry,
  getTimelineAssetKind,
  insertTimelineAssetIntoSource,
  resolveTimelineAssetCompositionSize,
  resolveTimelineAssetSrc,
} from "../utils/timelineAssetDrop";
import { generateId } from "../utils/generateId";
import { saveProjectFilesWithHistory, type RecordEditInput } from "../utils/studioFileHistory";
import { collectHtmlIds, resolveDroppedAssetDuration } from "../utils/studioHelpers";
import { formatTimelineAttributeNumber } from "./timelineEditingHelpers";
import { readFileContent } from "./timelineTimingSync";
import { commitTimelineCompositionInsertion } from "../utils/timelineCompositionInsert";
import { extendRootDurationInSource } from "../utils/rootDuration";
import { deriveTimelineStoreKeyForDomId } from "../player/lib/timelineElementHelpers";
import { selectAndRevealTimelineElement } from "../player/components/timelineDropReveal";

interface UseTimelineAssetDropOpsOptions {
  projectIdRef: MutableRefObject<string | null>;
  activeCompPath: string | null;
  timelineElements: TimelineElement[];
  showToast: (message: string, tone?: "error" | "info") => void;
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  reloadPreview: () => void;
  uploadProjectFiles: (files: Iterable<File>, dir?: string) => Promise<string[]>;
  isRecordingRef?: RefObject<boolean>;
  forceReloadSdkSession?: () => void;
  observeProjectFileVersion?: (path: string, version: string | null) => void;
}

export function useTimelineAssetDropOps({
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
}: UseTimelineAssetDropOpsOptions) {
  // fallow-ignore-next-line complexity
  const dropAssetAt = useCallback(
    // fallow-ignore-next-line complexity
    async (
      assetPath: string,
      placement: TimelineDropPlacement,
      durationOverride?: number,
    ): Promise<number | undefined> => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return undefined;
      }
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");

      const kind = getTimelineAssetKind(assetPath);
      if (!kind) {
        showToast("Only image, video, and audio assets can be dropped onto the timeline.");
        return undefined;
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

        const { source: sourceWithRoom, track } = resolveDropTrack({
          source: originalContent,
          elements: relevantElements,
          targetPath: resolvedTargetPath,
          placement,
          dropped: {
            id: newId,
            tag: kind === "image" ? "img" : kind,
            start: normalizedStart,
            duration: normalizedDuration,
          },
        });
        const patchedContent = extendRootDurationInSource(
          insertTimelineAssetIntoSource(
            sourceWithRoom,
            buildTimelineAssetInsertHtml({
              id: newId,
              hfId: `hf-${generateId()}`,
              assetPath: resolvedAssetSrc,
              kind,
              start: normalizedStart,
              duration: normalizedDuration,
              track,
              zIndex: newElementZIndex,
              geometry: fitTimelineAssetGeometry(
                null,
                resolveTimelineAssetCompositionSize(originalContent),
              ),
            }),
          ),
          normalizedStart + normalizedDuration,
        );

        await saveProjectFilesWithHistory({
          projectId: pid,
          label: "Add timeline asset",
          kind: "timeline",
          files: { [targetPath]: patchedContent },
          readFile: async () => originalContent,
          writeFile: writeProjectFile,
          recordEdit,
        });

        selectAndRevealTimelineElement(deriveTimelineStoreKeyForDomId(newId, targetPath));
        forceReloadSdkSession?.();
        reloadPreview();
        return track;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to drop asset onto timeline";
        showToast(message);
        return undefined;
      }
    },
    [
      projectIdRef,
      activeCompPath,
      recordEdit,
      showToast,
      timelineElements,
      writeProjectFile,
      reloadPreview,
      isRecordingRef,
      forceReloadSdkSession,
    ],
  );

  const handleTimelineAssetDrop = useCallback(
    async (assetPath: string, placement: TimelineDropPlacement, durationOverride?: number) => {
      await dropAssetAt(assetPath, placement, durationOverride);
    },
    [dropAssetAt],
  );

  // fallow-ignore-next-line complexity
  const handleTimelineFileDrop = useCallback(
    // fallow-ignore-next-line complexity
    async (files: File[], placement?: TimelineDropPlacement) => {
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
      );
      // The first file opens the new track; the rest go on the lane it was written to.
      let landedTrack: number | undefined;
      for (const [index, assetPath] of uploaded.entries()) {
        const next = placements[index] ?? placements[0];
        const track = await dropAssetAt(
          assetPath,
          index === 0
            ? { ...next, insertRow: placement?.insertRow }
            : { ...next, track: landedTrack ?? next.track },
          durations[index],
        );
        if (index === 0) landedTrack = track;
      }
    },
    [dropAssetAt, projectIdRef, uploadProjectFiles, isRecordingRef, showToast],
  );

  const handleTimelineCompositionDrop = useCallback(
    async (sourcePath: string, placement: Pick<TimelineElement, "start" | "track">) => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return;
      }
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");
      const targetPath = activeCompPath || "index.html";
      try {
        await commitTimelineCompositionInsertion({
          projectId: pid,
          targetPath,
          sourcePath,
          start: placement.start,
          track: placement.track,
          writeFile: writeProjectFile,
          recordEdit,
          observeVersion: observeProjectFileVersion,
          selectHost: selectAndRevealTimelineElement,
          resync: forceReloadSdkSession,
          refresh: reloadPreview,
        });
        showToast("Composition added to the timeline.", "info");
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "Failed to add composition to timeline",
          "error",
        );
      }
    },
    [
      activeCompPath,
      forceReloadSdkSession,
      isRecordingRef,
      observeProjectFileVersion,
      projectIdRef,
      recordEdit,
      reloadPreview,
      showToast,
      writeProjectFile,
    ],
  );

  return { handleTimelineAssetDrop, handleTimelineFileDrop, handleTimelineCompositionDrop };
}

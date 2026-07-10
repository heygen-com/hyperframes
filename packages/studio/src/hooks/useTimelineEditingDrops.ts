// Timeline asset/file drop + add-at-playhead handlers, extracted from
// useTimelineEditing so that hook stays a wiring shell. Called unconditionally as
// a sub-hook to preserve the parent's hook call order.
import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import { resolveZoneDropPlacement } from "../player/components/timelineCollision";
import { isAudioTimelineElement } from "../utils/timelineInspector";
import {
  buildTimelineAssetId,
  extendCompositionDurationIfNeeded,
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
  collectHtmlIds,
  resolveDroppedAssetDuration,
  resolveDroppedAssetDimensions,
} from "../utils/studioHelpers";
import { generateId } from "../utils/generateId";
import { formatTimelineAttributeNumber, readFileContent } from "./timelineEditingHelpers";
import type { UseTimelineEditingOptions } from "./useTimelineEditingTypes";

export interface UseTimelineEditingDropsDeps extends Pick<
  UseTimelineEditingOptions,
  | "activeCompPath"
  | "timelineElements"
  | "showToast"
  | "writeProjectFile"
  | "recordEdit"
  | "domEditSaveTimestampRef"
  | "reloadPreview"
  | "uploadProjectFiles"
  | "isRecordingRef"
  | "forceReloadSdkSession"
> {
  projectIdRef: MutableRefObject<string | null>;
}

export function useTimelineEditingDrops(deps: UseTimelineEditingDropsDeps) {
  const {
    projectIdRef,
    activeCompPath,
    timelineElements,
    showToast,
    writeProjectFile,
    recordEdit,
    domEditSaveTimestampRef,
    reloadPreview,
    uploadProjectFiles,
    isRecordingRef,
    forceReloadSdkSession,
  } = deps;

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

        // Zone- and overlap-aware track: run the new clip through the same pure
        // drop decision a clip DRAG uses (visual lanes top / audio lanes bottom,
        // no same-track time overlap — relocate to the nearest free lane in the
        // kind zone, else a fresh track). Covers OS file drops, asset-panel
        // drops, and playhead adds alike, so adding an asset behaves exactly
        // like moving one.
        let resolvedTrack = placement.track;
        if (relevantElements.length > 0) {
          const order = [...new Set(relevantElements.map((te) => te.track))].sort((a, b) => a - b);
          const audioTracks = new Set(
            relevantElements.filter(isAudioTimelineElement).map((te) => te.track),
          );
          const zoned = resolveZoneDropPlacement({
            order,
            audioTracks,
            elements: relevantElements,
            desiredTrack: placement.track,
            deliberateInsertRow: null,
            start: normalizedStart,
            duration: normalizedDuration,
            dragKey: newId,
            isAudio: kind === "audio",
          });
          // A needsInsert result means every lane in the kind zone is occupied at
          // this time — place on a fresh track; display normalization zones it.
          resolvedTrack = zoned.insertRow != null ? Math.max(...order) + 1 : zoned.track;
        }

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
              track: resolvedTrack,
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
      projectIdRef,
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
    [handleTimelineAssetDrop, uploadProjectFiles, isRecordingRef, showToast, projectIdRef],
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
    [handleTimelineAssetDrop, showToast, projectIdRef],
  );

  return { handleTimelineAssetDrop, handleTimelineFileDrop, handleAddAssetAtPlayhead };
}

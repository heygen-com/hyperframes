import { useCallback, useState, type RefObject } from "react";
import { TIMELINE_ASSET_MIME, TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";
import {
  parseTimelineCompositionPayload,
  TIMELINE_COMPOSITION_MIME,
} from "../../utils/timelineCompositionDrop";
import { usePlayerStore } from "../store/playerStore";
import { TRACK_H, resolveTimelineAssetDrop } from "./timelineLayout";
import type { TimelineDropCallbacks } from "./timelineCallbacks";

interface UseTimelineAssetDropOptions extends TimelineDropCallbacks {
  scrollRef: RefObject<HTMLDivElement | null>;
  ppsRef: RefObject<number>;
  durationRef: RefObject<number>;
  trackOrderRef: RefObject<number[]>;
}

type TimelinePlacement = { start: number; track: number };

/**
 * Parse a JSON drag payload and, if it yields a value, forward it to the drop
 * callback. Malformed payloads are ignored. Shared by the asset + block paths so
 * the parse/guard/dispatch shape lives in one place.
 */
function applyJsonDropPayload(
  raw: string,
  pick: (parsed: Record<string, string | undefined>) => string | undefined,
  apply: (value: string, placement: TimelinePlacement) => void,
  placement: TimelinePlacement,
): void {
  try {
    const value = pick(JSON.parse(raw) as Record<string, string | undefined>);
    if (value) apply(value, placement);
  } catch {
    /* ignore malformed drag payloads */
  }
}

function resolveDropStart(usePointerStart: boolean, pointerStart: number): number {
  if (usePointerStart) return pointerStart;
  return Math.max(0, usePlayerStore.getState().currentTime);
}

/**
 * Dropping an asset/file/block onto the timeline places it at the PLAYHEAD —
 * start is the current playhead time, only the track comes from the drop y.
 * Deliberate product choice (user preference, 2026-07-09): every add lands at
 * the playhead regardless of drop x, like CapCut's add-to-timeline. External
 * OS file drops and internal asset drops share this same placement path, so
 * both land identically.
 */
export function useTimelineAssetDrop({
  scrollRef,
  ppsRef,
  durationRef,
  trackOrderRef,
  onFileDrop,
  onAssetDrop,
  onBlockDrop,
  onCompositionDrop,
}: UseTimelineAssetDropOptions) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleAssetDragOver = useCallback((e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    const hasFiles = types.includes("Files");
    const hasAsset = types.includes(TIMELINE_ASSET_MIME);
    const hasBlock = types.includes(TIMELINE_BLOCK_MIME);
    const hasComposition = types.includes(TIMELINE_COMPOSITION_MIME);
    if (!hasFiles && !hasAsset && !hasBlock && !hasComposition) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  }, []);

  const clearDropPreview = useCallback(() => setIsDragOver(false), []);

  const resolveDropPlacement = useCallback(
    (clientX: number, clientY: number, usePointerStart = false): TimelinePlacement => {
      const scroll = scrollRef.current;
      const rect = scroll?.getBoundingClientRect();
      const pointer = resolveTimelineAssetDrop(
        {
          rectLeft: rect?.left ?? 0,
          rectTop: rect?.top ?? 0,
          scrollLeft: scroll?.scrollLeft ?? 0,
          scrollTop: scroll?.scrollTop ?? 0,
          pixelsPerSecond: ppsRef.current,
          duration: durationRef.current,
          clampStartToDuration: !usePointerStart,
          trackHeight: TRACK_H,
          trackOrder: trackOrderRef.current,
        },
        clientX,
        clientY,
      );
      return {
        start: resolveDropStart(usePointerStart, pointer.start),
        track: pointer.track,
      };
    },
    [scrollRef, ppsRef, durationRef, trackOrderRef],
  );

  const handleAssetDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const compositionPayload = parseTimelineCompositionPayload(
        e.dataTransfer.getData(TIMELINE_COMPOSITION_MIME),
      );
      if (compositionPayload && onCompositionDrop) {
        const placement = resolveDropPlacement(e.clientX, e.clientY, true);
        void onCompositionDrop(compositionPayload.sourcePath, placement);
        return;
      }
      const placement = resolveDropPlacement(e.clientX, e.clientY);

      if (onFileDrop && e.dataTransfer.files.length > 0) {
        void onFileDrop(Array.from(e.dataTransfer.files), placement);
        return;
      }
      const assetPayload = e.dataTransfer.getData(TIMELINE_ASSET_MIME);
      if (assetPayload && onAssetDrop) {
        applyJsonDropPayload(assetPayload, (p) => p.path, onAssetDrop, placement);
        return;
      }
      const blockPayload = e.dataTransfer.getData(TIMELINE_BLOCK_MIME);
      if (blockPayload && onBlockDrop) {
        applyJsonDropPayload(blockPayload, (p) => p.name, onBlockDrop, placement);
      }
    },
    [resolveDropPlacement, onFileDrop, onAssetDrop, onBlockDrop, onCompositionDrop],
  );

  return { isDragOver, handleAssetDragOver, handleAssetDrop, clearDropPreview };
}

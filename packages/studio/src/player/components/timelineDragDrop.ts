import { useCallback, useState, type RefObject } from "react";
import { TIMELINE_ASSET_MIME, TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";
import { usePlayerStore } from "../store/playerStore";
import { TRACK_H, resolveTimelineAssetDrop } from "./timelineLayout";
import type { TimelineDropCallbacks } from "./timelineCallbacks";

interface UseTimelineAssetDropOptions extends TimelineDropCallbacks {
  scrollRef: RefObject<HTMLDivElement | null>;
  ppsRef: RefObject<number>;
  durationRef: RefObject<number>;
  trackOrderRef: RefObject<number[]>;
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
}: UseTimelineAssetDropOptions) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleAssetDragOver = useCallback((e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    const hasFiles = types.includes("Files");
    const hasAsset = types.includes(TIMELINE_ASSET_MIME);
    const hasBlock = types.includes(TIMELINE_BLOCK_MIME);
    if (!hasFiles && !hasAsset && !hasBlock) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  }, []);

  const clearDropPreview = useCallback(() => setIsDragOver(false), []);

  const resolveDropPlacement = useCallback(
    (clientX: number, clientY: number): { start: number; track: number } => {
      const scroll = scrollRef.current;
      const rect = scroll?.getBoundingClientRect();
      // Track comes from the vertical drop position; start is the playhead.
      const { track } = resolveTimelineAssetDrop(
        {
          rectLeft: rect?.left ?? 0,
          rectTop: rect?.top ?? 0,
          scrollLeft: scroll?.scrollLeft ?? 0,
          scrollTop: scroll?.scrollTop ?? 0,
          pixelsPerSecond: ppsRef.current,
          duration: durationRef.current,
          trackHeight: TRACK_H,
          trackOrder: trackOrderRef.current,
        },
        clientX,
        clientY,
      );
      const start = Math.max(0, usePlayerStore.getState().currentTime);
      return { start, track };
    },
    [scrollRef, ppsRef, durationRef, trackOrderRef],
  );

  const handleAssetDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const placement = resolveDropPlacement(e.clientX, e.clientY);

      if (onFileDrop && e.dataTransfer.files.length > 0) {
        void onFileDrop(Array.from(e.dataTransfer.files), placement);
        return;
      }
      const assetPayload = e.dataTransfer.getData(TIMELINE_ASSET_MIME);
      if (assetPayload && onAssetDrop) {
        try {
          const parsed = JSON.parse(assetPayload) as { path?: string };
          if (parsed.path) void onAssetDrop(parsed.path, placement);
        } catch {
          /* ignore malformed drag payloads */
        }
        return;
      }
      const blockPayload = e.dataTransfer.getData(TIMELINE_BLOCK_MIME);
      if (blockPayload && onBlockDrop) {
        try {
          const parsed = JSON.parse(blockPayload) as { name?: string };
          if (parsed.name) void onBlockDrop(parsed.name, placement);
        } catch {
          /* ignore malformed drag payloads */
        }
      }
    },
    [resolveDropPlacement, onFileDrop, onAssetDrop, onBlockDrop],
  );

  return { isDragOver, handleAssetDragOver, handleAssetDrop, clearDropPreview };
}

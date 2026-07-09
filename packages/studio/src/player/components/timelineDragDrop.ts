import { useCallback, useState, type RefObject } from "react";
import { TIMELINE_ASSET_MIME, TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";
import { TRACK_H, resolveTimelineAssetDrop } from "./timelineLayout";
import type { TimelineDropCallbacks } from "./timelineCallbacks";

interface UseTimelineAssetDropOptions extends TimelineDropCallbacks {
  scrollRef: RefObject<HTMLDivElement | null>;
  ppsRef: RefObject<number>;
  durationRef: RefObject<number>;
  trackOrderRef: RefObject<number[]>;
}

/**
 * Dropping an asset/file/block onto the timeline places it at the DROP
 * POSITION — start comes from the drop x, track from the drop y. This is the
 * industry-standard drag semantic (CapCut/Premiere/FCP: dragged media lands
 * where you release it); playhead placement is reserved for button/shortcut
 * adds (handleAddAssetAtPlayhead). External OS file drops and internal asset
 * drops share this same placement path.
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
      const pps = ppsRef.current;
      // Start comes from the drop x, track from the drop y. Allow dropping into
      // the rendered empty space past the content end (same relaxed bound as a
      // clip drag) — the composition grows to fit on commit, content-driven.
      const maxDropTime = Math.max(
        durationRef.current,
        scroll && pps > 0 ? scroll.scrollWidth / pps : durationRef.current,
      );
      return resolveTimelineAssetDrop(
        {
          rectLeft: rect?.left ?? 0,
          rectTop: rect?.top ?? 0,
          scrollLeft: scroll?.scrollLeft ?? 0,
          scrollTop: scroll?.scrollTop ?? 0,
          pixelsPerSecond: pps,
          duration: maxDropTime,
          trackHeight: TRACK_H,
          trackOrder: trackOrderRef.current,
        },
        clientX,
        clientY,
      );
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

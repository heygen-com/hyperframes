// fallow-ignore-file clone-families
import { useCallback, useState, type RefObject } from "react";
import { TIMELINE_ASSET_MIME, TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";
import { TRACK_H, resolveTimelineAssetDrop } from "./timelineLayout";

interface UseTimelineAssetDropOptions {
  scrollRef: RefObject<HTMLDivElement | null>;
  ppsRef: RefObject<number>;
  durationRef: RefObject<number>;
  trackOrderRef: RefObject<number[]>;
  onFileDrop?: (
    files: File[],
    placement?: { start: number; track: number },
  ) => Promise<void> | void;
  onAssetDrop?: (
    assetPath: string,
    placement: { start: number; track: number },
  ) => Promise<void> | void;
  onBlockDrop?: (
    blockName: string,
    placement: { start: number; track: number },
  ) => Promise<void> | void;
}

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
    const hasFiles = e.dataTransfer.files.length > 0;
    const types = Array.from(e.dataTransfer.types);
    const hasAsset = types.includes(TIMELINE_ASSET_MIME);
    const hasBlock = types.includes(TIMELINE_BLOCK_MIME);
    if (!hasFiles && !hasAsset && !hasBlock) return;
    e.preventDefault();
    if (hasAsset || hasBlock) e.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  }, []);

  const handleAssetDrop = useCallback(
    // fallow-ignore-next-line complexity
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const scroll = scrollRef.current;
      const rect = scroll?.getBoundingClientRect();
      const dropInput = {
        rectLeft: rect?.left ?? 0,
        rectTop: rect?.top ?? 0,
        scrollLeft: scroll?.scrollLeft ?? 0,
        scrollTop: scroll?.scrollTop ?? 0,
        pixelsPerSecond: ppsRef.current,
        duration: durationRef.current,
        trackHeight: TRACK_H,
        trackOrder: trackOrderRef.current,
      };
      if (onFileDrop && e.dataTransfer.files.length > 0) {
        void onFileDrop(
          Array.from(e.dataTransfer.files),
          scroll && rect ? resolveTimelineAssetDrop(dropInput, e.clientX, e.clientY) : undefined,
        );
        return;
      }
      const assetPayload = e.dataTransfer.getData(TIMELINE_ASSET_MIME);
      if (assetPayload && onAssetDrop && scroll && rect) {
        try {
          const parsed = JSON.parse(assetPayload) as { path?: string };
          if (parsed.path)
            void onAssetDrop(
              parsed.path,
              resolveTimelineAssetDrop(dropInput, e.clientX, e.clientY),
            );
        } catch {
          /* ignore malformed drag payloads */
        }
        return;
      }
      const blockPayload = e.dataTransfer.getData(TIMELINE_BLOCK_MIME);
      if (blockPayload && onBlockDrop && scroll && rect) {
        try {
          const parsed = JSON.parse(blockPayload) as { name?: string };
          if (parsed.name)
            void onBlockDrop(
              parsed.name,
              resolveTimelineAssetDrop(dropInput, e.clientX, e.clientY),
            );
        } catch {
          /* ignore malformed drag payloads */
        }
      }
    },
    [onAssetDrop, onBlockDrop, onFileDrop, scrollRef, ppsRef, durationRef, trackOrderRef],
  );

  return { isDragOver, setIsDragOver, handleAssetDragOver, handleAssetDrop };
}

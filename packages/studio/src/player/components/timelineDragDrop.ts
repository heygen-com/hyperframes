import { useCallback, useRef, useState, type RefObject } from "react";
import { TIMELINE_ASSET_MIME, TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";
import { getActiveDragSession } from "../../utils/dragSession";
import { usePlayerStore } from "../store/playerStore";
import { TRACK_H, resolveTimelineAssetDrop } from "./timelineLayout";
import { resolveTimelineDropPreview, type TimelineDropPreview } from "./timelineDropPreview";
import { collectTimelineSnapTargets } from "./timelineSnapping";
import { resolveTimelineAutoScroll } from "./timelineEditing";
import type { TimelineDropCallbacks } from "./timelineCallbacks";

interface UseTimelineAssetDropOptions extends TimelineDropCallbacks {
  scrollRef: RefObject<HTMLDivElement | null>;
  ppsRef: RefObject<number>;
  durationRef: RefObject<number>;
  trackOrderRef: RefObject<number[]>;
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
  const [dropPreview, setDropPreview] = useState<TimelineDropPreview | null>(null);
  const dropPreviewRef = useRef<TimelineDropPreview | null>(null);

  const buildDropInput = useCallback(() => {
    const scroll = scrollRef.current;
    const rect = scroll?.getBoundingClientRect();
    return {
      rectLeft: rect?.left ?? 0,
      rectTop: rect?.top ?? 0,
      scrollLeft: scroll?.scrollLeft ?? 0,
      scrollTop: scroll?.scrollTop ?? 0,
      pixelsPerSecond: ppsRef.current,
      duration: durationRef.current,
      trackHeight: TRACK_H,
      trackOrder: trackOrderRef.current,
    };
  }, [scrollRef, ppsRef, durationRef, trackOrderRef]);

  const resolvePreview = useCallback(
    (e: React.DragEvent): TimelineDropPreview => {
      const state = usePlayerStore.getState();
      const snapTargets = state.timelineSnapEnabled
        ? collectTimelineSnapTargets({
            elements: state.elements,
            playheadTime: state.currentTime,
            beatTimes: [], // beat times need remapping to composition time; drops snap to
            // playhead + clip edges. (Clip moves still snap to beats via Task 3.)
          })
        : [];
      return resolveTimelineDropPreview({
        drop: buildDropInput(),
        clientX: e.clientX,
        clientY: e.clientY,
        session: getActiveDragSession(),
        fileItems: Array.from(e.dataTransfer.items, (i) => ({ kind: i.kind, type: i.type })),
        snapTargets,
        snapEnabled: state.timelineSnapEnabled,
      });
    },
    [buildDropInput],
  );

  const clearDropPreview = useCallback(() => {
    dropPreviewRef.current = null;
    setDropPreview(null);
    setIsDragOver(false);
  }, []);

  const handleAssetDragOver = useCallback(
    // fallow-ignore-next-line complexity
    (e: React.DragEvent) => {
      const hasFiles = e.dataTransfer.types.includes("Files");
      const types = Array.from(e.dataTransfer.types);
      const hasAsset = types.includes(TIMELINE_ASSET_MIME);
      const hasBlock = types.includes(TIMELINE_BLOCK_MIME);
      if (!hasFiles && !hasAsset && !hasBlock) return;
      e.preventDefault();
      if (hasAsset || hasBlock) e.dataTransfer.dropEffect = "copy";
      setIsDragOver(true);

      // Edge auto-scroll while hovering with an external drag.
      const scroll = scrollRef.current;
      if (scroll) {
        const rect = scroll.getBoundingClientRect();
        const delta = resolveTimelineAutoScroll(rect, e.clientX, e.clientY);
        if (delta.x !== 0 || delta.y !== 0) {
          scroll.scrollLeft += delta.x;
          scroll.scrollTop += delta.y;
        }
      }

      const next = resolvePreview(e);
      const prev = dropPreviewRef.current;
      if (
        !prev ||
        prev.start !== next.start ||
        prev.track !== next.track ||
        prev.snapTime !== next.snapTime ||
        prev.durationSec !== next.durationSec
      ) {
        dropPreviewRef.current = next;
        setDropPreview(next);
      }
    },
    [resolvePreview, scrollRef],
  );

  const handleAssetDrop = useCallback(
    // fallow-ignore-next-line complexity
    (e: React.DragEvent) => {
      e.preventDefault();
      clearDropPreview();
      const scroll = scrollRef.current;
      const rect = scroll?.getBoundingClientRect();

      const preview = resolvePreview(e);
      const placement = { start: preview.start, track: preview.track };

      if (onFileDrop && e.dataTransfer.files.length > 0) {
        void onFileDrop(
          Array.from(e.dataTransfer.files),
          scroll && rect
            ? { ...resolveTimelineAssetDrop(buildDropInput(), e.clientX, e.clientY), ...placement }
            : undefined,
        );
        return;
      }
      const assetPayload = e.dataTransfer.getData(TIMELINE_ASSET_MIME);
      if (assetPayload && onAssetDrop && scroll && rect) {
        try {
          const parsed = JSON.parse(assetPayload) as { path?: string };
          if (parsed.path)
            void onAssetDrop(parsed.path, {
              ...resolveTimelineAssetDrop(buildDropInput(), e.clientX, e.clientY),
              ...placement,
            });
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
            void onBlockDrop(parsed.name, {
              ...resolveTimelineAssetDrop(buildDropInput(), e.clientX, e.clientY),
              ...placement,
            });
        } catch {
          /* ignore malformed drag payloads */
        }
      }
    },
    [
      clearDropPreview,
      resolvePreview,
      buildDropInput,
      onAssetDrop,
      onBlockDrop,
      onFileDrop,
      scrollRef,
    ],
  );

  return {
    isDragOver,
    setIsDragOver,
    handleAssetDragOver,
    handleAssetDrop,
    clearDropPreview,
    dropPreview,
  };
}

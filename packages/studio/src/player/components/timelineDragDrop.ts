import { useCallback, useRef, useState, type RefObject } from "react";
import { TIMELINE_ASSET_MIME, TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";
import { getActiveDragSession } from "../../utils/dragSession";
import { usePlayerStore } from "../store/playerStore";
import { TRACK_H, resolveTimelineAssetDrop } from "./timelineLayout";
import { resolveTimelineDropPreview, type TimelineDropPreview } from "./timelineDropPreview";
import { collectTimelineSnapTargets } from "./timelineSnapping";
import { resolveTimelineAutoScroll } from "./timelineEditing";
import type { TimelineDropCallbacks } from "./timelineCallbacks";
import { useMountEffect } from "../../hooks/useMountEffect";

interface UseTimelineAssetDropOptions extends TimelineDropCallbacks {
  scrollRef: RefObject<HTMLDivElement | null>;
  ppsRef: RefObject<number>;
  durationRef: RefObject<number>;
  trackOrderRef: RefObject<number[]>;
  /** Runtime clip kinds per track, for kind-aware drop retargeting. */
  trackKindsRef: RefObject<Map<number, Set<string>>>;
}

export function useTimelineAssetDrop({
  scrollRef,
  ppsRef,
  durationRef,
  trackOrderRef,
  trackKindsRef,
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
    (
      e: Pick<React.DragEvent, "clientX" | "clientY"> & {
        fileItems: ReadonlyArray<{ kind: string; type: string }>;
      },
    ): TimelineDropPreview => {
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
        fileItems: e.fileItems,
        snapTargets,
        snapEnabled: state.timelineSnapEnabled,
        trackKinds: trackKindsRef.current,
      });
    },
    [buildDropInput, trackKindsRef],
  );

  /** Snapshot the drag-event fields we need; the native event is pooled/reused. */
  const snapshotDragEvent = (e: React.DragEvent) => ({
    clientX: e.clientX,
    clientY: e.clientY,
    fileItems: Array.from(e.dataTransfer.items, (i) => ({ kind: i.kind, type: i.type })),
  });

  const dragOverRafRef = useRef(0);
  const pendingDragOverRef = useRef<ReturnType<typeof snapshotDragEvent> | null>(null);

  const clearDropPreview = useCallback(() => {
    pendingDragOverRef.current = null;
    if (dragOverRafRef.current) {
      cancelAnimationFrame(dragOverRafRef.current);
      dragOverRafRef.current = 0;
    }
    dropPreviewRef.current = null;
    setDropPreview(null);
    setIsDragOver(false);
  }, []);

  // Clear the drop ghost when a drag is cancelled (ESC) while the pointer is over
  // the timeline. `dragleave` may not fire on ESC for in-window drags, but `dragend`
  // always fires on the drag source element in that case.
  useMountEffect(() => {
    const onDragEnd = () => clearDropPreview();
    window.addEventListener("dragend", onDragEnd);
    return () => window.removeEventListener("dragend", onDragEnd);
  });

  const handleAssetDragOver = useCallback(
    // fallow-ignore-next-line complexity
    (e: React.DragEvent) => {
      const hasFiles = e.dataTransfer.types.includes("Files");
      const types = Array.from(e.dataTransfer.types);
      const hasAsset = types.includes(TIMELINE_ASSET_MIME);
      const hasBlock = types.includes(TIMELINE_BLOCK_MIME);
      if (!hasFiles && !hasAsset && !hasBlock) return;
      e.preventDefault();
      if (hasAsset || hasBlock || hasFiles) e.dataTransfer.dropEffect = "copy";

      // dragover fires at pointer-move rate; coalesce the layout reads, snap
      // resolution, and state updates to one per animation frame to keep the
      // ghost smooth on large timelines.
      pendingDragOverRef.current = snapshotDragEvent(e);
      if (dragOverRafRef.current) return;
      // fallow-ignore-next-line complexity
      dragOverRafRef.current = requestAnimationFrame(() => {
        dragOverRafRef.current = 0;
        const pending = pendingDragOverRef.current;
        if (!pending) return;
        setIsDragOver(true);

        // Edge auto-scroll while hovering with an external drag.
        const scroll = scrollRef.current;
        if (scroll) {
          const rect = scroll.getBoundingClientRect();
          const delta = resolveTimelineAutoScroll(rect, pending.clientX, pending.clientY);
          if (delta.x !== 0 || delta.y !== 0) {
            scroll.scrollLeft += delta.x;
            scroll.scrollTop += delta.y;
          }
        }

        const next = resolvePreview(pending);
        const prev = dropPreviewRef.current;
        if (
          !prev ||
          prev.start !== next.start ||
          prev.track !== next.track ||
          prev.snapTime !== next.snapTime ||
          prev.durationSec !== next.durationSec ||
          prev.isNewTrack !== next.isNewTrack ||
          prev.label !== next.label ||
          prev.extraCount !== next.extraCount
        ) {
          dropPreviewRef.current = next;
          setDropPreview(next);
        }
      });
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

      const preview = resolvePreview(snapshotDragEvent(e));
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
    handleAssetDragOver,
    handleAssetDrop,
    clearDropPreview,
    dropPreview,
  };
}

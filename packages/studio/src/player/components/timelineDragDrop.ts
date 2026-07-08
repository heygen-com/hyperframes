import { useCallback, useRef, useState, type RefObject } from "react";
import { TIMELINE_ASSET_MIME, TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";
import { getActiveDragSession } from "../../utils/dragSession";
import { usePlayerStore } from "../store/playerStore";
import { TRACK_H } from "./timelineLayout";
import { resolveTimelineDropPreview, type TimelineDropPreview } from "./timelineDropPreview";
import { collectTimelineSnapTargets } from "./timelineSnapping";
import { resolveTimelineAutoScroll } from "./timelineEditing";
import type { TimelineDropCallbacks } from "./timelineCallbacks";
import { useMountEffect } from "../../hooks/useMountEffect";

/** True when a resolved preview differs from the last one in any rendered field. */
function dropPreviewChanged(prev: TimelineDropPreview | null, next: TimelineDropPreview): boolean {
  return (
    !prev ||
    prev.start !== next.start ||
    prev.track !== next.track ||
    prev.snapTime !== next.snapTime ||
    prev.durationSec !== next.durationSec ||
    prev.isNewTrack !== next.isNewTrack ||
    prev.label !== next.label ||
    prev.extraCount !== next.extraCount
  );
}

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
      });
    },
    [buildDropInput],
  );

  /** Snapshot the drag-event fields we need; the native event is pooled/reused. */
  const snapshotDragEvent = (e: React.DragEvent) => ({
    clientX: e.clientX,
    clientY: e.clientY,
    fileItems: Array.from(e.dataTransfer.items, (i) => ({ kind: i.kind, type: i.type })),
  });

  const dragOverRafRef = useRef(0);
  const pendingDragOverRef = useRef<ReturnType<typeof snapshotDragEvent> | null>(null);
  // Self-sustaining edge auto-scroll: `dragover` stops firing when the pointer is
  // held still at the timeline edge, so a one-shot scroll-per-event stalls. Keep a
  // rAF loop running off the last pointer position instead (mirrors the clip-drag
  // auto-scroll in useTimelineClipDrag).
  const autoScrollRafRef = useRef(0);
  const autoScrollPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);

  const stopAutoScroll = useCallback(() => {
    autoScrollPointerRef.current = null;
    if (autoScrollRafRef.current) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = 0;
    }
  }, []);

  const stepAutoScroll = useCallback(() => {
    autoScrollRafRef.current = 0;
    const scroll = scrollRef.current;
    const pointer = autoScrollPointerRef.current;
    if (!scroll || !pointer) return;
    const rect = scroll.getBoundingClientRect();
    const delta = resolveTimelineAutoScroll(rect, pointer.clientX, pointer.clientY);
    if (delta.x === 0 && delta.y === 0) return; // out of the edge zone: idle until next move
    const maxLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    const maxTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    scroll.scrollLeft = Math.max(0, Math.min(maxLeft, scroll.scrollLeft + delta.x));
    scroll.scrollTop = Math.max(0, Math.min(maxTop, scroll.scrollTop + delta.y));
    // Re-resolve the ghost against the new scroll offset so it stays under the cursor.
    if (pendingDragOverRef.current) {
      const next = resolvePreview(pendingDragOverRef.current);
      dropPreviewRef.current = next;
      setDropPreview(next);
    }
    autoScrollRafRef.current = requestAnimationFrame(stepAutoScroll);
  }, [scrollRef, resolvePreview]);

  const clearDropPreview = useCallback(() => {
    pendingDragOverRef.current = null;
    if (dragOverRafRef.current) {
      cancelAnimationFrame(dragOverRafRef.current);
      dragOverRafRef.current = 0;
    }
    stopAutoScroll();
    dropPreviewRef.current = null;
    setDropPreview(null);
    setIsDragOver(false);
  }, [stopAutoScroll]);

  // Clear the drop ghost when a drag is cancelled (ESC) while the pointer is over
  // the timeline. `dragleave` may not fire on ESC for in-window drags, but `dragend`
  // always fires on the drag source element in that case.
  useMountEffect(() => {
    const onDragEnd = () => clearDropPreview();
    window.addEventListener("dragend", onDragEnd);
    return () => window.removeEventListener("dragend", onDragEnd);
  });

  const handleAssetDragOver = useCallback(
    (e: React.DragEvent) => {
      const hasFiles = e.dataTransfer.types.includes("Files");
      const types = Array.from(e.dataTransfer.types);
      const hasAsset = types.includes(TIMELINE_ASSET_MIME);
      const hasBlock = types.includes(TIMELINE_BLOCK_MIME);
      if (!hasFiles && !hasAsset && !hasBlock) return;
      e.preventDefault();
      if (hasAsset || hasBlock || hasFiles) e.dataTransfer.dropEffect = "copy";

      const snapshot = snapshotDragEvent(e);
      pendingDragOverRef.current = snapshot;
      // Keep the edge auto-scroll loop alive off the latest pointer position.
      autoScrollPointerRef.current = { clientX: snapshot.clientX, clientY: snapshot.clientY };
      if (!autoScrollRafRef.current) {
        autoScrollRafRef.current = requestAnimationFrame(stepAutoScroll);
      }

      // Coalesce ghost updates to one per frame; the ghost is at most one frame
      // behind the cursor, and the drop below places at exactly the shown ghost.
      if (dragOverRafRef.current) return;
      dragOverRafRef.current = requestAnimationFrame(() => {
        dragOverRafRef.current = 0;
        const pending = pendingDragOverRef.current;
        if (!pending) return;
        setIsDragOver(true);
        const next = resolvePreview(pending);
        if (dropPreviewChanged(dropPreviewRef.current, next)) {
          dropPreviewRef.current = next;
          setDropPreview(next);
        }
      });
    },
    [resolvePreview, stepAutoScroll],
  );

  const handleAssetDrop = useCallback(
    // fallow-ignore-next-line complexity
    (e: React.DragEvent) => {
      e.preventDefault();
      const scroll = scrollRef.current;
      const rect = scroll?.getBoundingClientRect();
      // Place at exactly the position the ghost last showed (WYSIWYG). Fall back to
      // a fresh resolve if no ghost was painted (e.g. an instant drop with no move).
      const preview = dropPreviewRef.current ?? resolvePreview(snapshotDragEvent(e));
      const placement = { start: preview.start, track: preview.track };
      clearDropPreview();

      if (onFileDrop && e.dataTransfer.files.length > 0) {
        void onFileDrop(Array.from(e.dataTransfer.files), scroll && rect ? placement : undefined);
        return;
      }
      const assetPayload = e.dataTransfer.getData(TIMELINE_ASSET_MIME);
      if (assetPayload && onAssetDrop && scroll && rect) {
        try {
          const parsed = JSON.parse(assetPayload) as { path?: string };
          if (parsed.path) void onAssetDrop(parsed.path, placement);
        } catch {
          /* ignore malformed drag payloads */
        }
        return;
      }
      const blockPayload = e.dataTransfer.getData(TIMELINE_BLOCK_MIME);
      if (blockPayload && onBlockDrop && scroll && rect) {
        try {
          const parsed = JSON.parse(blockPayload) as { name?: string };
          if (parsed.name) void onBlockDrop(parsed.name, placement);
        } catch {
          /* ignore malformed drag payloads */
        }
      }
    },
    [clearDropPreview, resolvePreview, onAssetDrop, onBlockDrop, onFileDrop, scrollRef],
  );

  return {
    isDragOver,
    handleAssetDragOver,
    handleAssetDrop,
    clearDropPreview,
    dropPreview,
  };
}

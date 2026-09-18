import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { TIMELINE_ASSET_MIME, TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";
import {
  parseTimelineCompositionPayload,
  TIMELINE_COMPOSITION_MIME,
} from "../../utils/timelineCompositionDrop";
import { resolveTimelineAssetDrop, type TimelineRowGeometry } from "./timelineLayout";
import type { TimelineDropCallbacks } from "./timelineCallbacks";
import {
  applyTimelineAutoScrollStep,
  resolveTimelineAutoScrollLoopAction,
} from "./timelineEditing";

interface UseTimelineAssetDropOptions extends TimelineDropCallbacks {
  scrollRef: RefObject<HTMLDivElement | null>;
  ppsRef: RefObject<number>;
  durationRef: RefObject<number>;
  trackOrderRef: RefObject<number[]>;
  rowGeometryRef: RefObject<TimelineRowGeometry>;
  contentOrigin: number;
  sessionEpoch: number;
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
): boolean {
  try {
    const value = pick(JSON.parse(raw) as Record<string, string | undefined>);
    if (!value) return false;
    apply(value, placement);
    return true;
  } catch {
    return false;
  }
}

function invokeDropCallback(callback: () => Promise<void> | void): void {
  try {
    void Promise.resolve(callback()).catch(() => undefined);
  } catch {
    // A rejected external producer never keeps a timeline drop actor alive.
  }
}

function applyFileDrop(
  transfer: DataTransfer,
  onFileDrop: TimelineDropCallbacks["onFileDrop"],
  placement: TimelinePlacement,
): boolean {
  if (!onFileDrop || transfer.files.length === 0) return false;
  invokeDropCallback(() => onFileDrop(Array.from(transfer.files), placement));
  return true;
}

function applyTypedJsonDrop(
  transfer: DataTransfer,
  mime: string,
  field: "name" | "path",
  apply: ((value: string, placement: TimelinePlacement) => Promise<void> | void) | undefined,
  placement: TimelinePlacement,
): boolean {
  if (!apply || !Array.from(transfer.types).includes(mime)) return false;
  const payload = transfer.getData(mime);
  if (!payload) return false;
  return applyJsonDropPayload(
    payload,
    (parsed) => parsed[field],
    (value, nextPlacement) => invokeDropCallback(() => apply(value, nextPlacement)),
    placement,
  );
}

/**
 * Dropping an asset/file/block/composition onto the timeline places it at the
 * exact time and track it was dropped on, like CapCut. Adding via the
 * playhead (a button or keyboard shortcut, not a drag) is a separate path,
 * see useAddAssetAtPlayhead.
 */
export function useTimelineAssetDrop({
  scrollRef,
  ppsRef,
  durationRef,
  trackOrderRef,
  rowGeometryRef,
  contentOrigin,
  onFileDrop,
  onAssetDrop,
  onBlockDrop,
  onCompositionDrop,
  sessionEpoch,
}: UseTimelineAssetDropOptions) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragPointerRef = useRef<{ clientX: number; clientY: number; sessionEpoch: number } | null>(
    null,
  );
  const autoScrollRafRef = useRef(0);
  const activeDropEpochRef = useRef<number | null>(null);

  const stopAutoScroll = useCallback(() => {
    dragPointerRef.current = null;
    if (autoScrollRafRef.current) cancelAnimationFrame(autoScrollRafRef.current);
    autoScrollRafRef.current = 0;
  }, []);

  const stepAutoScroll = useCallback(
    function stepAutoScroll() {
      autoScrollRafRef.current = 0;
      const pointer = dragPointerRef.current;
      const scroll = scrollRef.current;
      if (!pointer || pointer.sessionEpoch !== sessionEpoch || !scroll) return;
      if (!applyTimelineAutoScrollStep(scroll, pointer.clientX, pointer.clientY)) return;
      autoScrollRafRef.current = requestAnimationFrame(stepAutoScroll);
    },
    [scrollRef, sessionEpoch],
  );

  const syncAutoScroll = useCallback(
    (clientX: number, clientY: number) => {
      dragPointerRef.current = { clientX, clientY, sessionEpoch };
      const scroll = scrollRef.current;
      const action = resolveTimelineAutoScrollLoopAction(
        scroll,
        clientX,
        clientY,
        autoScrollRafRef.current !== 0,
      );
      if (action === "stop") {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = 0;
      } else if (action === "start") {
        autoScrollRafRef.current = requestAnimationFrame(stepAutoScroll);
      }
    },
    [scrollRef, sessionEpoch, stepAutoScroll],
  );

  const handleAssetDragOver = useCallback(
    (e: React.DragEvent) => {
      const types = Array.from(e.dataTransfer.types);
      const hasFiles = types.includes("Files");
      const hasAsset = types.includes(TIMELINE_ASSET_MIME);
      const hasBlock = types.includes(TIMELINE_BLOCK_MIME);
      const hasComposition = types.includes(TIMELINE_COMPOSITION_MIME);
      if (!hasFiles && !hasAsset && !hasBlock && !hasComposition) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      activeDropEpochRef.current = sessionEpoch;
      setIsDragOver(true);
      syncAutoScroll(e.clientX, e.clientY);
    },
    [sessionEpoch, syncAutoScroll],
  );

  const clearDropPreview = useCallback(() => {
    activeDropEpochRef.current = null;
    stopAutoScroll();
    setIsDragOver(false);
  }, [stopAutoScroll]);

  const handleAssetDragLeave = useCallback(
    (e: React.DragEvent) => {
      const related = e.relatedTarget;
      if (related instanceof Node && e.currentTarget.contains(related)) return;
      clearDropPreview();
    },
    [clearDropPreview],
  );

  const resolveDropPlacement = useCallback(
    (clientX: number, clientY: number): TimelinePlacement => {
      const scroll = scrollRef.current;
      const rect = scroll?.getBoundingClientRect();
      return resolveTimelineAssetDrop(
        {
          rectLeft: rect?.left ?? 0,
          rectTop: rect?.top ?? 0,
          scrollLeft: scroll?.scrollLeft ?? 0,
          scrollTop: scroll?.scrollTop ?? 0,
          contentOrigin,
          pixelsPerSecond: ppsRef.current,
          duration: durationRef.current,
          clampStartToDuration: false,
          rowHeights: rowGeometryRef.current.rowHeights,
          trackOrder: trackOrderRef.current,
        },
        clientX,
        clientY,
      );
    },
    [scrollRef, ppsRef, durationRef, trackOrderRef, rowGeometryRef, contentOrigin],
  );

  const handleAssetDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const canCommit = activeDropEpochRef.current === sessionEpoch;
      clearDropPreview();
      if (!canCommit) return;
      const placement = resolveDropPlacement(e.clientX, e.clientY);

      const compositionPayload = parseTimelineCompositionPayload(
        e.dataTransfer.getData(TIMELINE_COMPOSITION_MIME),
      );
      if (compositionPayload && onCompositionDrop) {
        invokeDropCallback(() => onCompositionDrop(compositionPayload.sourcePath, placement));
        return;
      }

      if (applyFileDrop(e.dataTransfer, onFileDrop, placement)) return;
      if (applyTypedJsonDrop(e.dataTransfer, TIMELINE_ASSET_MIME, "path", onAssetDrop, placement)) {
        return;
      }
      applyTypedJsonDrop(e.dataTransfer, TIMELINE_BLOCK_MIME, "name", onBlockDrop, placement);
    },
    [
      clearDropPreview,
      onAssetDrop,
      onBlockDrop,
      onCompositionDrop,
      onFileDrop,
      resolveDropPlacement,
      sessionEpoch,
    ],
  );

  useEffect(() => {
    window.addEventListener("dragend", clearDropPreview);
    return () => {
      window.removeEventListener("dragend", clearDropPreview);
      clearDropPreview();
    };
  }, [clearDropPreview]);
  useEffect(() => clearDropPreview(), [clearDropPreview, sessionEpoch]);

  return {
    isDragOver,
    handleAssetDragOver,
    handleAssetDragLeave,
    handleAssetDrop,
    clearDropPreview,
  };
}

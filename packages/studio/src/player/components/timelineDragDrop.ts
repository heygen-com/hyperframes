import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { TIMELINE_ASSET_MIME, TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";
import {
  parseTimelineCompositionPayload,
  TIMELINE_COMPOSITION_MIME,
} from "../../utils/timelineCompositionDrop";
import {
  getTimelineInsertBoundaryBand,
  getTimelineRowPositionFromY,
  resolveTimelineAssetDrop,
  type TimelineRowGeometry,
} from "./timelineLayout";
import { resolveInsertRow } from "./timelineCollision";
import type { TimelineDropCallbacks, TimelineDropPlacement } from "./timelineCallbacks";
import {
  applyTimelineAutoScrollStep,
  resolveTimelineAutoScrollLoopAction,
} from "./timelineEditing";

interface UseTimelineAssetDropOptions extends TimelineDropCallbacks {
  scrollRef: RefObject<HTMLDivElement | null>;
  ppsRef: RefObject<number>;
  trackOrderRef: RefObject<number[]>;
  rowGeometryRef: RefObject<TimelineRowGeometry>;
  contentOrigin: number;
  sessionEpoch: number;
}

/**
 * Parse a JSON drag payload and, if it yields a value, forward it to the drop
 * callback. Malformed payloads are ignored. Shared by the asset + block paths so
 * the parse/guard/dispatch shape lives in one place.
 */
function applyJsonDropPayload(
  raw: string,
  pick: (parsed: Record<string, string | undefined>) => string | undefined,
  apply: (value: string, placement: TimelineDropPlacement) => void,
  placement: TimelineDropPlacement,
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

/** Only file and asset drops are written by the asset op that can open a track. */
function canInsertTrackFor(types: readonly string[]): boolean {
  return types.includes("Files") || types.includes(TIMELINE_ASSET_MIME);
}

/** The row boundary a pointer at `contentY` arms for a new track, or null over a lane's middle. */
export function resolveDropInsertRow(
  contentY: number,
  rowHeights: readonly number[] | undefined,
  trackCount: number,
): number | null {
  if (trackCount === 0) return null;
  const { rowFloat, rowHeight } = getTimelineRowPositionFromY(contentY, rowHeights);
  // Past the last lane the drop already appends a track (getDefaultDroppedTrack).
  if (rowFloat >= trackCount) return null;
  return resolveInsertRow(rowFloat, trackCount, getTimelineInsertBoundaryBand(rowHeight));
}

function placeDrop(
  geometry: Parameters<typeof resolveTimelineAssetDrop>[0],
  clientX: number,
  clientY: number,
  // Blocks and compositions are written by their own installers, which only take a track.
  canInsertTrack: boolean,
): TimelineDropPlacement {
  const placement = resolveTimelineAssetDrop(geometry, clientX, clientY);
  if (!canInsertTrack) return placement;
  const contentY = clientY - geometry.rectTop + geometry.scrollTop;
  const insertRow = resolveDropInsertRow(contentY, geometry.rowHeights, geometry.trackOrder.length);
  return insertRow == null
    ? placement
    : { ...placement, insertRow, trackOrder: geometry.trackOrder };
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
  placement: TimelineDropPlacement,
): boolean {
  if (!onFileDrop || transfer.files.length === 0) return false;
  invokeDropCallback(() => onFileDrop(Array.from(transfer.files), placement));
  return true;
}

function applyTypedJsonDrop(
  transfer: DataTransfer,
  mime: string,
  field: "name" | "path",
  apply: ((value: string, placement: TimelineDropPlacement) => Promise<void> | void) | undefined,
  placement: TimelineDropPlacement,
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
 * exact time and track it was dropped on, like CapCut (pointer placement on
 * every track but the magnetic main track). Supersedes the prior playhead
 * decision (66366b0d3); playhead adds stay available, see useAddAssetAtPlayhead.
 */
export function useTimelineAssetDrop({
  scrollRef,
  ppsRef,
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
  const [dropPreview, setDropPreview] = useState<TimelineDropPlacement | null>(null);
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

  const resolveDropPlacement = useCallback(
    (clientX: number, clientY: number, canInsertTrack: boolean): TimelineDropPlacement => {
      const scroll = scrollRef.current;
      const rect = scroll?.getBoundingClientRect();
      return placeDrop(
        {
          rectLeft: rect?.left ?? 0,
          rectTop: rect?.top ?? 0,
          scrollLeft: scroll?.scrollLeft ?? 0,
          scrollTop: scroll?.scrollTop ?? 0,
          contentOrigin,
          pixelsPerSecond: ppsRef.current,
          rowHeights: rowGeometryRef.current.rowHeights,
          trackOrder: trackOrderRef.current,
        },
        clientX,
        clientY,
        canInsertTrack,
      );
    },
    [scrollRef, ppsRef, trackOrderRef, rowGeometryRef, contentOrigin],
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
      const next = resolveDropPlacement(e.clientX, e.clientY, canInsertTrackFor(types));
      setDropPreview((prev) =>
        prev?.start === next.start && prev.track === next.track && prev.insertRow === next.insertRow
          ? prev
          : next,
      );
      syncAutoScroll(e.clientX, e.clientY);
    },
    [resolveDropPlacement, sessionEpoch, syncAutoScroll],
  );

  const clearDropPreview = useCallback(() => {
    activeDropEpochRef.current = null;
    stopAutoScroll();
    setIsDragOver(false);
    setDropPreview(null);
  }, [stopAutoScroll]);

  const handleAssetDragLeave = useCallback(
    (e: React.DragEvent) => {
      const related = e.relatedTarget;
      if (related instanceof Node && e.currentTarget.contains(related)) return;
      clearDropPreview();
    },
    [clearDropPreview],
  );

  const handleAssetDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const canCommit = activeDropEpochRef.current === sessionEpoch;
      clearDropPreview();
      if (!canCommit) return;
      const types = Array.from(e.dataTransfer.types);
      const placement = resolveDropPlacement(e.clientX, e.clientY, canInsertTrackFor(types));

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
    dropPreview,
    handleAssetDragOver,
    handleAssetDragLeave,
    handleAssetDrop,
    clearDropPreview,
  };
}

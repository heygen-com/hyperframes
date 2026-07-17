import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { TIMELINE_ASSET_MIME, TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";
import { usePlayerStore } from "../store/playerStore";
import { getDefaultDroppedTrack, type TimelineRowGeometry } from "./timelineLayout";
import type { TimelineDropCallbacks } from "./timelineCallbacks";
import { applyTimelineAutoScrollStep, resolveTimelineAutoScroll } from "./timelineEditing";

interface UseTimelineAssetDropOptions extends TimelineDropCallbacks {
  scrollRef: RefObject<HTMLDivElement | null>;
  trackOrderRef: RefObject<number[]>;
  rowGeometryRef: RefObject<TimelineRowGeometry>;
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
  trackOrderRef,
  rowGeometryRef,
  onFileDrop,
  onAssetDrop,
  onBlockDrop,
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
      const y = scroll
        ? resolveTimelineAutoScroll(scroll.getBoundingClientRect(), clientX, clientY).y
        : 0;
      const action =
        y === 0
          ? autoScrollRafRef.current
            ? "stop"
            : "none"
          : autoScrollRafRef.current
            ? "none"
            : "start";
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
      if (!hasFiles && !hasAsset && !hasBlock) return;
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
    (_clientX: number, clientY: number): TimelinePlacement => {
      const scroll = scrollRef.current;
      const rect = scroll?.getBoundingClientRect();
      const contentY = clientY - (rect?.top ?? 0) + (scroll?.scrollTop ?? 0);
      const row = Math.floor(rowGeometryRef.current.getRowFromY(contentY));
      const track = getDefaultDroppedTrack(trackOrderRef.current, row);
      const start = Math.max(0, usePlayerStore.getState().currentTime);
      return { start, track };
    },
    [scrollRef, trackOrderRef, rowGeometryRef],
  );

  const handleAssetDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const canCommit = activeDropEpochRef.current === sessionEpoch;
      clearDropPreview();
      if (!canCommit) return;
      const placement = resolveDropPlacement(e.clientX, e.clientY);

      if (onFileDrop && e.dataTransfer.files.length > 0) {
        invokeDropCallback(() => onFileDrop(Array.from(e.dataTransfer.files), placement));
        return;
      }
      const assetPayload = e.dataTransfer.getData(TIMELINE_ASSET_MIME);
      if (assetPayload && onAssetDrop) {
        applyJsonDropPayload(
          assetPayload,
          (p) => p.path,
          (path, nextPlacement) => invokeDropCallback(() => onAssetDrop(path, nextPlacement)),
          placement,
        );
        return;
      }
      const blockPayload = e.dataTransfer.getData(TIMELINE_BLOCK_MIME);
      if (blockPayload && onBlockDrop) {
        applyJsonDropPayload(
          blockPayload,
          (p) => p.name,
          (name, nextPlacement) => invokeDropCallback(() => onBlockDrop(name, nextPlacement)),
          placement,
        );
      }
    },
    [clearDropPreview, onAssetDrop, onBlockDrop, onFileDrop, resolveDropPlacement, sessionEpoch],
  );

  useEffect(() => clearDropPreview, [clearDropPreview]);
  useEffect(() => {
    stopAutoScroll();
    setIsDragOver(false);
  }, [sessionEpoch, stopAutoScroll]);

  return {
    isDragOver,
    handleAssetDragOver,
    handleAssetDragLeave,
    handleAssetDrop,
    clearDropPreview,
  };
}

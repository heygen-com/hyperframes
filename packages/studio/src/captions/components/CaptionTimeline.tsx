import { memo, useCallback, useRef } from "react";
import { useCaptionStore } from "../store";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROUP_COLORS = [
  "#3CE6AC",
  "#FF6B6B",
  "#4ECDC4",
  "#FFE66D",
  "#A78BFA",
  "#F472B6",
  "#34D399",
  "#FB923C",
  "#60A5FA",
  "#C084FC",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CaptionTimelineProps {
  pixelsPerSecond: number;
  onSeek?: (time: number) => void;
}

interface DragState {
  segId: string;
  edge: "start" | "end";
  originalStart: number;
  originalEnd: number;
  startX: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CaptionTimeline = memo(function CaptionTimeline({
  pixelsPerSecond,
  onSeek,
}: CaptionTimelineProps) {
  const model = useCaptionStore((s) => s.model);
  const selectedSegmentIds = useCaptionStore((s) => s.selectedSegmentIds);
  const selectSegment = useCaptionStore((s) => s.selectSegment);
  const updateSegmentTiming = useCaptionStore((s) => s.updateSegmentTiming);
  const splitGroup = useCaptionStore((s) => s.splitGroup);

  const dragRef = useRef<DragState | null>(null);

  const handleEdgePointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      segId: string,
      edge: "start" | "end",
      originalStart: number,
      originalEnd: number,
    ) => {
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { segId, edge, originalStart, originalEnd, startX: e.clientX };
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;

      const delta = (e.clientX - drag.startX) / pixelsPerSecond;

      if (drag.edge === "start") {
        const newStart = Math.max(0, drag.originalStart + delta);
        const clampedStart = Math.min(newStart, drag.originalEnd - 0.05);
        updateSegmentTiming(drag.segId, clampedStart, drag.originalEnd);
      } else {
        const newEnd = Math.max(drag.originalStart + 0.05, drag.originalEnd + delta);
        const clampedEnd = Math.max(0, newEnd);
        updateSegmentTiming(drag.segId, drag.originalStart, clampedEnd);
      }
    },
    [pixelsPerSecond, updateSegmentTiming],
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleBlockClick = useCallback(
    (e: React.MouseEvent, segId: string) => {
      e.stopPropagation();
      selectSegment(segId, e.shiftKey);
    },
    [selectSegment],
  );

  const handleBlockDoubleClick = useCallback(
    (e: React.MouseEvent, groupId: string, segId: string) => {
      e.stopPropagation();
      splitGroup(groupId, segId);
    },
    [splitGroup],
  );

  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onSeek) return;
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const x = e.clientX - rect.left - 32;
      const time = Math.max(0, x / pixelsPerSecond);
      onSeek(time);
    },
    [onSeek, pixelsPerSecond],
  );

  if (!model) return null;

  return (
    <div
      className="relative select-none overflow-x-auto"
      style={{ height: 40, minWidth: "100%" }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onClick={handleTrackClick}
    >
      {model.groupOrder.map((groupId, groupIdx) => {
        const group = model.groups.get(groupId);
        if (!group) return null;
        const color = GROUP_COLORS[groupIdx % GROUP_COLORS.length];

        return group.segmentIds.map((segId) => {
          const seg = model.segments.get(segId);
          if (!seg) return null;

          const left = 32 + seg.start * pixelsPerSecond;
          const width = Math.max((seg.end - seg.start) * pixelsPerSecond, 4);
          const isSelected = selectedSegmentIds.has(segId);

          return (
            <div
              key={segId}
              className={`absolute top-1 bottom-1 rounded flex items-center overflow-hidden cursor-pointer${
                isSelected ? " ring-1 ring-white/50 z-10" : ""
              }`}
              style={{
                left,
                width,
                backgroundColor: color,
                zIndex: isSelected ? 10 : 1,
              }}
              onClick={(e) => handleBlockClick(e, segId)}
              onDoubleClick={(e) => handleBlockDoubleClick(e, groupId, segId)}
            >
              {/* Left edge drag handle */}
              <div
                className="absolute left-0 top-0 bottom-0 cursor-col-resize z-20"
                style={{ width: 6 }}
                onPointerDown={(e) => handleEdgePointerDown(e, segId, "start", seg.start, seg.end)}
              />

              {/* Text label */}
              <span
                className="flex-1 truncate px-2 pointer-events-none"
                style={{ fontSize: 9, color: "#000000", lineHeight: 1 }}
              >
                {seg.text}
              </span>

              {/* Right edge drag handle */}
              <div
                className="absolute right-0 top-0 bottom-0 cursor-col-resize z-20"
                style={{ width: 6 }}
                onPointerDown={(e) => handleEdgePointerDown(e, segId, "end", seg.start, seg.end)}
              />
            </div>
          );
        });
      })}
    </div>
  );
});

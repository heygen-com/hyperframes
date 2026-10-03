import { useRef, type PointerEvent } from "react";
import { usePlayerStore } from "../store/playerStore";
import { TRACK_H } from "./timelineLayout";

const GRIP_H = 4;

/**
 * A layer's bottom edge. Dragging it resizes every layer at once, so the `row + 1` layers down to this edge
 * each take a share of the pointer's travel and the edge stays under the pointer. Double click: the default.
 */
export function TrackHeightGrip({ row }: { row: number }) {
  const trackHeight = usePlayerStore((s) => s.trackHeight);
  const setTrackHeight = usePlayerStore((s) => s.setTrackHeight);
  const drag = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  const end = () => void (drag.current = null);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, y: event.clientY, height: trackHeight };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    // A move with the button up (a lost release) ends the drag instead of resizing on hover.
    if (!(event.buttons & 1)) return end();
    setTrackHeight(start.height + (event.clientY - start.y) / (row + 1));
  };
  // The keyboard path is the toolbar's Layer height slider, so the grip stays out of the tab order.
  return (
    <div
      aria-hidden="true"
      data-timeline-track-height-grip
      className="absolute inset-x-0 z-20 cursor-row-resize"
      // Inside its own layer: the next layer's sticky header paints over anything below the line.
      style={{ top: trackHeight - GRIP_H, height: GRIP_H }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={(event) => {
        event.stopPropagation();
        setTrackHeight(TRACK_H);
      }}
    />
  );
}

import { useCallback, useRef } from "react";
import { MIN_PREVIEW_H, MIN_TIMELINE_H, fitTimelineHeight } from "../../utils/fitPanels";

/**
 * Horizontal drag/keyboard-resizable divider between the preview and the
 * timeline. Implements the separator pattern: ArrowUp grows the timeline,
 * ArrowDown shrinks it (mirrors the drag direction).
 */
export function TimelineResizeDivider({
  timelineH,
  setTimelineH,
  persistTimelineH,
  containerRef,
  disabled,
}: {
  timelineH: number;
  setTimelineH: React.Dispatch<React.SetStateAction<number>>;
  persistTimelineH: (h: number) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  disabled: boolean;
}) {
  const isDragging = useRef(false);
  const timelineHRef = useRef(timelineH);
  timelineHRef.current = timelineH;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      e.preventDefault();
      isDragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [disabled],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      setTimelineH(fitTimelineHeight(rect.height, rect.height - mouseY));
    },
    [disabled, containerRef, setTimelineH],
  );

  const handlePointerUp = useCallback(() => {
    if (isDragging.current) persistTimelineH(timelineHRef.current);
    isDragging.current = false;
  }, [persistTimelineH]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const containerH = containerRef.current?.getBoundingClientRect().height ?? 0;
      const delta = e.key === "ArrowUp" ? 16 : -16;
      setTimelineH((prev) => {
        const next = fitTimelineHeight(containerH, prev + delta);
        persistTimelineH(next);
        return next;
      });
    },
    [disabled, containerRef, setTimelineH, persistTimelineH],
  );

  return (
    // Horizontal resize divider: 3px visible seam (h-[3px]), 10px pointer-capture
    // zone via the absolutely-positioned inner hit area so the layout gap stays
    // at 3px while draggability is preserved over the full band.
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize timeline (arrow keys)"
      aria-valuenow={Math.round(timelineH)}
      aria-valuemin={MIN_TIMELINE_H}
      aria-valuemax={Math.round(
        (containerRef.current?.getBoundingClientRect().height ?? 600) - MIN_PREVIEW_H,
      )}
      tabIndex={0}
      className="group relative h-[3px] flex-shrink-0 cursor-row-resize z-10 outline-none focus-visible:bg-studio-accent/20"
      style={{ touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      {/* Expanded hit zone, deliberately asymmetric: 4px up into the transport
          row's vertical centring slack, the 3px seam, then 3px down into the
          timeline card's border + toolbar padding. It stops at 10px rather than
          the 24px WCAG 2.2 (2.5.8) target because that is all the dead space
          there is: 28px transport buttons sit above and 28px toolbar buttons
          below, and silently stealing their clicks is the worse bug. */}
      <div className="absolute inset-x-0 -top-[4px] h-[10px]" />
      {/* Visible hairline — invisible at rest, subtle wash on hover/drag/focus */}
      <div className="h-[3px] w-full bg-transparent transition-colors group-hover:bg-white/12 group-active:bg-white/18 group-focus-visible:bg-studio-accent/60" />
    </div>
  );
}

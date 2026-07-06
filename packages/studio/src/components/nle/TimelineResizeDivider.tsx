import { useCallback, useRef } from "react";

export const MIN_TIMELINE_H = 100;
export const MIN_PREVIEW_H = 120;

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
      const containerH = rect.height;
      const newTimelineH = Math.max(
        MIN_TIMELINE_H,
        Math.min(containerH - MIN_PREVIEW_H, containerH - mouseY),
      );
      setTimelineH(newTimelineH);
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
      const containerH = containerRef.current?.getBoundingClientRect().height ?? Infinity;
      const delta = e.key === "ArrowUp" ? 16 : -16;
      setTimelineH((prev) => {
        const next = Math.max(MIN_TIMELINE_H, Math.min(containerH - MIN_PREVIEW_H, prev + delta));
        persistTimelineH(next);
        return next;
      });
    },
    [disabled, containerRef, setTimelineH, persistTimelineH],
  );

  return (
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
      className="group h-2 flex-shrink-0 cursor-row-resize flex items-center justify-center z-10 outline-none focus-visible:bg-studio-accent/20"
      style={{ touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <div className="h-px w-full bg-white/10 transition-colors group-hover:bg-white/16 group-active:bg-white/22 group-focus-visible:bg-studio-accent/60" />
    </div>
  );
}

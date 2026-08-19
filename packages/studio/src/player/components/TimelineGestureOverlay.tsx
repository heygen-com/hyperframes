import { memo, type ReactNode } from "react";
import type { TimelineElement } from "../store/playerStore";
import type { TimelineTheme } from "./timelineTheme";
import { getRenderedTimelineElement } from "./timelineTheme";
import { TimelineClip } from "./TimelineClip";
import { getTimelineEditCapabilities } from "./timelineEditing";
import { renderClipChildren } from "./timelineClipChildren";
import { getTimelineDragOverlayPosition } from "./timelineClipDragPreview";
import type { DraggedClipState } from "./timelineClipDragTypes";
import type { TrackVisualStyle } from "./timelineIcons";
import { isTimelineClipActive } from "./useTimelineActiveClips";
import type { TimelineClipRenderContext } from "./TimelineTypes";

interface TimelineGestureOverlayProps {
  drag: DraggedClipState | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  pixelsPerSecond: number;
  rowHeight: number;
  selectedElementId: string | null;
  currentTime: number;
  theme: TimelineTheme;
  getTrackStyle: (tag: string) => TrackVisualStyle;
  renderClipContent?: (
    element: TimelineElement,
    style: { clip: string; label: string },
    context: TimelineClipRenderContext,
  ) => ReactNode;
  renderClipOverlay?: (element: TimelineElement) => ReactNode;
}

/** Stable canvas child that owns the live drag actor independently of source rows. */
export const TimelineGestureOverlay = memo(function TimelineGestureOverlay({
  drag,
  scrollRef,
  pixelsPerSecond,
  rowHeight,
  selectedElementId,
  currentTime,
  theme,
  getTrackStyle,
  renderClipContent,
  renderClipOverlay,
}: TimelineGestureOverlayProps) {
  const element =
    drag?.started === true
      ? getRenderedTimelineElement({
          element: drag.element,
          draggedElementId: drag.element.key ?? drag.element.id,
          previewStart: drag.previewStart,
          previewTrack: drag.previewTrack,
        })
      : null;
  const position = drag ? getTimelineDragOverlayPosition(drag, scrollRef.current) : null;
  return (
    <div data-timeline-gesture-overlay className="absolute inset-0 pointer-events-none">
      {element && position && (
        <div
          data-timeline-gesture-actor={element.key ?? element.id}
          className="absolute"
          style={{
            top: position.top,
            left: position.left,
            width: Math.max(element.duration * pixelsPerSecond, 4),
            height: rowHeight,
            zIndex: 40,
          }}
        >
          <TimelineClip
            el={{ ...element, start: 0 }}
            pps={pixelsPerSecond}
            clipY={0}
            isSelected={selectedElementId === (element.key ?? element.id)}
            isHovered={false}
            isDragging
            isGestureActor
            isActive={isTimelineClipActive(element, currentTime)}
            hasCustomContent={!!renderClipContent}
            capabilities={getTimelineEditCapabilities(element)}
            theme={theme}
            isComposition={!!element.compositionSrc}
            onHoverStart={() => {}}
            onHoverEnd={() => {}}
            onResizeStart={() => {}}
            onClick={() => {}}
            onDoubleClick={() => {}}
          >
            {renderClipChildren(
              element,
              getTrackStyle(element.tag),
              renderClipContent,
              renderClipOverlay,
              { priority: "interaction", rich: true },
            )}
          </TimelineClip>
        </div>
      )}
    </div>
  );
});

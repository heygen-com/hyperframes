import type { ReactNode } from "react";
import { TimelineClip } from "./TimelineClip";
import { getTimelineEditCapabilities } from "./timelineEditing";
import { CLIP_Y, TRACK_H } from "./timelineLayout";
import type { TimelineTheme } from "./timelineTheme";
import type { TimelineElement } from "../store/playerStore";

interface TimelineDragGhostProps {
  element: TimelineElement;
  position: { left: number; top: number };
  pps: number;
  selectedElementId: string | null;
  hasCustomContent: boolean;
  theme: TimelineTheme;
  children: ReactNode;
}

export function TimelineDragGhost({
  element,
  position,
  pps,
  selectedElementId,
  hasCustomContent,
  theme,
  children,
}: TimelineDragGhostProps) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        top: position.top,
        left: position.left,
        width: Math.max(element.duration * pps, 4),
        height: TRACK_H - CLIP_Y * 2,
        zIndex: 40,
      }}
    >
      <TimelineClip
        el={{ ...element, start: 0 }}
        pps={pps}
        clipY={0}
        isSelected={selectedElementId === (element.key ?? element.id)}
        isHovered={false}
        isDragging={true}
        hasCustomContent={hasCustomContent}
        capabilities={getTimelineEditCapabilities(element)}
        theme={theme}
        isComposition={!!element.compositionSrc}
        onHoverStart={() => {}}
        onHoverEnd={() => {}}
        onResizeStart={() => {}}
        onClick={() => {}}
        onDoubleClick={() => {}}
      >
        {children}
      </TimelineClip>
    </div>
  );
}

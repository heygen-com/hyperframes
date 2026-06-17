import type { TimelineTrackStyle } from "./timelineTheme";

import { memo, type ReactNode } from "react";
import type { TimelineElement } from "../store/playerStore";
import { defaultTimelineTheme, getClipHandleOpacity, type TimelineTheme } from "./timelineTheme";
import type { TimelineEditCapabilities } from "./timelineEditing";

interface TimelineClipProps {
  el: TimelineElement;
  pps: number;
  clipY: number;
  isSelected: boolean;
  isHovered: boolean;
  isDragging?: boolean;
  hasCustomContent: boolean;
  capabilities: TimelineEditCapabilities;
  theme?: TimelineTheme;
  trackStyle: TimelineTrackStyle;
  isComposition: boolean;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onResizeStart?: (edge: "start" | "end", e: React.PointerEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  children?: ReactNode;
}

export const TimelineClip = memo(function TimelineClip({
  el,
  pps,
  clipY,
  isSelected,
  isHovered,
  isDragging = false,
  hasCustomContent,
  capabilities,
  theme = defaultTimelineTheme,
  trackStyle,
  isComposition,
  onHoverStart,
  onHoverEnd,
  onPointerDown,
  onResizeStart,
  onClick,
  onDoubleClick,
  onContextMenu,
  children,
}: TimelineClipProps) {
  const leftPx = el.start * pps;
  const widthPx = Math.max(el.duration * pps, 4);
  const handleOpacity = getClipHandleOpacity({ isHovered, isSelected, isDragging });

  const borderColor = isSelected
    ? trackStyle.accent
    : isHovered
      ? theme.clipBorderHover
      : theme.clipBorder;
  const boxShadow = isDragging
    ? theme.clipShadowDragging
    : isSelected
      ? `0 0 0 1px ${trackStyle.accent}80, 0 0 8px ${trackStyle.accent}25`
      : isHovered
        ? theme.clipShadowHover
        : theme.clipShadow;
  const displayLabel = el.label || el.id || el.tag;
  const showHandles = handleOpacity > 0.01;

  return (
    <div
      data-clip="true"
      className={
        hasCustomContent
          ? "absolute overflow-visible"
          : "absolute flex items-center overflow-visible"
      }
      style={{
        left: leftPx,
        width: widthPx,
        top: clipY,
        bottom: clipY,
        borderRadius: theme.clipRadius,
        background: trackStyle.clip,
        border: `1px solid ${borderColor}`,
        boxShadow,
        transition: "border-color 100ms, box-shadow 100ms",
        zIndex: isDragging ? 20 : isSelected ? 10 : isHovered ? 5 : 1,
        cursor: capabilities.canMove ? "grab" : "default",
        transform: isDragging ? "translateY(-1px)" : undefined,
        opacity: isDragging ? 0.92 : 1,
      }}
      title={
        isComposition
          ? `${el.compositionSrc} • Double-click to open`
          : `${displayLabel} • ${el.start.toFixed(1)}s – ${(el.start + el.duration).toFixed(1)}s`
      }
      onPointerEnter={onHoverStart}
      onPointerLeave={onHoverEnd}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {/* Left accent stripe — wider + brighter for expanded sub-comp children */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: el.expandedParentStart !== undefined ? 4 : 3,
          background: trackStyle.accent,
          opacity: el.expandedParentStart !== undefined ? 0.8 : isSelected ? 0.7 : 0.3,
          borderRadius: `${theme.clipRadius} 0 0 ${theme.clipRadius}`,
          zIndex: 2,
          pointerEvents: "none",
        }}
      />
      {/* Left trim handle */}
      {showHandles && capabilities.canTrimStart && (
        <div
          aria-hidden="true"
          onPointerDown={(e) => onResizeStart?.("start", e)}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 14,
            cursor: "col-resize",
            zIndex: 4,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 4,
              top: 6,
              bottom: 6,
              width: 2,
              borderRadius: 1,
              background: trackStyle.accent,
              opacity: handleOpacity * 0.6,
            }}
          />
        </div>
      )}
      {/* Right trim handle */}
      {showHandles && capabilities.canTrimEnd && (
        <div
          aria-hidden="true"
          onPointerDown={(e) => onResizeStart?.("end", e)}
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: 14,
            cursor: "col-resize",
            zIndex: 4,
          }}
        >
          <div
            style={{
              position: "absolute",
              right: 4,
              top: 6,
              bottom: 6,
              width: 2,
              borderRadius: 1,
              background: trackStyle.accent,
              opacity: handleOpacity * 0.6,
            }}
          />
        </div>
      )}
      {children}
    </div>
  );
});

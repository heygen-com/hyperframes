import { memo, type CSSProperties, type ReactNode } from "react";
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

// fallow-ignore-next-line complexity
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
  const displayLabel = el.label || el.id || el.tag;
  const showHandles = handleOpacity > 0.01 && (widthPx >= 32 || isSelected);
  const showLabel = widthPx >= 40 || isSelected;
  const showDefaultText = !hasCustomContent && (widthPx >= 40 || isSelected);
  const startLabel = el.start.toFixed(1);
  const endLabel = (el.start + el.duration).toFixed(1);
  const clipClassName = [
    "timeline-clip",
    "absolute",
    hasCustomContent ? "overflow-visible" : "overflow-hidden",
    isSelected ? "is-selected" : "",
    isHovered ? "is-hovered" : "",
    isDragging ? "is-dragging" : "",
    showDefaultText ? "" : "is-micro",
  ]
    .filter((className) => className.length > 0)
    .join(" ");
  const style: CSSProperties = {
    left: leftPx,
    width: widthPx,
    top: clipY,
    bottom: clipY,
    borderRadius: theme.clipRadius,
    zIndex: isDragging ? 20 : isSelected ? 10 : isHovered ? 5 : 1,
    cursor: capabilities.canMove ? "grab" : "default",
    transform: isDragging ? "translateY(-1px)" : undefined,
  };

  return (
    <div
      data-clip="true"
      data-el-id={el.key ?? el.id}
      data-clip-start={el.start}
      data-clip-end={el.start + el.duration}
      data-clip-hidden={el.hidden ? "true" : undefined}
      className={clipClassName}
      style={style}
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
            className="timeline-clip__handle-bar"
            style={{
              position: "absolute",
              left: 4,
              top: 6,
              bottom: 6,
              width: 2,
              borderRadius: 1,
              background: "rgba(255, 255, 255, 0.55)",
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
            className="timeline-clip__handle-bar"
            style={{
              position: "absolute",
              right: 4,
              top: 6,
              bottom: 6,
              width: 2,
              borderRadius: 1,
              background: "rgba(255, 255, 255, 0.55)",
              opacity: handleOpacity * 0.6,
            }}
          />
        </div>
      )}
      {showLabel && <span className="timeline-clip__label">{displayLabel}</span>}
      {showDefaultText && (
        <span className="timeline-clip__timecode">
          {startLabel}-{endLabel}s
        </span>
      )}
      {children}
    </div>
  );
});

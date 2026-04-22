import type { TimelineTrackStyle } from "./timelineTheme";
// TimelineClip — Visual clip component for the NLE timeline.

import { memo, type ReactNode } from "react";
import type { TimelineElement } from "../store/playerStore";
import { defaultTimelineTheme, getClipHandleOpacity, type TimelineTheme } from "./timelineTheme";

interface TimelineClipProps {
  el: TimelineElement;
  pps: number;
  clipY: number;
  isSelected: boolean;
  isHovered: boolean;
  isDragging?: boolean;
  hasCustomContent: boolean;
  theme?: TimelineTheme;
  trackStyle: TimelineTrackStyle;
  isComposition: boolean;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onResizeStart?: (edge: "start" | "end", e: React.PointerEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
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
  theme = defaultTimelineTheme,
  trackStyle,
  isComposition,
  onHoverStart,
  onHoverEnd,
  onPointerDown,
  onResizeStart,
  onClick,
  onDoubleClick,
  children,
}: TimelineClipProps) {
  const leftPx = el.start * pps;
  const widthPx = Math.max(el.duration * pps, 4);
  const handleOpacity = getClipHandleOpacity({ isHovered, isSelected, isDragging });
  const borderColor = isSelected
    ? theme.clipBorderActive
    : isHovered
      ? theme.clipBorderHover
      : theme.clipBorder;
  const boxShadow = isDragging
    ? theme.clipShadowDragging
    : isSelected
      ? theme.clipShadowActive
      : isHovered
        ? theme.clipShadowHover
        : theme.clipShadow;
  const showHandles = handleOpacity > 0.01;

  return (
    <div
      data-clip="true"
      className={
        hasCustomContent ? "absolute overflow-hidden" : "absolute flex items-center overflow-hidden"
      }
      style={{
        left: leftPx,
        width: widthPx,
        top: clipY,
        bottom: clipY,
        borderRadius: theme.clipRadius,
        background: isSelected
          ? `linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0)), linear-gradient(120deg, ${trackStyle.accent}22, transparent 28%), ${theme.clipBackgroundActive}`
          : `linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0)), linear-gradient(120deg, ${trackStyle.accent}1e, transparent 28%), ${theme.clipBackground}`,
        backgroundImage:
          isComposition && !hasCustomContent
            ? `repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(255,255,255,0.05) 3px, rgba(255,255,255,0.05) 6px)`
            : undefined,
        border: `1px solid ${borderColor}`,
        boxShadow,
        transition:
          "border-color 120ms ease-out, box-shadow 140ms ease-out, background 140ms ease-out",
        zIndex: isDragging ? 20 : isSelected ? 10 : isHovered ? 5 : 1,
        cursor: "grab",
        transform: isDragging ? "translateY(-1px)" : undefined,
      }}
      title={
        isComposition
          ? `${el.compositionSrc} \u2022 Double-click to open`
          : `${el.id || el.tag} \u2022 ${el.start.toFixed(1)}s \u2013 ${(el.start + el.duration).toFixed(1)}s`
      }
      onPointerEnter={onHoverStart}
      onPointerLeave={onHoverEnd}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <div
        aria-hidden="true"
        role="presentation"
        onPointerDown={(e) => onResizeStart?.("start", e)}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 18,
          opacity: showHandles ? 1 : 0,
          pointerEvents: onResizeStart ? "auto" : "none",
          zIndex: 4,
          transition: "opacity 120ms ease-out",
          cursor: "col-resize",
          background: showHandles
            ? `linear-gradient(90deg, ${trackStyle.accent}4d 0%, ${trackStyle.accent}22 42%, transparent 100%)`
            : "transparent",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 6,
            top: 7,
            bottom: 7,
            width: 3,
            borderRadius: 999,
            background: theme.handleColor,
            boxShadow: `0 0 0 1px ${trackStyle.accent}38, 0 0 12px ${trackStyle.accent}18`,
            opacity: handleOpacity,
            pointerEvents: "none",
          }}
        />
      </div>
      <div
        aria-hidden="true"
        role="presentation"
        onPointerDown={(e) => onResizeStart?.("end", e)}
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: 18,
          opacity: showHandles ? 1 : 0,
          pointerEvents: onResizeStart ? "auto" : "none",
          zIndex: 4,
          transition: "opacity 120ms ease-out",
          cursor: "col-resize",
          background: showHandles
            ? `linear-gradient(270deg, ${trackStyle.accent}4d 0%, ${trackStyle.accent}22 42%, transparent 100%)`
            : "transparent",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: 6,
            top: 7,
            bottom: 7,
            width: 3,
            borderRadius: 999,
            background: theme.handleColor,
            boxShadow: `0 0 0 1px ${trackStyle.accent}38, 0 0 12px ${trackStyle.accent}18`,
            opacity: handleOpacity,
            pointerEvents: "none",
          }}
        />
      </div>
      {children}
    </div>
  );
});

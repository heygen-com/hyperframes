// TimelineClip — Visual clip component for the NLE timeline.

import { memo, type ReactNode } from "react";
import type { TimelineElement } from "../store/playerStore";

interface TimelineClipProps {
  el: TimelineElement;
  pps: number;
  trackH: number;
  clipY: number;
  isSelected: boolean;
  isHovered: boolean;
  hasCustomContent: boolean;
  style: { clip: string; label: string };
  isComposition: boolean;
  onHoverStart: () => void;
  onHoverEnd: () => void;
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
  hasCustomContent,
  style,
  isComposition,
  onHoverStart,
  onHoverEnd,
  onClick,
  onDoubleClick,
  children,
}: TimelineClipProps) {
  const leftPx = el.start * pps;
  const widthPx = Math.max(el.duration * pps, 4);

  return (
    <div
      data-clip="true"
      className={hasCustomContent ? "absolute" : "absolute flex items-center"}
      style={{
        left: leftPx,
        width: widthPx,
        top: clipY,
        bottom: clipY,
        borderRadius: 5,
        backgroundColor: hasCustomContent ? (isComposition ? "#111" : style.clip) : style.clip,
        backgroundImage:
          isComposition && !hasCustomContent
            ? `repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(255,255,255,0.08) 3px, rgba(255,255,255,0.08) 6px)`
            : undefined,
        border: isSelected
          ? "2px solid rgba(255,255,255,0.9)"
          : `1px solid rgba(255,255,255,${isHovered ? 0.3 : 0.15})`,
        boxShadow: isSelected
          ? `0 0 0 1px ${style.clip}, 0 2px 8px rgba(0,0,0,0.4)`
          : isHovered
            ? "0 1px 4px rgba(0,0,0,0.3)"
            : "none",
        transition: "border-color 120ms, box-shadow 120ms",
        zIndex: isSelected ? 10 : isHovered ? 5 : 1,
        cursor: "pointer",
      }}
      title={
        isComposition
          ? `${el.compositionSrc} \u2022 Double-click to open`
          : `${el.id || el.tag} \u2022 ${el.start.toFixed(1)}s \u2013 ${(el.start + el.duration).toFixed(1)}s`
      }
      onPointerEnter={onHoverStart}
      onPointerLeave={onHoverEnd}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {children}
    </div>
  );
});

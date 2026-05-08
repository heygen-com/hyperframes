import type { TimelineTrackStyle } from "./timelineTheme";
// TimelineClip — Visual clip component for the NLE timeline.

import { memo, type ReactNode } from "react";
import type { TimelineElement } from "../store/playerStore";
import { defaultTimelineTheme, getClipHandleOpacity, type TimelineTheme } from "./timelineTheme";
import { getTimelineEditCapabilities } from "./timelineEditing";

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
  isInspectorActive?: boolean;
  isThumbnailActive?: boolean;
  thumbnailLabel?: string;
  childCount?: number;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onResizeStart?: (edge: "start" | "end", e: React.PointerEvent) => void;
  onInspectorClick?: (e: React.MouseEvent) => void;
  onThumbnailClick?: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  children?: ReactNode;
}

export const TIMELINE_CLIP_CONTROL_Z_INDEX = 20;

const COMPACT_CLIP_CONTROL_WIDTH = 112;

interface TimelineClipControlPresentationInput {
  widthPx: number;
  isSelected: boolean;
  isHovered: boolean;
  isInspectorActive: boolean;
  isThumbnailActive: boolean;
  isDragging: boolean;
}

export interface TimelineClipControlPresentation {
  compact: boolean;
  showControls: boolean;
  containerClassName: string;
  buttonClassName: string;
  iconSize: number;
}

export function getTimelineClipControlPresentation({
  widthPx,
  isSelected,
  isHovered,
  isInspectorActive,
  isThumbnailActive,
  isDragging,
}: TimelineClipControlPresentationInput): TimelineClipControlPresentation {
  const compact = widthPx < COMPACT_CLIP_CONTROL_WIDTH;
  const isInteractive = isHovered || isSelected || isInspectorActive || isThumbnailActive;
  const showControls = !isDragging && (!compact || isInteractive);

  return {
    compact,
    showControls,
    containerClassName: compact
      ? "absolute right-1 top-1 flex items-center gap-1"
      : "absolute right-2 top-2 flex items-center gap-1",
    buttonClassName: compact
      ? "flex h-5 w-5 items-center justify-center rounded-[7px]"
      : "flex h-6 w-6 items-center justify-center rounded-md",
    iconSize: compact ? 12 : 14,
  };
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
  isInspectorActive = false,
  isThumbnailActive = false,
  thumbnailLabel = "thumbnail",
  childCount = 0,
  onHoverStart,
  onHoverEnd,
  onPointerDown,
  onResizeStart,
  onInspectorClick,
  onThumbnailClick,
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
  const capabilities = getTimelineEditCapabilities(el);
  const displayLabel = el.label || el.id || el.tag;
  const inspectorLabel =
    childCount > 0
      ? `${childCount} nested selectable layer${childCount === 1 ? "" : "s"}`
      : "Inspect clip layer";
  const showHandles = handleOpacity > 0.01;
  const baseBackgroundImage = isSelected ? theme.clipBackgroundActive : theme.clipBackground;
  const controlPresentation = getTimelineClipControlPresentation({
    widthPx,
    isSelected,
    isHovered,
    isInspectorActive,
    isThumbnailActive,
    isDragging,
  });
  const glossBackgroundImage = isSelected
    ? "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0))"
    : "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0))";
  const accentBackgroundImage = `linear-gradient(120deg, ${trackStyle.accent}${
    isSelected ? "22" : "1e"
  }, transparent 28%)`;
  const compositionStripeBackgroundImage =
    isComposition && !hasCustomContent
      ? "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(255,255,255,0.05) 3px, rgba(255,255,255,0.05) 6px)"
      : undefined;
  const clipBackgroundImage = [
    compositionStripeBackgroundImage,
    glossBackgroundImage,
    accentBackgroundImage,
    baseBackgroundImage,
  ]
    .filter(Boolean)
    .join(", ");

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
        backgroundImage: clipBackgroundImage,
        border: `1px solid ${borderColor}`,
        boxShadow,
        transition:
          "border-color 120ms ease-out, box-shadow 140ms ease-out, background 140ms ease-out",
        zIndex: isDragging ? 20 : isSelected ? 10 : isHovered ? 5 : 1,
        cursor: capabilities.canMove ? "grab" : "default",
        transform: isDragging ? "translateY(-1px)" : undefined,
      }}
      title={
        isComposition
          ? `${el.compositionSrc} \u2022 Double-click to open`
          : `${displayLabel} \u2022 ${el.start.toFixed(1)}s \u2013 ${(el.start + el.duration).toFixed(1)}s`
      }
      onPointerEnter={onHoverStart}
      onPointerLeave={onHoverEnd}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {childCount > 0 && controlPresentation.showControls && (
        <button
          type="button"
          className={`absolute flex items-center gap-1 rounded-md border border-studio-accent/30 bg-neutral-950/75 text-[10px] font-semibold tabular-nums text-studio-accent shadow-lg shadow-black/25 backdrop-blur transition-colors hover:border-studio-accent/60 hover:bg-studio-accent/15 ${
            controlPresentation.compact ? "left-1 top-1 h-5 px-1" : "left-2 top-2 h-6 px-1.5"
          }`}
          style={{ zIndex: TIMELINE_CLIP_CONTROL_Z_INDEX }}
          title={inspectorLabel}
          aria-label={inspectorLabel}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onInspectorClick?.(event);
          }}
        >
          <svg
            width={controlPresentation.compact ? "11" : "13"}
            height={controlPresentation.compact ? "11" : "13"}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="4" y="4" width="6" height="6" rx="1" />
            <rect x="14" y="4" width="6" height="6" rx="1" />
            <rect x="4" y="14" width="6" height="6" rx="1" />
            <path d="M14 17h6" />
          </svg>
          {childCount}
        </button>
      )}
      {onInspectorClick &&
        controlPresentation.compact &&
        !controlPresentation.showControls &&
        !isDragging && (
          <button
            type="button"
            className="group/clip-inspect absolute right-1 top-1/2 flex h-7 w-2 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-neutral-950/70 text-neutral-300 shadow-lg shadow-black/25 backdrop-blur transition-all hover:w-5 hover:border-white/30 hover:bg-neutral-950/90 focus:w-5 focus:border-studio-accent/60 focus:bg-studio-accent/15 focus:outline-none"
            style={{ zIndex: TIMELINE_CLIP_CONTROL_Z_INDEX }}
            title={inspectorLabel}
            aria-label={inspectorLabel}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onInspectorClick(event);
            }}
          >
            <svg
              className="opacity-0 transition-opacity group-hover/clip-inspect:opacity-100 group-focus/clip-inspect:opacity-100"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        )}
      {(onThumbnailClick || onInspectorClick) && controlPresentation.showControls && (
        <div
          className={controlPresentation.containerClassName}
          style={{ zIndex: TIMELINE_CLIP_CONTROL_Z_INDEX }}
        >
          {onThumbnailClick && (
            <button
              type="button"
              className={`${controlPresentation.buttonClassName} border shadow-lg shadow-black/25 backdrop-blur transition-colors ${
                isThumbnailActive
                  ? "border-studio-accent/60 bg-studio-accent/18 text-studio-accent"
                  : "border-white/12 bg-neutral-950/70 text-neutral-400 hover:border-white/24 hover:text-neutral-100"
              }`}
              title={
                isThumbnailActive ? `Hide clip ${thumbnailLabel}` : `Show clip ${thumbnailLabel}`
              }
              aria-label={
                isThumbnailActive ? `Hide clip ${thumbnailLabel}` : `Show clip ${thumbnailLabel}`
              }
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                onThumbnailClick(event);
              }}
            >
              <svg
                width={controlPresentation.iconSize}
                height={controlPresentation.iconSize}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="8" cy="10" r="1.5" />
                <path d="m4 17 5-5 4 4 2-2 5 5" />
              </svg>
            </button>
          )}
          {onInspectorClick && (
            <button
              type="button"
              className={`${controlPresentation.buttonClassName} border shadow-lg shadow-black/25 backdrop-blur transition-colors ${
                isInspectorActive
                  ? "border-studio-accent/60 bg-studio-accent/18 text-studio-accent"
                  : "border-white/12 bg-neutral-950/70 text-neutral-400 hover:border-white/24 hover:text-neutral-100"
              }`}
              title={inspectorLabel}
              aria-label={inspectorLabel}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                onInspectorClick(event);
              }}
            >
              <svg
                width={controlPresentation.iconSize}
                height={controlPresentation.iconSize}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          )}
        </div>
      )}
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
          opacity: showHandles && capabilities.canTrimStart ? 1 : 0,
          pointerEvents: onResizeStart && capabilities.canTrimStart ? "auto" : "none",
          zIndex: 4,
          transition: "opacity 120ms ease-out",
          cursor: "col-resize",
          background:
            showHandles && capabilities.canTrimStart
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
          opacity: showHandles && capabilities.canTrimEnd ? 1 : 0,
          pointerEvents: onResizeStart && capabilities.canTrimEnd ? "auto" : "none",
          zIndex: 4,
          transition: "opacity 120ms ease-out",
          cursor: "col-resize",
          background:
            showHandles && capabilities.canTrimEnd
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

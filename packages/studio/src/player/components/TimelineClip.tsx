import { memo, type CSSProperties, type ReactNode } from "react";
import type { TimelineElement } from "../store/playerStore";
import {
  CLIP_TRIM_HIT_PX,
  clipWidthLadder,
  defaultTimelineTheme,
  getClipHandleOpacity,
  type TimelineTheme,
} from "./timelineTheme";
import type { TimelineEditCapabilities } from "./timelineEditing";
import { isAudioTimelineElement } from "../../utils/timelineInspector";
import { timelineClipFocusId } from "./timelineNavigationIdentity";
import { ClipFadesContext, TimelineClipFades, useClipFadeDraft } from "./TimelineClipFades";
import { rendersWaveform } from "./AudioWaveform";
import { ClipBadges } from "./ClipBadges";
import { linkLabelColor } from "./linkLabelColor";
import { OutOfSyncBadge } from "./OutOfSyncBadge";
import { clipSpeedSuffix } from "./clipToolAttrs";

interface TimelineClipProps {
  el: TimelineElement;
  pps: number;
  clipY: number;
  clipHeight?: number;
  isSelected: boolean;
  isHovered: boolean;
  isDragging?: boolean;
  isGestureActor?: boolean;
  isActive?: boolean;
  hasCustomContent: boolean;
  capabilities: TimelineEditCapabilities;
  theme?: TimelineTheme;
  isComposition: boolean;
  tabIndex?: 0 | -1;
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
  clipHeight,
  isSelected,
  isHovered,
  isDragging = false,
  isGestureActor = false,
  isActive = false,
  hasCustomContent,
  capabilities,
  theme = defaultTimelineTheme,
  isComposition,
  tabIndex = -1,
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
  const displayLabel = `${el.label || el.id || el.tag}${clipSpeedSuffix(el.playbackRate, el.automation)}`;
  const isAudioClip = isAudioTimelineElement(el);
  const ladder = clipWidthLadder(widthPx);
  const showHandles = handleOpacity > 0.01 && (widthPx >= 32 || isSelected);
  const showLabel = !isAudioClip || ladder === "labeled";
  const showDefaultText = !hasCustomContent && ladder === "labeled";
  const startLabel = el.start.toFixed(1);
  const endLabel = (el.start + el.duration).toFixed(1);
  const themeVariables = {
    "--clip-bg": theme.clipBackground,
    "--clip-bg-active": theme.clipBackgroundActive,
    "--clip-bg-hover": theme.clipBackgroundHover,
    "--clip-bg-dragging": theme.clipBackgroundDragging,
    "--clip-border": theme.clipBorder,
    "--clip-border-hover": theme.clipBorderHover,
    "--clip-border-active": theme.clipBorderActive,
    "--clip-handle": theme.handleColor,
  } as CSSProperties;
  const linkColor = linkLabelColor(el.link);
  if (linkColor) Object.assign(themeVariables, { "--clip-link-color": linkColor });
  const hasFades = (isAudioClip || Boolean(el.hasAudio)) && !isGestureActor;
  const fade = useClipFadeDraft(el);
  const badges =
    ladder === "labeled" && !isGestureActor ? (
      <ClipBadges el={el} onOpenMenu={onContextMenu} />
    ) : null;
  const clipClassName = [
    "timeline-clip",
    "absolute",
    hasCustomContent ? "overflow-visible" : "overflow-hidden",
    isSelected ? "is-selected" : "",
    isHovered ? "is-hovered" : "",
    isDragging ? "is-dragging" : "",
    isAudioClip ? "is-audio" : "",
  ]
    .filter((className) => className.length > 0)
    .join(" ");
  const style: CSSProperties = {
    left: leftPx,
    width: widthPx,
    top: clipY,
    ...(clipHeight === undefined ? { bottom: clipY } : { height: clipHeight }),
    borderRadius: isAudioClip ? theme.audioClipRadius : theme.clipRadius,
    ...themeVariables,
    zIndex: isDragging ? 20 : isSelected ? 10 : isHovered ? 5 : 1,
    // Regular cursor over clips (CapCut-style, user preference) — no grab hand.
    cursor: "default",
    appearance: "none",
    color: "inherit",
    font: "inherit",
    padding: 0,
    textAlign: "left",
    transform: isDragging ? "translateY(-1px)" : undefined,
  };

  return (
    <button
      type="button"
      data-clip={isGestureActor ? undefined : "true"}
      data-el-id={isGestureActor ? undefined : (el.key ?? el.id)}
      data-timeline-focus-id={isGestureActor ? undefined : timelineClipFocusId(el.key ?? el.id)}
      data-clip-start={el.start}
      data-clip-end={el.start + el.duration}
      data-clip-hidden={el.hidden ? "true" : undefined}
      data-link-color={linkColor ?? undefined}
      data-ladder={ladder}
      data-active={isActive ? "" : undefined}
      aria-hidden={isGestureActor ? "true" : undefined}
      tabIndex={isGestureActor ? undefined : tabIndex}
      aria-label={`${displayLabel}, ${startLabel} to ${endLabel} seconds`}
      aria-pressed={isGestureActor ? undefined : isSelected}
      className={clipClassName}
      style={style}
      title={
        isComposition
          ? `${el.compositionSrc} • Double-click to open`
          : `${displayLabel} • ${startLabel}s – ${endLabel}s`
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
            width: CLIP_TRIM_HIT_PX,
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
              background: "var(--clip-handle)",
              opacity: handleOpacity,
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
            width: CLIP_TRIM_HIT_PX,
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
              background: "var(--clip-handle)",
              opacity: handleOpacity,
            }}
          />
        </div>
      )}
      {showLabel && (
        <span className="timeline-clip__label">
          <span className="timeline-clip__name">{displayLabel}</span>
          {!isAudioClip && badges}
        </span>
      )}
      {isAudioClip && badges}
      {!isGestureActor && el.syncOrigin && <OutOfSyncBadge el={el} />}
      {showDefaultText && (
        <span className="timeline-clip__timecode">
          {startLabel}-{endLabel}s
        </span>
      )}
      <ClipFadesContext.Provider value={hasFades ? fade.shape : null}>
        {children}
      </ClipFadesContext.Provider>
      {/* Fade handles for anything the mixer hears: audio clips and videos marked
          data-has-audio. They write data-fade-in/out, the timeline half of the
          inspector's Fade rows. */}
      {hasFades && (
        <TimelineClipFades
          el={el}
          pps={pps}
          widthPx={widthPx}
          showHandles={(isHovered || isSelected) && !isDragging}
          focusable={isSelected}
          hasWaveform={rendersWaveform(el)}
          fade={fade}
        />
      )}
    </button>
  );
});

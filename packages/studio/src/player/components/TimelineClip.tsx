import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
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
import { TOOLTIP_HOVER_DELAY_MS, Tooltip } from "../../components/ui/Tooltip";
import { ClipPeakTooltip } from "./ClipPeakTooltip";
import { timeLayerPercent } from "./TimelineTimeLayer";

interface TimelineClipProps {
  el: TimelineElement;
  pps: number;
  passengerStyle?: CSSProperties;
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

const HANDLES_MIN_PX = 32;

const CLIP_MIN_WIDTH_PX = 4;
export const clipWidthPx = (el: TimelineElement, pps: number) =>
  Math.max(el.duration * pps, CLIP_MIN_WIDTH_PX);

/** Zoom-dependent drawing as one value: width tier and trim fit, or the scale while fades show. */
export function clipZoomKey(el: TimelineElement, pps: number, interacting: boolean) {
  const fadesLive = interacting || (el.fadeIn ?? 0) > 0 || (el.fadeOut ?? 0) > 0;
  if (fadesLive) return pps;
  const widthPx = clipWidthPx(el, pps);
  return `${clipWidthLadder(widthPx)}${widthPx >= HANDLES_MIN_PX ? "+handles" : ""}`;
}

// fallow-ignore-next-line complexity
export const TimelineClip = memo(function TimelineClip({
  el,
  pps,
  passengerStyle,
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
  const widthPx = clipWidthPx(el, pps);
  const handleOpacity = getClipHandleOpacity({ isHovered, isSelected, isDragging });
  const displayLabel = `${el.label || el.id || el.tag}${clipSpeedSuffix(el.playbackRate, el.automation)}`;
  const isAudioClip = isAudioTimelineElement(el);
  const ladder = clipWidthLadder(widthPx);
  const showHandles = handleOpacity > 0.01 && (widthPx >= HANDLES_MIN_PX || isSelected);
  const showLabel = !isAudioClip || ladder === "labeled";
  const showDefaultText = !hasCustomContent && ladder === "labeled";
  const startLabel = el.start.toFixed(1);
  const endLabel = (el.start + el.duration).toFixed(1);
  const clipRef = useRef<HTMLButtonElement>(null);
  const nameTooltipId = useId();
  const [showFullName, setShowFullName] = useState(false);
  const nameTitle = isComposition
    ? `${displayLabel} • Double-click to open`
    : `${displayLabel} • ${startLabel}s to ${endLabel}s`;
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearRevealTimer = () => {
    if (revealTimer.current === null) return;
    clearTimeout(revealTimer.current);
    revealTimer.current = null;
  };
  useEffect(() => clearRevealTimer, []);
  const hideFullName = () => {
    clearRevealTimer();
    setShowFullName(false);
  };
  const revealFullName = (target: HTMLElement, delayMs = 0) => {
    clearRevealTimer();
    const measure = () => {
      const node = target.querySelector<HTMLElement>(
        isAudioClip ? ".timeline-clip__label" : ".timeline-clip__name",
      );
      setShowFullName(Boolean(node && node.scrollWidth > node.clientWidth));
    };
    if (delayMs <= 0) {
      measure();
      return;
    }
    revealTimer.current = setTimeout(measure, delayMs);
  };
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
    left: timeLayerPercent(el.start),
    width: timeLayerPercent(el.duration),
    minWidth: CLIP_MIN_WIDTH_PX,
    top: clipY,
    ...(clipHeight === undefined ? { bottom: clipY } : { height: clipHeight }),
    borderRadius: isAudioClip ? theme.audioClipRadius : theme.clipRadius,
    ...themeVariables,
    zIndex: isDragging ? 20 : isSelected ? 10 : isHovered ? 5 : 1,
    cursor: "default",
    appearance: "none",
    color: "inherit",
    font: "inherit",
    padding: 0,
    textAlign: "left",
    transform: isDragging ? "translateY(-1px)" : undefined,
    ...passengerStyle,
  };

  const clip = (
    <button
      ref={clipRef}
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
      aria-keyshortcuts={isGestureActor || !capabilities.canMove ? undefined : "Space"}
      aria-description={
        isGestureActor || !capabilities.canMove
          ? undefined
          : "Space picks up. Up and Down choose a new track. Enter drops. Escape cancels."
      }
      className={clipClassName}
      style={style}
      title={showFullName ? undefined : nameTitle}
      aria-describedby={showFullName ? nameTooltipId : undefined}
      onPointerEnter={(event) => {
        // Audio already waits inside ClipPeakTooltip. Picture clips own their open state.
        revealFullName(event.currentTarget, isAudioClip ? 0 : TOOLTIP_HOVER_DELAY_MS);
        onHoverStart();
      }}
      onPointerLeave={() => {
        hideFullName();
        onHoverEnd();
      }}
      onFocus={(event) => revealFullName(event.currentTarget)}
      onBlur={hideFullName}
      onPointerDown={(event) => {
        hideFullName();
        onPointerDown?.(event);
      }}
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
  if (isAudioClip || el.hasAudio) {
    return (
      <ClipPeakTooltip overflowLabel={showFullName ? nameTitle : undefined}>{clip}</ClipPeakTooltip>
    );
  }
  // The button stays a direct lane child. A wrapper span would split it from the keyframe diamonds beside it.
  return (
    <>
      {clip}
      <Tooltip label={nameTitle} anchorRef={clipRef} open={showFullName} id={nameTooltipId} />
    </>
  );
});

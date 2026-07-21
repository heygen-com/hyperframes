import { Fragment, memo, useEffect, useRef, useState } from "react";
import { BEAT_BAND_H } from "./BeatStrip";
import { MiniCurveSvg } from "../../components/editor/EaseCurveSection";
import { LANE_H } from "./timelineLayout";
import {
  timelineKeyframeSelectionKey,
  type TimelineKeyframeTarget,
} from "./timelineKeyframeIdentity";
import type { AnimationKeyframeTarget } from "../../hooks/gsapTweenSynth";
import {
  beginTimelineKeyframeRetime,
  type TimelineKeyframeRetimeHandle,
} from "./useTimelineKeyframeHandlers";

export interface TimelineDiamondKeyframe {
  percentage: number;
  /** Tween-relative percentage (the retime mutation keys on this, not clip %). */
  tweenPercentage?: number;
  propertyGroup?: string;
  animationId?: string;
  properties: Record<string, number | string>;
  ease?: string;
  /** Source animation/keyframe targets that collide at this clip percentage. */
  collidingAnimationTargets?: AnimationKeyframeTarget[];
}

interface KeyframeCacheEntry {
  format: string;
  keyframes: TimelineDiamondKeyframe[];
  ease?: string;
  easeEach?: string;
}

interface TimelineClipDiamondsProps {
  keyframesData: KeyframeCacheEntry;
  clipWidthPx: number;
  clipHeightPx: number;
  /** Beat-dot strip is shown on this track → shrink diamonds + drop them into
   *  the bottom half so they clear the strip at the top. */
  beatsActive?: boolean;
  accentColor: string;
  isSelected: boolean;
  currentPercentage: number;
  elementId: string;
  selectedKeyframes: ReadonlySet<string>;
  onClickKeyframe?: (percentage: number) => void;
  onShiftClickKeyframe?: (elementId: string, percentage: number) => void;
  onContextMenuKeyframe?: (e: React.MouseEvent, elementId: string, percentage: number) => void;
  /** Drag-to-retime: move a keyframe to a new time, preserving its value + ease.
   *  Both percentages are clip-relative: `fromClipPercentage` identifies the
   *  dragged keyframe, `toClipPercentage` is the neighbour-clamped drop position.
   *  The handler decides move (within the tween) vs resize (past its boundary). */
  onMoveKeyframe?: (
    elementId: string,
    fromClipPercentage: number,
    toClipPercentage: number,
  ) => Promise<boolean>;
  /** Open the segment ease editor for the hovered mid-point button — available on
   *  the inline clip row too, not just the expanded lanes. */
  onSelectSegment?: (elementId: string, target: TimelineKeyframeTarget) => void;
  /** Set while resolving a diamond press so the ancestor clip's onClick (which
   *  toggles selection off when already selected) ignores the native "click"
   *  the browser auto-synthesizes after this button's pointerdown+pointerup. */
  suppressClickRef?: React.RefObject<boolean>;
}

interface TimelineDiamondLaneProps extends Omit<
  TimelineClipDiamondsProps,
  | "onClickKeyframe"
  | "onShiftClickKeyframe"
  | "onContextMenuKeyframe"
  | "onMoveKeyframe"
  | "onSelectSegment"
> {
  groupAware?: boolean;
  globalEase?: string;
  onSelectSegment?: (target: TimelineKeyframeTarget) => void;
  onClickKeyframe?: (target: TimelineKeyframeTarget) => void;
  onShiftClickKeyframe?: (target: TimelineKeyframeTarget) => void;
  onContextMenuKeyframe?: (e: React.MouseEvent, target: TimelineKeyframeTarget) => void;
  onMoveKeyframe?: (target: TimelineKeyframeTarget, toClipPercentage: number) => Promise<boolean>;
}

const DIAMOND_RATIO = 0.8;
// Percentage tolerance for rendering keyframes near clip boundaries. Keyframes
// slightly outside [0, 100] (from rounding or stale cache during the async
// persist → reload cycle) are still rendered (the clip is overflow-visible) at
// their true position rather than hidden.
const KF_MIN_PCT = -5;
const KF_MAX_PCT = 105;

function keyframeTarget(
  keyframe: TimelineDiamondKeyframe,
  groupAware: boolean,
): TimelineKeyframeTarget {
  return groupAware
    ? {
        percentage: keyframe.percentage,
        tweenPercentage: keyframe.tweenPercentage,
        propertyGroup: keyframe.propertyGroup,
        animationId: keyframe.animationId,
        collidingAnimationTargets: keyframe.collidingAnimationTargets,
      }
    : { percentage: keyframe.percentage };
}

export const TimelineDiamondLane = memo(function TimelineDiamondLane({
  keyframesData,
  clipWidthPx,
  clipHeightPx,
  beatsActive,
  accentColor,
  isSelected,
  currentPercentage,
  elementId,
  selectedKeyframes,
  onClickKeyframe,
  onShiftClickKeyframe,
  onContextMenuKeyframe,
  onMoveKeyframe,
  onSelectSegment,
  suppressClickRef,
  groupAware = false,
  globalEase = "none",
}: TimelineDiamondLaneProps) {
  // Hooks must run before the early return below.
  const mountedRef = useRef(true);
  const retimeHandleRef = useRef<TimelineKeyframeRetimeHandle | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // Visual-only preview of the dragged diamond's clip-% — no runtime/GSAP hold
  // (that optimistic hold was the #1763 flake). The atomic move-keyframe commit
  // on drop re-keys the diamond from source.
  const [preview, setPreview] = useState<{ kfKey: string; clipPct: number } | null>(null);
  // The button element can re-render (reposition/unmount) synchronously from
  // the state updates onClickKeyframe/onMoveKeyframe trigger, before the
  // browser gets to auto-synthesize the "click" event that normally follows
  // pointerdown+pointerup on a button. That orphaned click then fires on
  // whatever ancestor is still there — the clip wrapper — whose own onClick
  // toggles selection off when the clip is already selected (the state a
  // diamond click always happens in). Suppressing it here is the same fix
  // already used for clip drag/resize in useTimelineClipDrag.ts.
  const suppressNextClick = () => {
    if (!suppressClickRef) return;
    suppressClickRef.current = true;
    requestAnimationFrame(() => {
      suppressClickRef.current = false;
    });
  };

  if (clipWidthPx < 20) return null;

  // When the beat strip occupies the top band, shrink the diamonds and center
  // them in the remaining bottom region so they don't collide with it.
  // One consistent keyframe-diamond size everywhere (clip bars + property lanes),
  // matching the property-lane size (LANE_H · ratio). Beat-strip tracks still
  // shrink to fit under the strip.
  const diamondSize = beatsActive
    ? Math.round(clipHeightPx * 0.45)
    : Math.round(LANE_H * DIAMOND_RATIO);
  const centerY = beatsActive ? BEAT_BAND_H + (clipHeightPx - BEAT_BAND_H) / 2 : clipHeightPx / 2;
  const sorted = keyframesData.keyframes
    .filter((kf) => kf.percentage >= KF_MIN_PCT && kf.percentage <= KF_MAX_PCT)
    .sort((a, b) => a.percentage - b.percentage);
  // Clip-%s of the sorted keyframes — the neighbour clamp (preview + drop) needs
  // the whole row to bound the dragged diamond between its immediate siblings.
  const sortedClipPcts = sorted.map((k) => k.percentage);
  const sortedCenterXs = sorted.map((keyframe) =>
    Math.max(0, Math.min(clipWidthPx, (keyframe.percentage / 100) * clipWidthPx)),
  );
  const markerMetrics = sortedCenterXs.map((centerX, index) => {
    const previousGap = index > 0 ? centerX - sortedCenterXs[index - 1]! : Infinity;
    const nextGap =
      index < sortedCenterXs.length - 1 ? sortedCenterXs[index + 1]! - centerX : Infinity;
    const nearestGap = Math.max(1, Math.min(previousGap, nextGap));
    const hitWidth = Math.min(diamondSize, nearestGap);
    return {
      hitWidth,
      visualSize: hitWidth === diamondSize ? diamondSize : Math.max(2, hitWidth - 2),
    };
  });
  const baseColor = isSelected ? accentColor : "#a3a3a3";
  const baseOpacity = isSelected ? 0.4 : 0.25;
  const canDrag = isSelected && !!onMoveKeyframe;

  return (
    <div
      className="absolute inset-0"
      style={{
        // Above the clip's trim-handle strips (TimelineClip.tsx, z-index 4) so
        // a keyframe sitting in the first/last ~14px of the clip stays
        // clickable instead of being covered by the resize handle. This div
        // establishes its own stacking context (position + z-index), so the
        // diamonds' own z-index (1/2) can't escape it on their own — the bump
        // has to happen here.
        zIndex: 5,
        pointerEvents: "none",
      }}
    >
      {sorted.map((kf, i) => {
        if (i === 0) return null;
        const prev = sorted[i - 1]!;
        const x1 = sortedCenterXs[i - 1]!;
        const x2 = sortedCenterXs[i]!;
        if (x2 - x1 < 1) return null;
        const connectorLeft = x1 + markerMetrics[i - 1]!.visualSize / 2;
        const connectorWidth =
          x2 - x1 - markerMetrics[i - 1]!.visualSize / 2 - markerMetrics[i]!.visualSize / 2;
        // Group-aware target for the ease button. On a merged inline row the
        // button edits the ease of every animation colliding at this percentage
        // at once (the collapsed row is the element's unified motion). It is only
        // hidden when the keyframe has no source animation id (runtime-scanned),
        // so there is no tween to target.
        const target = keyframeTarget(kf, true);
        const ease = kf.ease ?? globalEase;
        return (
          <Fragment key={`line-${i}-${prev.percentage}-${kf.percentage}`}>
            <div
              className="absolute"
              data-keyframe-connector={groupAware ? "" : undefined}
              style={{
                left: connectorLeft,
                top: centerY,
                width: Math.max(0, connectorWidth),
                height: 2,
                transform: "translateY(-1px)",
                background: baseColor,
                opacity: baseOpacity,
                borderRadius: 1,
              }}
            />
            {onSelectSegment && kf.animationId !== undefined && (
              <div
                className="group absolute"
                data-keyframe-ease-segment=""
                style={{
                  left: x1,
                  top: centerY,
                  width: x2 - x1,
                  height: 18,
                  transform: "translateY(-50%)",
                  // Own a stacking context above the diamond buttons. At fit
                  // zoom the 16px ease control can overlap its neighbouring
                  // diamond; without a z-index here the later diamond wins the
                  // hit test even though the child button has z-index 3.
                  zIndex: 3,
                  // Only the centered control is interactive. The transparent
                  // segment wrapper must not swallow connector/clip gestures.
                  pointerEvents: "none",
                }}
              >
                <button
                  type="button"
                  data-keyframe-ease-button=""
                  aria-label={`Edit ${ease} easing`}
                  title={`Edit ${ease} easing`}
                  className="absolute flex items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  style={{
                    left: "50%",
                    top: "50%",
                    width: 16,
                    height: 16,
                    transform: "translate(-50%, -50%)",
                    zIndex: 3,
                    pointerEvents: "auto",
                    padding: 0,
                    border: "1px solid rgba(255, 255, 255, 0.14)",
                    background: "#171717",
                    cursor: "pointer",
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectSegment(target);
                  }}
                >
                  <MiniCurveSvg ease={ease} active size={12} />
                </button>
              </div>
            )}
          </Fragment>
        );
      })}

      {sorted.map((kf, i) => {
        const target = keyframeTarget(kf, groupAware);
        const kfKey = timelineKeyframeSelectionKey(elementId, target);
        // While dragging this diamond, render it at the live preview clip-%.
        const renderPct = preview?.kfKey === kfKey ? preview.clipPct : kf.percentage;
        // Center the marker's non-overlapping hit region ON its keyframe %, so
        // the diamond's midpoint sits exactly on the playhead/ruler x for that time.
        // The 0% diamond's left half lands in the reserved left gutter (the
        // content origin is inset past the label column, Figma-style) so it stays
        // fully visible instead of being clipped by the sticky label column.
        const marker = markerMetrics[i]!;
        const leftPx = (renderPct / 100) * clipWidthPx - marker.hitWidth / 2;
        const isKfSelected = selectedKeyframes.has(kfKey);
        const atPlayhead = isSelected && Math.abs(kf.percentage - currentPercentage) < 0.5;
        const isHighlighted = isKfSelected || atPlayhead;
        const color = isHighlighted ? accentColor : "#a3a3a3";

        const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          if (canDrag) {
            retimeHandleRef.current = beginTimelineKeyframeRetime({
              event: e,
              elementId,
              keyframeKey: kfKey,
              target,
              keyframes: keyframesData.keyframes,
              clipWidthPx,
              draggedIndex: i,
              sortedClipPercentages: sortedClipPcts,
              onPreview: (clipPercentage) => {
                if (!mountedRef.current) return;
                setPreview(clipPercentage === null ? null : { kfKey, clipPct: clipPercentage });
              },
              onMove: (fromTarget, toClipPercentage) =>
                onMoveKeyframe?.(fromTarget, toClipPercentage) ?? Promise.resolve(false),
              onSelect: (nextTarget, additive) => {
                if (additive) onShiftClickKeyframe?.(nextTarget);
                else onClickKeyframe?.(nextTarget);
              },
              suppressNextClick,
            });
          }
        };
        const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
          // The stable viewport coordinator owns an armed retime. This local
          // path remains only for non-draggable diamonds.
          if (canDrag) {
            retimeHandleRef.current?.commit(e);
            retimeHandleRef.current = null;
            e.stopPropagation();
            return;
          }
          if (e.button !== 0) return;
          suppressNextClick();
          if (e.shiftKey) onShiftClickKeyframe?.(target);
          else onClickKeyframe?.(target);
        };

        return (
          <button
            key={`${i}-${kf.percentage}`}
            type="button"
            className="absolute"
            data-keyframe-group={groupAware ? kf.propertyGroup : undefined}
            data-keyframe-percentage={
              groupAware ? (kf.tweenPercentage ?? kf.percentage) : undefined
            }
            style={{
              left: leftPx,
              top: centerY,
              transform: "translateY(-50%)",
              width: marker.hitWidth,
              height: diamondSize,
              zIndex: isHighlighted ? 2 : 1,
              pointerEvents: "auto",
              background: "none",
              border: "none",
              cursor: canDrag ? "ew-resize" : "pointer",
              padding: 0,
              touchAction: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "visible",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={canDrag ? (e) => retimeHandleRef.current?.update(e) : undefined}
            onPointerUp={onPointerUp}
            onPointerCancel={
              canDrag
                ? (e) => {
                    retimeHandleRef.current?.cancel(e);
                    retimeHandleRef.current = null;
                  }
                : undefined
            }
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenuKeyframe?.(e, target);
            }}
            title={`${kf.percentage}%`}
          >
            <svg
              width={marker.visualSize}
              height={marker.visualSize}
              viewBox="0 0 10 10"
              style={{ flexShrink: 0, pointerEvents: "none" }}
            >
              {isKfSelected && (
                <path
                  d="M5 0L10 5L5 10L0 5Z"
                  fill="none"
                  stroke={accentColor}
                  strokeWidth="0.8"
                  opacity={0.5}
                />
              )}
              <path
                d="M5 1L9 5L5 9L1 5Z"
                fill={color}
                opacity={isKfSelected || atPlayhead ? 1 : 0.55}
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
});

export const TimelineClipDiamonds = memo(function TimelineClipDiamonds(
  props: TimelineClipDiamondsProps,
) {
  return (
    <TimelineDiamondLane
      {...props}
      globalEase={props.keyframesData.ease}
      onClickKeyframe={(target) => props.onClickKeyframe?.(target.percentage)}
      onShiftClickKeyframe={(target) =>
        props.onShiftClickKeyframe?.(props.elementId, target.percentage)
      }
      onContextMenuKeyframe={(e, target) =>
        props.onContextMenuKeyframe?.(e, props.elementId, target.percentage)
      }
      onMoveKeyframe={
        props.onMoveKeyframe
          ? (target, toClipPercentage) =>
              props.onMoveKeyframe?.(props.elementId, target.percentage, toClipPercentage) ??
              Promise.resolve(false)
          : undefined
      }
      onSelectSegment={
        props.onSelectSegment
          ? (target) => props.onSelectSegment?.(props.elementId, target)
          : undefined
      }
    />
  );
});

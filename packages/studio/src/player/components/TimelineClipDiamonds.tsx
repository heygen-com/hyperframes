import { Fragment, memo, useEffect, useRef, useState } from "react";
import { BEAT_BAND_H } from "./BeatStrip";
import {
  KEYFRAME_DRAG_THRESHOLD_PX,
  previewClipPct,
  resolveKeyframeDrag,
} from "../../components/editor/keyframeDrag";
import { MiniCurveSvg } from "../../components/editor/EaseCurveSection";
import { clipToTweenPercentage } from "../../components/editor/KeyframeNavigation";
import { LANE_H } from "./timelineLayout";
import {
  timelineKeyframeSelectionKey,
  type TimelineKeyframeTarget,
} from "./timelineKeyframeIdentity";

interface TimelineDiamondKeyframe {
  percentage: number;
  /** Tween-relative percentage (the retime mutation keys on this, not clip %). */
  tweenPercentage?: number;
  propertyGroup?: string;
  animationId?: string;
  properties: Record<string, number | string>;
  ease?: string;
  /** Set when 2+ source animations collide at this percentage (a single inline
   *  ease button can't target one): the collapsed row hides the button here. */
  easeAmbiguous?: boolean;
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
  ) => void;
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
  onMoveKeyframe?: (target: TimelineKeyframeTarget, toClipPercentage: number) => void;
}

const DIAMOND_RATIO = 0.8;
// Percentage tolerance for rendering keyframes near clip boundaries. Keyframes
// slightly outside [0, 100] (from rounding or stale cache during the async
// persist → reload cycle) are still rendered (the clip is overflow-visible) at
// their true position rather than hidden.
const KF_MIN_PCT = -5;
const KF_MAX_PCT = 105;

type DragState = {
  kfKey: string;
  startX: number;
  fromClipPct: number;
  moved: boolean;
};

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
  const dragRef = useRef<DragState | null>(null);
  // Pending retime destination (clip + tween %) per keyframe key, so a rapid
  // second drag composes from where the first move left the keyframe (whose
  // cache entry has not rebuilt yet) instead of the stale rendered value.
  const pendingRetimeRef = useRef(new Map<string, { clipPct: number; tweenPct: number }>());
  useEffect(() => {
    // Clear a pending entry once the authoritative cache reflects a keyframe at
    // ~its destination. Match by tolerance, not equality: cache writers round
    // clip %s, so an exact check would leak an entry after every successful retime.
    for (const [key, pending] of pendingRetimeRef.current) {
      if (keyframesData.keyframes.some((k) => Math.abs(k.percentage - pending.clipPct) < 0.2)) {
        pendingRetimeRef.current.delete(key);
      }
    }
  }, [keyframesData.keyframes]);
  // Visual-only preview of the dragged diamond's clip-% — no runtime/GSAP hold
  // (that optimistic hold was the #1763 flake). The atomic move-keyframe commit
  // on drop re-keys the diamond from source.
  const [preview, setPreview] = useState<{ kfKey: string; clipPct: number } | null>(null);
  // Index of the segment whose mid-point ease button is revealed on hover, like
  // Figma. Null = no segment hovered → no button shown (resting state is just
  // the connector line + diamonds).
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
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
  const half = diamondSize / 2;
  const centerY = beatsActive ? BEAT_BAND_H + (clipHeightPx - BEAT_BAND_H) / 2 : clipHeightPx / 2;
  const sorted = keyframesData.keyframes
    .filter((kf) => kf.percentage >= KF_MIN_PCT && kf.percentage <= KF_MAX_PCT)
    .sort((a, b) => a.percentage - b.percentage);
  // Clip-%s of the sorted keyframes — the neighbour clamp (preview + drop) needs
  // the whole row to bound the dragged diamond between its immediate siblings.
  const sortedClipPcts = sorted.map((k) => k.percentage);
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
        const x1 = Math.max(0, Math.min(clipWidthPx, (prev.percentage / 100) * clipWidthPx));
        const x2 = Math.max(0, Math.min(clipWidthPx, (kf.percentage / 100) * clipWidthPx));
        if (x2 - x1 < 1) return null;
        // Group-aware target for the ease button: the segment ease is
        // per-keyframe (each keyframe carries its own animationId/tweenPercentage).
        // On a merged inline row the button is hidden where the segment is
        // ambiguous (two source animations collide at this % with different
        // eases; see easeAmbiguous) or the keyframe has no source animation id
        // (runtime-scanned) so there is no tween to target.
        const target = keyframeTarget(kf, true);
        const ease = kf.ease ?? globalEase;
        return (
          <Fragment key={`line-${i}-${prev.percentage}-${kf.percentage}`}>
            <div
              className="absolute"
              data-keyframe-connector={groupAware ? "" : undefined}
              style={{
                left: x1,
                top: centerY,
                width: x2 - x1,
                height: 2,
                transform: "translateY(-1px)",
                background: baseColor,
                opacity: baseOpacity,
                borderRadius: 1,
              }}
            />
            {onSelectSegment && !kf.easeAmbiguous && kf.animationId !== undefined && (
              <div
                className="absolute"
                data-keyframe-ease-segment=""
                style={{
                  left: x1,
                  top: centerY,
                  width: x2 - x1,
                  height: 18,
                  transform: "translateY(-50%)",
                  pointerEvents: "auto",
                }}
                onMouseEnter={() => setHoveredSegment(i)}
                onMouseLeave={() => setHoveredSegment((h) => (h === i ? null : h))}
              >
                {hoveredSegment === i && (
                  <button
                    type="button"
                    data-keyframe-ease-button=""
                    aria-label={`Edit ${ease} easing`}
                    title={`Edit ${ease} easing`}
                    className="absolute flex items-center justify-center rounded"
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
                )}
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
        // Center the diamond ON its keyframe %: left = (% · width) − half, so the
        // diamond's midpoint sits exactly on the playhead/ruler x for that time.
        // The 0% diamond's left half lands in the reserved left gutter (the
        // content origin is inset past the label column, Figma-style) so it stays
        // fully visible instead of being clipped by the sticky label column.
        const leftPx = (renderPct / 100) * clipWidthPx - half;
        const isKfSelected = selectedKeyframes.has(kfKey);
        const atPlayhead = isSelected && Math.abs(kf.percentage - currentPercentage) < 0.5;
        const isHighlighted = isKfSelected || atPlayhead;
        const color = isHighlighted ? accentColor : "#a3a3a3";

        const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          if (canDrag) {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            dragRef.current = {
              kfKey,
              startX: e.clientX,
              fromClipPct: pendingRetimeRef.current.get(kfKey)?.clipPct ?? kf.percentage,
              moved: false,
            };
          }
        };
        const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
          const d = dragRef.current;
          if (!d || d.kfKey !== kfKey) return;
          if (!d.moved && Math.abs(e.clientX - d.startX) >= KEYFRAME_DRAG_THRESHOLD_PX) {
            d.moved = true;
          }
          if (d.moved) {
            setPreview({
              kfKey,
              clipPct: previewClipPct({
                pointerDownX: d.startX,
                pointerMoveX: e.clientX,
                clipWidthPx,
                draggedClipPct: d.fromClipPct,
                draggedIndex: i,
                sortedClipPcts,
              }),
            });
          }
        };
        const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
          const d = dragRef.current;
          // No drag armed (canDrag false / non-primary press) → treat as a click.
          if (!d || d.kfKey !== kfKey) {
            if (e.button !== 0) return;
            suppressNextClick();
            if (e.shiftKey) onShiftClickKeyframe?.(target);
            else onClickKeyframe?.(target);
            return;
          }
          e.stopPropagation();
          dragRef.current = null;
          setPreview(null);
          e.currentTarget.releasePointerCapture?.(e.pointerId);
          suppressNextClick();
          const res = resolveKeyframeDrag({
            pointerDownX: d.startX,
            pointerUpX: e.clientX,
            clipWidthPx,
            draggedClipPct: d.fromClipPct,
            draggedIndex: i,
            sortedClipPcts,
          });
          if (res.kind === "click" || res.kind === "noop") {
            // "noop" is a press with enough pointer jitter to arm a drag (canDrag
            // is on for every diamond once the clip is selected) that resolved
            // back onto ~the same position — no real retime, so treat it as the
            // click it was. Otherwise a normal click with a few px of mouse/
            // trackpad drift silently does nothing: no selection, no move.
            if (e.shiftKey) onShiftClickKeyframe?.(target);
            else onClickKeyframe?.(target);
          } else if (res.kind === "move" && res.toClipPct != null) {
            const animKfs =
              target.animationId === undefined
                ? keyframesData.keyframes
                : keyframesData.keyframes.filter((k) => k.animationId === target.animationId);
            // Clamp to the mapped tween range: clipToTweenPercentage extrapolates
            // linearly, so a boundary drag past the range would otherwise reselect
            // an out-of-range tween % (e.g. 150%) even though the mutation clamps
            // the moved endpoint back to the boundary.
            const tweenPcts = animKfs
              .map((k) => k.tweenPercentage)
              .filter((v): v is number => typeof v === "number");
            const clampTween = (v: number) =>
              tweenPcts.length
                ? Math.max(Math.min(...tweenPcts), Math.min(Math.max(...tweenPcts), v))
                : v;
            const newTweenPct = clampTween(clipToTweenPercentage(animKfs, res.toClipPct));
            // For a rapid second retime the diamond still renders the stale cache
            // position, so identify the FROM keyframe by the pending (already-moved)
            // position; the mutation locates the source keyframe by this identity.
            const pendingBefore = pendingRetimeRef.current.get(kfKey);
            const fromTarget = pendingBefore
              ? {
                  ...target,
                  percentage: pendingBefore.clipPct,
                  tweenPercentage: pendingBefore.tweenPct,
                }
              : target;
            pendingRetimeRef.current.set(kfKey, { clipPct: res.toClipPct, tweenPct: newTweenPct });
            onMoveKeyframe?.(fromTarget, res.toClipPct);
            // A retime still targeted this exact diamond — park/select it at its
            // new position, same as a plain click, or a drag that actually moved
            // something looks identical to one that silently did nothing.
            onClickKeyframe?.({
              ...target,
              percentage: res.toClipPct,
              tweenPercentage: newTweenPct,
            });
          }
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
              width: diamondSize,
              height: diamondSize,
              zIndex: isHighlighted ? 2 : 1,
              pointerEvents: "auto",
              background: "none",
              border: "none",
              cursor: canDrag ? "ew-resize" : "pointer",
              padding: 0,
              touchAction: "none",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={(e) => {
              // Browser/OS cancellation (or lost capture) ends the drag without a
              // pointerup, so clear the armed drag and preview or a ghost diamond
              // stays stuck at the last previewed position.
              if (dragRef.current?.kfKey !== kfKey) return;
              dragRef.current = null;
              setPreview(null);
              e.currentTarget.releasePointerCapture?.(e.pointerId);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenuKeyframe?.(e, target);
            }}
            title={`${kf.percentage}%`}
          >
            <svg width={diamondSize} height={diamondSize} viewBox="0 0 10 10">
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
              props.onMoveKeyframe?.(props.elementId, target.percentage, toClipPercentage)
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

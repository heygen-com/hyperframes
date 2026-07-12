import { memo, useRef, useState } from "react";
import { BEAT_BAND_H } from "./BeatStrip";
import {
  clampToNeighbors,
  KEYFRAME_DRAG_THRESHOLD_PX,
  previewClipPct,
  resolveKeyframeDrag,
} from "../../components/editor/keyframeDrag";
import { snapKeyframePctToBeat } from "./timelineEditing";

interface KeyframeEntry {
  percentage: number;
  /** Tween-relative percentage (the retime mutation keys on this, not clip %). */
  tweenPercentage?: number;
  properties: Record<string, number | string>;
  ease?: string;
}

interface KeyframeCacheEntry {
  format: string;
  keyframes: KeyframeEntry[];
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
  /** Composition-time beat positions (same source the beat strip renders from).
   *  When present and `beatsActive`, a dragged keyframe snaps to the nearest beat. */
  beatTimes?: number[];
  /** Clip start / duration (seconds) + pixels-per-second, needed to map a
   *  dragged keyframe's clip-% to composition time for beat snapping. */
  clipStart?: number;
  clipDurationSeconds?: number;
  pixelsPerSecond?: number;
  accentColor: string;
  isSelected: boolean;
  currentPercentage: number;
  elementId: string;
  selectedKeyframes: Set<string>;
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
  /** Set while resolving a diamond press so the ancestor clip's onClick (which
   *  toggles selection off when already selected) ignores the native "click"
   *  the browser auto-synthesizes after this button's pointerdown+pointerup. */
  suppressClickRef?: React.RefObject<boolean>;
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

export const TimelineClipDiamonds = memo(function TimelineClipDiamonds({
  keyframesData,
  clipWidthPx,
  clipHeightPx,
  beatsActive,
  beatTimes,
  clipStart = 0,
  clipDurationSeconds = 0,
  pixelsPerSecond = 1,
  accentColor,
  isSelected,
  currentPercentage,
  elementId,
  selectedKeyframes,
  onClickKeyframe,
  onShiftClickKeyframe,
  onContextMenuKeyframe,
  onMoveKeyframe,
  suppressClickRef,
}: TimelineClipDiamondsProps) {
  // Hooks must run before the early return below.
  const dragRef = useRef<DragState | null>(null);
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
  const diamondSize = Math.round(clipHeightPx * (beatsActive ? 0.45 : DIAMOND_RATIO));
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

  // Snap a dragged keyframe's clip-% to the nearest beat (within ~8px), then
  // re-clamp to neighbours so the snap can't cross a sibling keyframe. No-op
  // when the beat strip isn't active for this track or no beats are loaded.
  const snapClipPctToBeat = (clipPct: number, draggedIndex: number): number => {
    if (!beatsActive || !beatTimes || beatTimes.length === 0) return clipPct;
    const snapped = snapKeyframePctToBeat(
      { start: clipStart, duration: clipDurationSeconds },
      clipPct,
      beatTimes,
      pixelsPerSecond,
    );
    return clampToNeighbors(snapped, sortedClipPcts, draggedIndex);
  };

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
        return (
          <div
            key={`line-${i}-${prev.percentage}-${kf.percentage}`}
            className="absolute"
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
        );
      })}

      {sorted.map((kf, i) => {
        const kfKey = `${elementId}:${kf.percentage}`;
        // While dragging this diamond, render it at the live preview clip-%.
        const renderPct = preview?.kfKey === kfKey ? preview.clipPct : kf.percentage;
        // Center the diamond ON its keyframe %: left = (% · width) − half so the
        // diamond's midpoint sits exactly at the percentage. At 0% the midpoint
        // is the clip's left edge (the left half overflows, which the
        // overflow-visible clip shows) — NOT shifted fully inside.
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
              fromClipPct: kf.percentage,
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
              clipPct: snapClipPctToBeat(
                previewClipPct({
                  pointerDownX: d.startX,
                  pointerMoveX: e.clientX,
                  clipWidthPx,
                  draggedClipPct: d.fromClipPct,
                  draggedIndex: i,
                  sortedClipPcts,
                }),
                i,
              ),
            });
          }
        };
        const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
          const d = dragRef.current;
          // No drag armed (canDrag false / non-primary press) → treat as a click.
          if (!d || d.kfKey !== kfKey) {
            if (e.button !== 0) return;
            suppressNextClick();
            if (e.shiftKey) onShiftClickKeyframe?.(elementId, kf.percentage);
            else onClickKeyframe?.(kf.percentage);
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
            if (e.shiftKey) onShiftClickKeyframe?.(elementId, kf.percentage);
            else onClickKeyframe?.(kf.percentage);
          } else if (res.kind === "move" && res.toClipPct != null) {
            onMoveKeyframe?.(elementId, d.fromClipPct, snapClipPctToBeat(res.toClipPct, i));
            // A retime still targeted this exact diamond — park/select it at its
            // new position, same as a plain click, or a drag that actually moved
            // something looks identical to one that silently did nothing.
            onClickKeyframe?.(res.toClipPct);
          }
        };

        return (
          <button
            key={`${i}-${kf.percentage}`}
            type="button"
            className="absolute"
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
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenuKeyframe?.(e, elementId, kf.percentage);
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

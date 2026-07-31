/**
 * The diamond row's data + prop contract, split out of TimelineClipDiamonds so
 * that file stays under the 600-line studio gate. Types and the shared
 * keyframe-identity helper live here; the rendering lives there.
 */
import type { TimelineKeyframeTarget } from "./timelineKeyframeIdentity";
import type { AnimationKeyframeTarget } from "../../hooks/gsapTweenSynth";

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

export interface TimelineClipDiamondsProps {
  keyframesData: KeyframeCacheEntry;
  clipWidthPx: number;
  clipHeightPx: number;
  /** Needed to compare the playhead to keyframes in output-frame time. */
  clipDuration: number;
  /** Beat-dot strip is shown on this track → shrink diamonds + drop them into
   *  the bottom half so they clear the strip at the top. */
  beatsActive?: boolean;
  accentColor: string;
  isSelected: boolean;
  currentPercentage: number;
  elementId: string;
  selectedKeyframes: ReadonlySet<string>;
  onClickKeyframe?: (elementId: string, keyframe: TimelineKeyframeTarget) => void;
  onShiftClickKeyframe?: (elementId: string, keyframe: TimelineKeyframeTarget) => void;
  onContextMenuKeyframe?: (
    e: React.MouseEvent,
    elementId: string,
    keyframe: TimelineKeyframeTarget,
  ) => void;
  /** Drag-to-retime: move a keyframe to a new time, preserving its value + ease.
   *  `keyframe` identifies the dragged keyframe (clip-relative percentage plus
   *  whatever animation identity the row carries); `toClipPercentage` is the
   *  neighbour-clamped drop position, also clip-relative. The handler decides
   *  move (within the tween) vs resize (past its boundary). */
  onMoveKeyframe?: (
    elementId: string,
    keyframe: TimelineKeyframeTarget,
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

export interface TimelineDiamondLaneProps extends Omit<
  TimelineClipDiamondsProps,
  | "onClickKeyframe"
  | "onShiftClickKeyframe"
  | "onContextMenuKeyframe"
  | "onMoveKeyframe"
  | "onSelectSegment"
  | "clipDuration"
> {
  /** Isolated lanes may omit timing; without it no playhead diamond is marked. */
  clipDuration?: number;
  groupAware?: boolean;
  globalEase?: string;
  onSelectSegment?: (target: TimelineKeyframeTarget) => void;
  onClickKeyframe?: (target: TimelineKeyframeTarget) => void;
  onShiftClickKeyframe?: (target: TimelineKeyframeTarget) => void;
  onContextMenuKeyframe?: (e: React.MouseEvent, target: TimelineKeyframeTarget) => void;
  onMoveKeyframe?: (target: TimelineKeyframeTarget, toClipPercentage: number) => Promise<boolean>;
}

export const DIAMOND_RATIO = 0.8;
// Percentage tolerance for rendering keyframes near clip boundaries. Keyframes
// slightly outside [0, 100] (from rounding or stale cache during the async
// persist → reload cycle) are still rendered (the clip is overflow-visible) at
// their true position rather than hidden.
export const KF_MIN_PCT = -5;
export const KF_MAX_PCT = 105;

export type DragState = {
  kfKey: string;
  startX: number;
  fromClipPct: number;
  moved: boolean;
  /** Latest pointer x, flushed to the preview once per frame. */
  lastX: number;
  /** Index in the sorted row, needed by the neighbour clamp off the render path. */
  index: number;
  /** Escape was pressed: the drag is dead, and the pointerup that follows is
   *  swallowed rather than falling through to the click branch. */
  cancelled?: boolean;
};

/**
 * The full identity of a diamond, used by every callback and by the selection
 * key. Collapsed clip rows and expanded property lanes read the same cache, so
 * they must hash a shared keyframe to the same key: dropping the group here for
 * the collapsed row would leave a diamond selected in one view and unselected in
 * the other, and would strip the animation id the retime/delete mutations use to
 * pick between two animations that collide at one percentage.
 */
export function keyframeTarget(keyframe: TimelineDiamondKeyframe): TimelineKeyframeTarget {
  return {
    percentage: keyframe.percentage,
    tweenPercentage: keyframe.tweenPercentage,
    propertyGroup: keyframe.propertyGroup,
    animationId: keyframe.animationId,
    collidingAnimationTargets: keyframe.collidingAnimationTargets,
  };
}

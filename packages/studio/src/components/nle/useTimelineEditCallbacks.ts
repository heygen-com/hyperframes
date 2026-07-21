import { useCallback, useMemo } from "react";
import type { TimelineElement } from "../../player";
import { usePlayerStore } from "../../player/store/playerStore";
import type { BlockedTimelineEditIntent } from "../../player/components/timelineEditing";
import type { TimelineEditCallbacks } from "../../player/components/timelineCallbacks";
import { useStudioShellContext } from "../../contexts/StudioContext";
import {
  useDomEditActionsContext,
  useDomEditSelectionContext,
} from "../../contexts/DomEditContext";
import { resolveTweenStart, resolveTweenDuration } from "../../utils/globalTimeCompiler";
import { resolveClipTimingBasis } from "../../hooks/useGsapTweenCache";
import { resolveKeyframeRetime } from "../editor/keyframeRetime";
import type { TimelineMoveOperation } from "../../hooks/timelineMoveAdapter";

export interface TimelineEditCallbackDeps {
  handleTimelineElementMove: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  handleTimelineElementsMove: (
    edits: Array<{ element: TimelineElement; updates: Pick<TimelineElement, "start" | "track"> }>,
    coalesceKey?: string,
    operation?: TimelineMoveOperation,
    coalesceMs?: number,
  ) => Promise<void> | void;
  handleTimelineElementResize: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
  ) => Promise<void> | void;
  handleTimelineGroupResize: NonNullable<TimelineEditCallbacks["onResizeElements"]>;
  handleToggleTrackHidden: (track: number, hidden: boolean) => Promise<void> | void;
  handleBlockedTimelineEdit: (element: TimelineElement, intent: BlockedTimelineEditIntent) => void;
  handleTimelineElementSplit: (element: TimelineElement, splitTime: number) => Promise<void> | void;
  handleRazorSplit: (element: TimelineElement, splitTime: number) => Promise<void> | void;
  handleRazorSplitAll: (splitTime: number) => Promise<void> | void;
}

interface TimelineKeyframeTargetAnimation {
  id: string;
  propertyGroup?: string | null;
  keyframes?: unknown;
}

interface TimelineCachedKeyframe {
  percentage: number;
  tweenPercentage?: number;
  propertyGroup?: string;
}

/**
 * Resolve a rendered timeline diamond back to the animation that authored it.
 * Flat tweens use synthesized diamonds, so a mixed flat tween may have neither
 * a property group nor real keyframes. The cache currently carries a property
 * group, not an animation id, so resolution is safe only when that group has a
 * single candidate. Ambiguous candidates remain unresolved rather than
 * retiming an arbitrary tween.
 */
export function resolveTimelineKeyframeTarget(
  pct: number,
  keyframes: ReadonlyArray<TimelineCachedKeyframe>,
  animations: ReadonlyArray<TimelineKeyframeTargetAnimation>,
): { animId: string; tweenPct: number } | null {
  const kf = keyframes.find((item) => Math.abs(item.percentage - pct) < 0.2);
  if (!kf) return null;
  const group = kf?.propertyGroup;
  const candidates = group
    ? animations.filter((animation) => animation.propertyGroup === group)
    : animations.filter((animation) => !animation.propertyGroup);
  const animation = candidates.length === 1 ? candidates[0] : undefined;
  return animation ? { animId: animation.id, tweenPct: kf.tweenPercentage ?? pct } : null;
}

/**
 * Builds the timeline edit callback bag (move/resize/split/razor plus the
 * keyframe-diamond callbacks) provided to `<Timeline>` via TimelineEditProvider.
 * The keyframe callbacks resolve the dragged diamond back to its GSAP anim id +
 * tween-relative percentage, reading DOM-edit selection state from context.
 */
// fallow-ignore-next-line complexity
export function useTimelineEditCallbacks({
  handleTimelineElementMove,
  handleTimelineElementsMove,
  handleTimelineElementResize,
  handleTimelineGroupResize,
  handleToggleTrackHidden,
  handleBlockedTimelineEdit,
  handleTimelineElementSplit,
  handleRazorSplit,
  handleRazorSplitAll,
}: TimelineEditCallbackDeps): TimelineEditCallbacks {
  const { projectId, activeCompPath } = useStudioShellContext();
  const { domEditSelection, selectedGsapAnimations } = useDomEditSelectionContext();
  const {
    handleGsapRemoveKeyframe,
    handleGsapMoveKeyframeToPlayhead,
    handleGsapMoveKeyframe,
    handleGsapResizeKeyframedTween,
    handleGsapUpdateMeta,
    handleGsapAddKeyframe,
    handleGsapConvertToKeyframes,
    handleGsapRemoveAllKeyframes,
    buildDomSelectionForTimelineElement,
  } = useDomEditActionsContext();

  // Resolve a timeline-diamond callback's clip-% to the keyframe's anim id + its
  // tween-relative percentage (shared by the delete/move keyframe callbacks): the
  // diamond reports a clip-% but the script ops key on the tween-%. Prefers the
  // anim in the keyframe's property group, falling back to the first keyframed one.
  const resolveKeyframeTarget = useCallback(
    // fallow-ignore-next-line complexity
    (pct: number): { animId: string; tweenPct: number } | null => {
      const cached = usePlayerStore.getState().keyframeCache.get(domEditSelection?.id ?? "");
      return resolveTimelineKeyframeTarget(pct, cached?.keyframes ?? [], selectedGsapAnimations);
    },
    [domEditSelection?.id, selectedGsapAnimations],
  );

  return useMemo(
    () => ({
      onMoveElement: handleTimelineElementMove,
      onMoveElements: handleTimelineElementsMove,
      onResizeElement: handleTimelineElementResize,
      onResizeElements: handleTimelineGroupResize,
      onToggleTrackHidden: handleToggleTrackHidden,
      onBlockedEditAttempt: handleBlockedTimelineEdit,
      onSplitElement: handleTimelineElementSplit,
      onRazorSplit: handleRazorSplit,
      onRazorSplitAll: handleRazorSplitAll,
      onDeleteAllKeyframes: () => {
        // Hold the element where it is (collapse keyframes to a static set) rather
        // than deleting the whole animation — deleting strands a stale GSAP base
        // that the next drag adds to, flinging the element off-screen.
        const anim = selectedGsapAnimations.find((a) => a.keyframes);
        if (!anim) return;
        handleGsapRemoveAllKeyframes(anim.id);
      },
      onDeleteKeyframe: (_elId: string, pct: number) => {
        const target = resolveKeyframeTarget(pct);
        if (target) handleGsapRemoveKeyframe(target.animId, target.tweenPct);
      },
      // Retime the keyframe to the playhead, preserving its value + ease.
      onMoveKeyframeToPlayhead: (_elId: string, pct: number) => {
        const target = resolveKeyframeTarget(pct);
        if (target) handleGsapMoveKeyframeToPlayhead(target.animId, target.tweenPct);
      },
      // Drag-to-retime. The diamond reports clip-%s; resolveKeyframeTarget gives
      // the dragged keyframe's anim + tween-%. We convert the clip-% drop to an
      // absolute time (via the clip's timing basis) and let resolveKeyframeRetime
      // decide: a drop inside the tween window is a plain move (re-key tween-%); a
      // drop past the boundary (last keyframe past the end, first before the start)
      // resizes the tween — position/duration grow so the dragged keyframe lands at
      // the drop while every other keyframe keeps its absolute time (value+ease too).
      // fallow-ignore-next-line complexity
      onMoveKeyframe: (_elId: string, fromClipPct: number, toClipPct: number) => {
        const target = resolveKeyframeTarget(fromClipPct);
        const sel = domEditSelection;
        if (!target || !sel) return;
        const anim = selectedGsapAnimations.find((a) => a.id === target.animId);
        const tweenStart = anim ? resolveTweenStart(anim) : null;
        if (!anim || tweenStart === null) return;
        const tweenDuration = anim.duration ?? resolveTweenDuration(anim);
        const sourceFile = sel.sourceFile || activeCompPath || "index.html";
        const { elements, domClipChildren } = usePlayerStore.getState();
        const { elStart, elDuration } = resolveClipTimingBasis(
          sel.id ?? "",
          sourceFile,
          elements,
          domClipChildren,
        );
        const dropAbsTime = elStart + (toClipPct / 100) * elDuration;
        const decision = resolveKeyframeRetime({
          keyframes: anim.keyframes?.keyframes ?? [],
          draggedTweenPct: target.tweenPct,
          tweenStart,
          tweenDuration,
          dropAbsTime,
        });
        if (decision.kind === "move" && decision.toTweenPct != null) {
          handleGsapMoveKeyframe(target.animId, target.tweenPct, decision.toTweenPct);
        } else if (
          decision.kind === "resize" &&
          decision.pctRemap &&
          decision.position != null &&
          decision.duration != null
        ) {
          if (anim.keyframes) {
            handleGsapResizeKeyframedTween(
              target.animId,
              decision.position,
              decision.duration,
              decision.pctRemap,
            );
          } else {
            // resize-keyframed-tween requires an authored `keyframes` AST node
            // and intentionally no-ops for a flat tween. Update its real tween
            // window through the metadata writer (and SDK cutover path) instead.
            handleGsapUpdateMeta(target.animId, {
              position: decision.position,
              duration: decision.duration,
            });
          }
        }
      },
      onChangeKeyframeEase: (_elId: string, _pct: number, ease: string) => {
        for (const anim of selectedGsapAnimations) {
          if (anim.keyframes) handleGsapUpdateMeta(anim.id, { ease });
        }
      },
      // fallow-ignore-next-line complexity
      onToggleKeyframeAtPlayhead: (el: TimelineElement) => {
        const currentTime = usePlayerStore.getState().currentTime;
        const pct =
          el.duration > 0
            ? Math.max(0, Math.min(100, Math.round(((currentTime - el.start) / el.duration) * 100)))
            : 0;
        const anim = selectedGsapAnimations.find((a) => a.keyframes);
        if (anim?.keyframes) {
          const existing = anim.keyframes.keyframes.find((k) => Math.abs(k.percentage - pct) <= 1);
          if (existing) {
            handleGsapRemoveKeyframe(anim.id, existing.percentage);
          } else {
            handleGsapAddKeyframe(anim.id, pct, "x", 0);
          }
        } else {
          const flatAnim = selectedGsapAnimations.find((a) => !a.keyframes);
          if (flatAnim) handleGsapConvertToKeyframes(flatAnim.id);
        }
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      handleTimelineElementMove,
      handleTimelineElementsMove,
      handleTimelineElementResize,
      handleTimelineGroupResize,
      handleToggleTrackHidden,
      handleBlockedTimelineEdit,
      handleTimelineElementSplit,
      handleRazorSplit,
      handleRazorSplitAll,
      handleGsapRemoveAllKeyframes,
      resolveKeyframeTarget,
      selectedGsapAnimations,
      handleGsapRemoveKeyframe,
      handleGsapMoveKeyframeToPlayhead,
      handleGsapMoveKeyframe,
      handleGsapResizeKeyframedTween,
      handleGsapUpdateMeta,
      handleGsapAddKeyframe,
      handleGsapConvertToKeyframes,
      buildDomSelectionForTimelineElement,
      projectId,
      activeCompPath,
      domEditSelection,
    ],
  );
}

import { useCallback, useMemo } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
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
import type { DomEditSelection } from "../editor/domEditingTypes";
import type { TimelineMoveOperation } from "../../hooks/timelineMoveAdapter";
import { getTimelineElementIdentity } from "../../player/lib/timelineElementHelpers";

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
    handleGsapAddKeyframeBatch,
    handleGsapConvertToKeyframes,
    handleGsapRemoveAllKeyframes,
    handleGsapDeleteAnimation,
    buildDomSelectionForTimelineElement,
  } = useDomEditActionsContext();

  const resolveElementAnimations = useCallback(
    (elementKey: string): GsapAnimation[] => {
      const { gsapAnimations } = usePlayerStore.getState();
      const hashIndex = elementKey.lastIndexOf("#");
      const elementId = hashIndex === -1 ? elementKey : elementKey.slice(hashIndex + 1);
      const sourceFile =
        hashIndex === -1 ? (activeCompPath ?? "index.html") : elementKey.slice(0, hashIndex);
      return (
        gsapAnimations.get(`${sourceFile}#${elementId}`) ??
        gsapAnimations.get(`index.html#${elementId}`) ??
        gsapAnimations.get(elementId) ??
        []
      );
    },
    [activeCompPath],
  );

  // Resolve a timeline-diamond callback's clip-% to the keyframe's anim id + its
  // tween-relative percentage (shared by the delete/move keyframe callbacks): the
  // diamond reports a clip-% but the script ops key on the tween-%. Prefers the
  // anim in the keyframe's property group, falling back to the first keyframed one.
  const resolveKeyframeTarget = useCallback(
    // fallow-ignore-next-line complexity
    (
      elementKey: string,
      pct: number,
      propertyGroup?: string,
      tweenPercentage?: number,
      animationId?: string,
      animations: GsapAnimation[] = selectedGsapAnimations,
    ): { animId: string; tweenPct: number } | null => {
      const hashIndex = elementKey.lastIndexOf("#");
      const elementId = hashIndex === -1 ? elementKey : elementKey.slice(hashIndex + 1);
      const cached = propertyGroup
        ? undefined
        : (usePlayerStore.getState().keyframeCache.get(elementKey) ??
          usePlayerStore.getState().keyframeCache.get(elementId));
      const kf = cached?.keyframes.find((k) => Math.abs(k.percentage - pct) < 0.2);
      const group = propertyGroup ?? kf?.propertyGroup;
      const anim =
        (animationId ? animations.find((a) => a.id === animationId) : undefined) ??
        (group ? animations.find((a) => a.propertyGroup === group) : undefined) ??
        animations.find((a) => a.keyframes);
      return anim
        ? { animId: anim.id, tweenPct: tweenPercentage ?? kf?.tweenPercentage ?? pct }
        : null;
    },
    [selectedGsapAnimations],
  );

  const removeKeyframeTarget = useCallback(
    (
      animationId: string,
      percentage: number,
      animations: GsapAnimation[],
      selectionOverride?: DomEditSelection | null,
    ) => {
      const animation = animations.find((candidate) => candidate.id === animationId);
      if (animation && !animation.keyframes) {
        if (selectionOverride === undefined) handleGsapDeleteAnimation(animationId);
        else handleGsapDeleteAnimation(animationId, selectionOverride);
        return;
      }
      if (selectionOverride === undefined) handleGsapRemoveKeyframe(animationId, percentage);
      else handleGsapRemoveKeyframe(animationId, percentage, undefined, selectionOverride);
    },
    [handleGsapDeleteAnimation, handleGsapRemoveKeyframe],
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
      onDeleteAllKeyframes: (element) => {
        // Hold the element where it is (collapse keyframes to a static set) rather
        // than deleting the whole animation — deleting strands a stale GSAP base
        // that the next drag adds to, flinging the element off-screen.
        const elementKey = getTimelineElementIdentity(element);
        const anim = resolveElementAnimations(elementKey).find((animation) => animation.keyframes);
        if (!anim) return;
        void buildDomSelectionForTimelineElement(element).then((selection) => {
          if (selection) handleGsapRemoveAllKeyframes(anim.id, selection);
        });
      },
      onDeleteKeyframe: (elId, pct, group, tweenPct, animationId) => {
        const animations = resolveElementAnimations(elId);
        const target = resolveKeyframeTarget(elId, pct, group, tweenPct, animationId, animations);
        if (!target) return;
        const element = usePlayerStore.getState().elements.find((el) => (el.key ?? el.id) === elId);
        if (!element) {
          removeKeyframeTarget(target.animId, target.tweenPct, animations);
          return;
        }
        // Persist through the CLICKED element's own selection so a deletion on a
        // non-selected element (especially one in a different source file) commits
        // against the right element instead of the current domEditSelection.
        void buildDomSelectionForTimelineElement(element).then((selection) => {
          if (selection)
            removeKeyframeTarget(target.animId, target.tweenPct, animations, selection);
        });
      },
      // Retime the keyframe to the playhead, preserving its value + ease.
      onMoveKeyframeToPlayhead: (element, pct, group, tweenPct, animationId) => {
        const elementKey = getTimelineElementIdentity(element);
        const animations = resolveElementAnimations(elementKey);
        const target = resolveKeyframeTarget(
          elementKey,
          pct,
          group,
          tweenPct,
          animationId,
          animations,
        );
        const animation = target
          ? animations.find((candidate) => candidate.id === target.animId)
          : undefined;
        if (!target || !animation) return;
        void buildDomSelectionForTimelineElement(element).then((selection) => {
          if (selection) {
            handleGsapMoveKeyframeToPlayhead(target.animId, target.tweenPct, selection, animation);
          }
        });
      },
      // Drag-to-retime. The diamond reports clip-%s; resolveKeyframeTarget gives
      // the dragged keyframe's anim + tween-%. We convert the clip-% drop to an
      // absolute time (via the clip's timing basis) and let resolveKeyframeRetime
      // decide: a drop inside the tween window is a plain move (re-key tween-%); a
      // drop past the boundary (last keyframe past the end, first before the start)
      // resizes the tween — position/duration grow so the dragged keyframe lands at
      // the drop while every other keyframe keeps its absolute time (value+ease too).
      // fallow-ignore-next-line complexity
      onMoveKeyframe: (elId, fromClipPct, toClipPct, group, tweenPct, animationId) => {
        const target = resolveKeyframeTarget(elId, fromClipPct, group, tweenPct, animationId);
        const sel = domEditSelection;
        if (!target || !sel) return Promise.resolve(false);
        const anim = selectedGsapAnimations.find((a) => a.id === target.animId);
        const tweenStart = anim ? resolveTweenStart(anim) : null;
        if (!anim || tweenStart === null) return Promise.resolve(false);
        // Synthesized flat endpoints are clip boundaries, not authored keyframes.
        // Boundary-to-clip resize wiring is intentionally deferred; ignore the
        // drag rather than dispatching a free keyframe move that cannot be written.
        if (!anim.keyframes) return Promise.resolve(false);
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
          return handleGsapMoveKeyframe(target.animId, target.tweenPct, decision.toTweenPct);
        } else if (
          decision.kind === "resize" &&
          decision.pctRemap &&
          decision.position != null &&
          decision.duration != null
        ) {
          return handleGsapResizeKeyframedTween(
            target.animId,
            decision.position,
            decision.duration,
            decision.pctRemap,
          );
        }
        return Promise.resolve(false);
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
      onTogglePropertyGroupKeyframe: async (element, target) => {
        const selection = await buildDomSelectionForTimelineElement(element);
        if (!selection) return;
        if (target.remove) {
          removeKeyframeTarget(
            target.animationId,
            target.tweenPercentage,
            selectedGsapAnimations,
            selection,
          );
          return;
        }
        await handleGsapAddKeyframeBatch(
          target.animationId,
          target.tweenPercentage,
          target.properties,
          undefined,
          selection,
        );
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
      resolveElementAnimations,
      resolveKeyframeTarget,
      removeKeyframeTarget,
      selectedGsapAnimations,
      handleGsapMoveKeyframeToPlayhead,
      handleGsapMoveKeyframe,
      handleGsapResizeKeyframedTween,
      handleGsapUpdateMeta,
      handleGsapAddKeyframe,
      handleGsapAddKeyframeBatch,
      handleGsapConvertToKeyframes,
      buildDomSelectionForTimelineElement,
      projectId,
      activeCompPath,
      domEditSelection,
    ],
  );
}

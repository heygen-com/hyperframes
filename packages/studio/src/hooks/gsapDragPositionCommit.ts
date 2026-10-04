import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";
import { resolveTweenStart } from "../utils/globalTimeCompiler";
import { KEYFRAME_PCT_MATCH, resolveEditableTweenDuration } from "./gsapShared";
import { roundTo3 } from "../utils/rounding";
import { computeDraggedGsapPosition } from "./draggedGsapPosition";
import {
  type GsapDragCommitCallbacks,
  computeCurrentPercentage,
  parkPlayheadOnKeyframe,
} from "./gsapDragCommit";
import type { GsapEditOutcome } from "./gsapEditOutcome";
import { commitValueAtPlayhead, planValueEdit } from "./gsapValueAtPlayhead";

/**
 * The tween's keyframes with one inserted at `percentage`. Any existing keyframe
 * within {@link KEYFRAME_PCT_MATCH} of the insert is REPLACED, not kept: the
 * server takes a replace-with-keyframes list verbatim, so an append-only build
 * could hand it two keyframes a fraction of a percent apart. The invariant lives
 * here rather than in each caller's own pre-check, which is how the two callers
 * ended up with different tolerances in the first place.
 */
export function buildTemporalArcKeyframes(
  anim: GsapAnimation,
  percentage: number,
  properties: Record<string, number>,
) {
  return [
    ...(anim.keyframes?.keyframes ?? [])
      .filter((keyframe) => Math.abs(keyframe.percentage - percentage) > KEYFRAME_PCT_MATCH)
      .map((keyframe) => ({
        percentage: keyframe.percentage,
        properties: { ...keyframe.properties },
        ...(keyframe.ease ? { ease: keyframe.ease } : {}),
      })),
    { percentage, properties },
  ].sort((a, b) => a.percentage - b.percentage);
}

/** commitGsapPositionFromDrag's refusal, decided without writing. */
export function gsapPositionFromDragOutcome(
  selection: DomEditSelection,
  anim: GsapAnimation,
  studioOffset: { x: number; y: number },
  gsapPos: { x: number; y: number },
  iframe: HTMLIFrameElement | null,
): GsapEditOutcome {
  if (anim.arcPath?.enabled) return { status: "persisted" };
  const { newX, newY, baseGsapX, baseGsapY } = computeDraggedGsapPosition(
    selection.element,
    studioOffset,
    gsapPos,
  );
  const plan = planValueEdit(selection, anim, { x: newX, y: newY }, iframe, {
    backfill: { x: baseGsapX, y: baseGsapY },
  });
  return plan.ok
    ? { status: "persisted" }
    : { status: "blocked", reason: "keyframes-uneditable", detail: plan.reason };
}

// fallow-ignore-next-line code-duplication
// fallow-ignore-next-line complexity
export async function commitGsapPositionFromDrag(
  selection: DomEditSelection,
  anim: GsapAnimation,
  studioOffset: { x: number; y: number },
  gsapPos: { x: number; y: number },
  iframe: HTMLIFrameElement | null,
  callbacks: GsapDragCommitCallbacks,
): Promise<GsapEditOutcome> {
  const el = selection.element;
  // fallow-ignore-next-line code-duplication
  const { newX, newY, baseGsapX, baseGsapY } = computeDraggedGsapPosition(
    el,
    studioOffset,
    gsapPos,
  );
  const origX = Number.parseFloat(el.getAttribute("data-hf-drag-initial-offset-x") ?? "") || 0;
  const origY = Number.parseFloat(el.getAttribute("data-hf-drag-initial-offset-y") ?? "") || 0;
  const restoreOffset = () => {
    el.style.setProperty("--hf-studio-offset-x", `${origX}px`);
    el.style.setProperty("--hf-studio-offset-y", `${origY}px`);
    el.removeAttribute("data-hf-drag-initial-offset-x");
    el.removeAttribute("data-hf-drag-initial-offset-y");
  };

  if (anim.arcPath?.enabled) {
    const { activeKeyframePct, setActiveKeyframePct } = usePlayerStore.getState();
    const pct = activeKeyframePct ?? computeCurrentPercentage(selection, anim);
    const keyframes = anim.keyframes?.keyframes ?? [];
    // Same tolerance as applyArcKeyframeAtPlayhead and isMotionPathEndpoint. A
    // tighter one here meant a drag that landed a fraction of a percent off an
    // authored waypoint skipped the update-point branch and appended instead.
    const pointIndex = keyframes.findIndex(
      (kf) => Math.abs(kf.percentage - pct) <= KEYFRAME_PCT_MATCH,
    );
    if (pointIndex >= 0) {
      await callbacks.commitMutation(
        selection,
        {
          type: "update-motion-path-point",
          animationId: anim.id,
          pointIndex,
          x: newX,
          y: newY,
        },
        { label: "Move layer (waypoint)", softReload: true, beforeReload: restoreOffset },
      );
      setActiveKeyframePct(null);
      parkPlayheadOnKeyframe(anim, pct);
      return { status: "persisted" };
    }

    const tweenStart = resolveTweenStart(anim);
    // Clip-wide, same as applyArcKeyframeAtPlayhead: authoring GSAP's 0.5s
    // default here would collapse a duration-less arc's window on drag.
    const tweenDuration = resolveEditableTweenDuration(anim, selection);
    if (tweenStart === null || tweenDuration <= 0 || keyframes.length < 2)
      return { status: "persisted" };
    const temporalKeyframes = buildTemporalArcKeyframes(anim, pct, { x: newX, y: newY });
    await callbacks.commitMutation(
      selection,
      {
        type: "replace-with-keyframes",
        animationId: anim.id,
        targetSelector: anim.targetSelector,
        position: roundTo3(tweenStart),
        duration: roundTo3(tweenDuration),
        keyframes: temporalKeyframes,
        ease: "none",
      },
      {
        label: "Move layer (new keyframe)",
        keyframeAction: "add",
        softReload: true,
        beforeReload: restoreOffset,
      },
    );
    return { status: "persisted" };
  }
  return commitValueAtPlayhead(selection, anim, { x: newX, y: newY }, iframe, callbacks, {
    label: "Move layer",
    backfill: { x: baseGsapX, y: baseGsapY },
    beforeReload: restoreOffset,
  });
}

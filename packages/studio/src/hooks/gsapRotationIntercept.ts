import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";
import {
  commitStaticGsapRotation,
  computeCurrentPercentage,
  findRotationSetAnimation,
  materializeIfDynamic,
  type GsapDragCommitCallbacks,
} from "./gsapDragCommit";
import { readAllAnimatedProperties, readGsapProperty } from "./gsapRuntimeReaders";
import { resolveGroupTween } from "./gsapRuntimeGroupTween";
import { selectorFromSelection } from "./gsapShared";
import { commitWholePropertyOffset } from "./gsapWholePropertyOffsetCommit";

// fallow-ignore-next-line complexity
export async function tryGsapRotationIntercept(
  selection: DomEditSelection,
  angle: number,
  animations: GsapAnimation[],
  iframe: HTMLIFrameElement | null,
  commitMutation: GsapDragCommitCallbacks["commitMutation"],
  fetchFallbackAnimations?: () => Promise<GsapAnimation[]>,
): Promise<boolean> {
  const selector = selectorFromSelection(selection);
  if (!selector) return false;

  // Resolve the rotation-group tween, splitting legacy mixed tweens if needed.
  const resolved = await resolveGroupTween(
    "rotation",
    animations,
    selection,
    commitMutation,
    fetchFallbackAnimations,
  );
  const resolvedAnimations = resolved?.animations ?? animations;

  // Fallback: legacy heuristic for hand-written scripts
  let anim = resolved?.anim ?? null;
  if (!anim) {
    anim = animations.find((a) => "rotation" in a.properties || a.keyframes) ?? null;
    if (!anim && fetchFallbackAnimations) {
      const fresh = await fetchFallbackAnimations();
      anim = fresh.find((a) => "rotation" in a.properties || a.keyframes) ?? null;
    }
  }

  // `angle` is the ABSOLUTE target rotation resolved by the gesture or inspector.
  const newRotation = Math.round(angle);

  if (!anim) {
    const existingSet = findRotationSetAnimation(resolvedAnimations, selector);
    await commitStaticGsapRotation(selection, newRotation, selector, existingSet, {
      commitMutation,
      fetchAnimations: fetchFallbackAnimations,
    });
    return true;
  }

  const pct = computeCurrentPercentage(selection, anim);

  if (!usePlayerStore.getState().autoKeyframeEnabled) {
    await commitWholePropertyOffset(
      selection,
      anim,
      { rotation: newRotation },
      pct,
      iframe,
      { commitMutation, fetchAnimations: fetchFallbackAnimations },
      "Rotate animation",
    );
    return true;
  }

  // fallow-ignore-next-line code-duplication
  if (anim.hasUnresolvedKeyframes || anim.hasUnresolvedSelector) {
    const newId = await materializeIfDynamic(anim, iframe, commitMutation, selection);
    if (newId) anim = { ...anim, id: newId };
  } else if (!anim.keyframes) {
    const resolvedFromValues = selector
      ? readAllAnimatedProperties(iframe, selector, anim, "rotation")
      : undefined;
    await commitMutation(
      selection,
      { type: "convert-to-keyframes", animationId: anim.id, resolvedFromValues },
      { label: "Convert to keyframes for rotation", skipReload: true },
    );
  }

  const runtimeProps = readAllAnimatedProperties(iframe, selector, anim, "rotation");

  const backfillDefaults: Record<string, number> = { ...runtimeProps };
  if (!("rotation" in runtimeProps)) {
    backfillDefaults.rotation = readGsapProperty(iframe, selector, "rotation") ?? 0;
  }

  const properties = { ...runtimeProps, rotation: newRotation };

  await commitMutation(
    selection,
    {
      type: "add-keyframe",
      animationId: anim.id,
      percentage: pct,
      properties,
      backfillDefaults,
    },
    { label: `Rotate (keyframe ${pct}%)`, softReload: true },
  );
  return true;
}

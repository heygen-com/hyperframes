/**
 * Bridge between the Studio drag system and GSAP animations running in the
 * preview iframe.
 *
 * The preview iframe exposes `window.gsap` with a `getProperty(element, prop)`
 * method that returns the ACTUAL interpolated value at the current seek time.
 * This module reads those runtime values so that drag commits can write correct
 * absolute positions back into the GSAP script, regardless of tween type,
 * easing, or seek position.
 */
import type { GsapAnimation, PropertyGroupName } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";

import { readAllAnimatedProperties, readGsapProperty } from "./gsapRuntimeReaders";
import { commitGsapPositionFromDrag } from "./gsapDragPositionCommit";
import {
  commitStaticGsapPosition,
  commitStaticGsapRotation,
  commitWholePathOffset,
  computeCurrentPercentage,
  findExistingPositionWrite,
  findRotationSetAnimation,
  materializeIfDynamic,
} from "./gsapDragCommit";
import { commitWholePropertyOffset } from "./gsapWholePropertyOffsetCommit";
import { isGestureTransactionCommit } from "./gestureTransaction";
import { tweenReach, tweensForThisElement } from "./gsapTweenReach";
import { resolveTweenDuration } from "../utils/globalTimeCompiler";
import type { GsapDragCommitCallbacks } from "./gsapDragCommit";
import { isInstantHold, selectorFromSelection, writeTargetSelector } from "./gsapShared";
import {
  findGsapPositionAnimation,
  pickClosestToPlayhead,
  readGsapPositionFromIframe,
} from "./gsapPositionDetection";
import { hasNonHoldTweenForElement } from "./gsapRuntimeKeyframes";
import { getAnimationsForElement } from "./gsapElementMatch";
import {
  animationWritesAnyProperty,
  directEditOutcomeForProperties,
  type GsapEditOutcome,
} from "./gsapEditOutcome";

// Position channels — used to scope the "has a live position tween?" check so a
// sibling rotation/scale animation never forces a static position hold into the
// keyframe branch (which corrupts it into a frozen duration-0 keyframed tween).
export const POSITION_CHANNELS: string[] = [
  "x",
  "y",
  "xPercent",
  "yPercent",
  "left",
  "top",
  // GSAP normalizes translateX/Y to x/y at play time, but readTween reads the
  // AUTHORED shape — include them so a hand-authored translateX/Y position tween
  // still counts as a live position tween.
  "translateX",
  "translateY",
];
const POSITION_CHANNEL_SET = new Set<string>(POSITION_CHANNELS);

const ROTATION_CHANNELS: string[] = ["rotation", "rotationX", "rotationY", "rotationZ"];
const ROTATION_CHANNEL_SET = new Set<string>(ROTATION_CHANNELS);

// ── Property-group tween resolution ───────────────────────────────────────

/**
 * Find the tween for a given property group, splitting a legacy mixed tween
 * if necessary. Returns the resolved animation or null if none exists.
 *
 * Resolution order:
 * 1. Tween already tagged with `propertyGroup === group`
 * 2. Legacy mixed tween (`!propertyGroup`) → split via server mutation,
 *    re-fetch, then return the group tween
 * 3. null — caller must handle the missing-tween case
 */
export async function resolveGroupTween(
  group: PropertyGroupName,
  animations: GsapAnimation[],
  selection: DomEditSelection,
  commitMutation: GsapDragCommitCallbacks["commitMutation"],
  fetchFallbackAnimations?: () => Promise<GsapAnimation[]>,
): Promise<{ anim: GsapAnimation; animations: GsapAnimation[] } | null> {
  // 1. Already-split group tween — pick the one closest to the current
  // playhead so a drag at t=6s edits the tween at 4s, not the one at 1.5s.
  const groupAnims = animations.filter((a) => a.propertyGroup === group);
  const groupAnim = pickClosestToPlayhead(groupAnims);
  if (groupAnim) return { anim: groupAnim, animations };

  // 2. Legacy mixed tween — split it, then re-fetch
  const legacyMixed = animations.find((a) => !a.propertyGroup);
  if (legacyMixed) {
    await commitMutation(
      selection,
      { type: "split-into-property-groups", animationId: legacyMixed.id },
      { label: "Split mixed tween into property groups", skipReload: true },
    );
    if (fetchFallbackAnimations) {
      const fresh = await fetchFallbackAnimations();
      const freshGroupAnim = fresh.find((a) => a.propertyGroup === group);
      if (freshGroupAnim) return { anim: freshGroupAnim, animations: fresh };
    }
  }

  // 3. Try fallback fetch (no split needed, just wasn't in the initial list)
  if (!legacyMixed && fetchFallbackAnimations) {
    const fresh = await fetchFallbackAnimations();
    const freshGroupAnim = fresh.find((a) => a.propertyGroup === group);
    if (freshGroupAnim) return { anim: freshGroupAnim, animations: fresh };

    // Fallback: legacy mixed in the fresh list
    const freshLegacy = fresh.find((a) => !a.propertyGroup);
    if (freshLegacy) {
      await commitMutation(
        selection,
        { type: "split-into-property-groups", animationId: freshLegacy.id },
        { label: "Split mixed tween into property groups", skipReload: true },
      );
      const reFetched = await fetchFallbackAnimations();
      const reFetchedGroup = reFetched.find((a) => a.propertyGroup === group);
      if (reFetchedGroup) return { anim: reFetchedGroup, animations: reFetched };
    }
  }

  return null;
}

// ── High-level intercept ───────────────────────────────────────────────────

export type { GsapDragCommitCallbacks };

const writesPosition = (a: GsapAnimation) => animationWritesAnyProperty(a, POSITION_CHANNEL_SET);

/** Only a tween shared with siblings positions this element (a stagger on `.w`). */
function positionedOnlyBySharedTween(selection: DomEditSelection, animations: GsapAnimation[]) {
  const positioning = animations.filter(writesPosition);
  return (
    positioning.some((a) => tweenReach(a, selection.element) === "shared") &&
    tweensForThisElement(selection, positioning).length === 0
  );
}

// fallow-ignore-next-line complexity
async function preflightGsapDragIntercept(
  selection: DomEditSelection,
  animations: GsapAnimation[],
  iframe: HTMLIFrameElement | null,
  fetchFallbackAnimations?: () => Promise<GsapAnimation[]>,
  group?: boolean,
): Promise<GsapEditOutcome> {
  const fetchedAnimations = fetchFallbackAnimations ? await fetchFallbackAnimations() : [];
  return dragEditOutcome(selection, animations, iframe, fetchedAnimations, group);
}

/** The move commit's refusal rule, also run ahead of time to hide the move handles. */
// fallow-ignore-next-line complexity
export function dragEditOutcome(
  selection: DomEditSelection,
  animations: GsapAnimation[],
  iframe: HTMLIFrameElement | null,
  fetchedAnimations: GsapAnimation[] = [],
  group = false,
): GsapEditOutcome {
  const selector = selectorFromSelection(selection);
  if (!selector) return { status: "blocked", reason: "no-selector" };
  // The fallback API currently represents both a definitive empty parse and an
  // exhausted fetch failure as `[]`. Keep the selected cache in the preflight
  // set as well: ignoring it would let a transient fetch failure bypass helper /
  // runtime-source ownership and reach a destructive split or property write.
  const allKnownAnimations = [...animations, ...fetchedAnimations];
  const reaching = allKnownAnimations.filter(
    (a) => tweenReach(a, selection.element) !== "elsewhere",
  );
  const editability = directEditOutcomeForProperties(reaching, POSITION_CHANNEL_SET);
  if (editability.status === "blocked") return editability;
  if (positionedOnlyBySharedTween(selection, allKnownAnimations)) {
    return { status: "element-offset" };
  }
  const sourceAnimations = tweensForThisElement(
    selection,
    fetchedAnimations.length > 0 ? fetchedAnimations : animations,
  );
  // In a group only a tween naming this member by id or by its own selector counts,
  // so a class tween shared with id-selected members cannot take one member's write.
  const positionSources = group
    ? getAnimationsForElement(sourceAnimations, { id: selection.id ?? null, selector })
    : sourceAnimations;
  const posAnim = findGsapPositionAnimation(positionSources, selector);
  const hasLivePosition = hasNonHoldTweenForElement(iframe, selector, undefined, POSITION_CHANNELS);

  if (hasLivePosition && !posAnim) {
    // GSAP is visibly moving this element but the parser found no position
    // tween for it — a source-match gap, not necessarily computed source.
    return {
      status: "blocked",
      reason: "source-uneditable",
      detail: "live-position-no-source-tween",
    };
  }
  if (!posAnim && !writeTargetSelector(selection)) {
    return { status: "blocked", reason: "no-selector" };
  }
  return { status: "persisted" };
}

let dragGestureCounter = 0;

/** Every write one drag makes (a split, then the move) records as ONE undo step. A
 *  transaction or group commit already owns its key. */
function oneUndoStep(
  commit: GsapDragCommitCallbacks["commitMutation"],
): GsapDragCommitCallbacks["commitMutation"] {
  if (isGestureTransactionCommit(commit)) return commit;
  const coalesceKey = `gsap:drag:${++dragGestureCounter}`;
  return (selection, mutation, options) =>
    commit(selection, mutation, { ...options, coalesceKey, coalesceMs: Number.POSITIVE_INFINITY });
}

/** Commits a drag through the GSAP script. Callers reject `blocked` (the gesture layer
 *  restores its drafts) and save `element-offset` on the element itself. */
export async function tryGsapDragIntercept(
  selection: DomEditSelection,
  offset: { x: number; y: number },
  allAnimations: GsapAnimation[],
  iframe: HTMLIFrameElement | null,
  gestureCommit: GsapDragCommitCallbacks["commitMutation"],
  fetchAllAnimations?: () => Promise<GsapAnimation[]>,
  options?: {
    altKey?: boolean;
    preflightOnly?: boolean;
    preflightPassed?: boolean;
    group?: boolean;
  },
): Promise<GsapEditOutcome> {
  if (!options?.preflightPassed) {
    const preflight = await preflightGsapDragIntercept(
      selection,
      allAnimations,
      iframe,
      fetchAllAnimations,
      options?.group,
    );
    if (preflight.status !== "persisted" || options?.preflightOnly) return preflight;
  }
  const animations = tweensForThisElement(selection, allAnimations);
  const fetchFallbackAnimations =
    fetchAllAnimations && (async () => tweensForThisElement(selection, await fetchAllAnimations()));
  const selector = selectorFromSelection(selection);
  // The preflight above proves this; retain a defensive result for DOM churn.
  if (!selector) return { status: "blocked", reason: "no-selector" };
  const commitMutation = oneUndoStep(gestureCommit);

  // Self-heal: enforce a single position write BEFORE committing. A corrupted
  // file can carry 2+ conflicting position writes for one selector (e.g. a
  // degenerate `tl.to(...,{duration:0,x,y})` AND a `gsap.set(...,{x,y})`) — the
  // later one silently overrides the earlier, so the element "can't move". Keep
  // the live keyframed/real tween if present (else any), strip the rest, so the
  // commit below updates ONE write instead of fighting duplicates.
  let workingAnimations = animations;
  const isPosWrite = (a: GsapAnimation) =>
    a.targetSelector === selector && a.propertyGroup === "position";
  if (animations.filter(isPosWrite).length > 1 && fetchFallbackAnimations) {
    const fresh = await fetchFallbackAnimations();
    const dupes = fresh.filter(isPosWrite);
    if (dupes.length > 1) {
      const keeper =
        dupes.find((a) => a.keyframes) ?? dupes.find((a) => (a.duration ?? 0) > 0) ?? dupes[0]!;
      await commitMutation(
        selection,
        {
          type: "consolidate-position-writes",
          targetSelector: selector,
          keepAnimationId: keeper.id,
        },
        { label: "Consolidate position writes", skipReload: true },
      );
      workingAnimations = await fetchFallbackAnimations();
    } else {
      workingAnimations = fresh;
    }
  }

  const resolved = await resolveGroupTween(
    "position",
    workingAnimations,
    selection,
    commitMutation,
    fetchFallbackAnimations,
  );

  let posAnim = resolved?.anim ?? null;
  let resolvedAnimations = resolved?.animations ?? workingAnimations;
  if (!posAnim) {
    posAnim = findGsapPositionAnimation(workingAnimations, selector);
    if (!posAnim && fetchFallbackAnimations) {
      const fresh = await fetchFallbackAnimations();
      resolvedAnimations = fresh;
      posAnim = findGsapPositionAnimation(fresh, selector);
    }
  }

  const gsapPos = readGsapPositionFromIframe(iframe, selector) ?? { x: 0, y: 0 };

  // STATIC case (single source of truth = GSAP timeline): the element has no LIVE
  // keyframed/tweened position motion. Use the strict non-hold check — a leftover
  // position-hold `set` (after a delete-all, or a stale parse that lags it) must
  // NOT count as live motion. Either way the position belongs in a
  // `tl.set("#el",{x,y})`, not a keyframe conversion: re-nudge an existing set in
  // place (idempotent), else add a new one. This also covers the stale-cache
  // phantom — committing a set is correct because the element genuinely has no live motion.
  const hasNonHold = hasNonHoldTweenForElement(iframe, selector, undefined, POSITION_CHANNELS);
  // A KEYFRAMED position tween — even one that's currently a flat constant ("hold",
  // e.g. 0% and 100% identical) — is still an animation the user is building, so a
  // drag must add/update a keyframe, NOT fall back to a static `set`. Without this,
  // dragging an element whose position tween is constant writes a `gsap.set` that
  // fights the tween (the "drag didn't create a keyframe / didn't persist" bug). The
  // static path is only for elements with NO keyframed position tween (truly static,
  // or just a leftover position-hold `set`).
  // A zero-duration keyframed tween is a static HOLD, not a live animation —
  // treat it as static so the drag heals it instead of feeding it more keyframes.
  const hasKeyframedPosTween = !!posAnim?.keyframes && resolveTweenDuration(posAnim) > 0;
  if (!hasNonHold && !hasKeyframedPosTween) {
    const existingSet =
      posAnim && isInstantHold(posAnim) && posAnim.targetSelector === selector
        ? posAnim
        : findExistingPositionWrite(resolvedAnimations, selector, selection.element);
    await commitStaticGsapPosition(selection, offset, gsapPos, selector, existingSet, {
      commitMutation,
      fetchAnimations: fetchFallbackAnimations,
    });
    return { status: "persisted" };
  }

  if (!posAnim) {
    return { status: "blocked", reason: "source-uneditable", detail: "no-position-tween" };
  }

  // Verify the anim ID is still valid in the current file. The React-state
  // `animations` list can lag behind the file after a prior mutation changed
  // the tween's position/method (which changes the ID). Re-fetch to get the
  // current ID and avoid a stale-ID remove that creates duplicate tweens.
  if (fetchFallbackAnimations) {
    const fresh = await fetchFallbackAnimations();
    const freshMatch = fresh.find(
      (a) =>
        a.targetSelector === posAnim!.targetSelector && a.propertyGroup === posAnim!.propertyGroup,
    );
    if (freshMatch && freshMatch.id !== posAnim.id) {
      posAnim = freshMatch;
    }
  }

  const cbs = { commitMutation, fetchAnimations: fetchFallbackAnimations };
  // Alt-drag already means "shift the whole path" — the global auto-keyframe
  // toggle (#1808) just makes that the default while it's off, so a manual
  // edit on an already-animated element nudges the animation instead of
  // inserting/updating a keyframe at the playhead.
  const autoKeyframeEnabled = usePlayerStore.getState().autoKeyframeEnabled;
  if (options?.altKey || !autoKeyframeEnabled) {
    await commitWholePathOffset(selection, posAnim, offset, gsapPos, iframe, selector, cbs);
  } else {
    await commitGsapPositionFromDrag(selection, posAnim, offset, gsapPos, iframe, selector, cbs);
  }
  return { status: "persisted" };
}

// ── Runtime property readers (re-exported for external callers) ───────────

export { readGsapProperty, readAllAnimatedProperties };

// ── Identity-prop synthesis ───────────────────────────────────────────────

/** The rotation commit's refusal rule, also run ahead of time to hide the rotate handle. */
export function preflightGsapRotationIntercept(
  selection: DomEditSelection,
  animations: GsapAnimation[],
  iframe: HTMLIFrameElement | null,
  fetchedAnimations: GsapAnimation[] = [],
): GsapEditOutcome {
  const liveSelector = selectorFromSelection(selection);
  if (!(liveSelector ?? writeTargetSelector(selection))) {
    return { status: "blocked", reason: "no-selector" };
  }
  const editability = directEditOutcomeForProperties(
    [...animations, ...fetchedAnimations],
    ROTATION_CHANNEL_SET,
  );
  if (editability.status === "blocked") return editability;
  const workingAnimations = animations.length > 0 ? animations : fetchedAnimations;
  const hasSourceTween = workingAnimations.some((a) =>
    animationWritesAnyProperty(a, ROTATION_CHANNEL_SET),
  );
  if (
    !hasSourceTween &&
    liveSelector &&
    hasNonHoldTweenForElement(iframe, liveSelector, undefined, ROTATION_CHANNELS)
  ) {
    // Rotation twin of the position case above: live tween, no source match.
    return {
      status: "blocked",
      reason: "source-uneditable",
      detail: "live-rotation-no-source-tween",
    };
  }
  return { status: "persisted" };
}

export async function tryGsapRotationIntercept(
  selection: DomEditSelection,
  angle: number,
  animations: GsapAnimation[],
  iframe: HTMLIFrameElement | null,
  commitMutation: GsapDragCommitCallbacks["commitMutation"],
  fetchFallbackAnimations?: () => Promise<GsapAnimation[]>,
): Promise<GsapEditOutcome> {
  const fetchedAnimations = fetchFallbackAnimations ? await fetchFallbackAnimations() : [];
  const outcome = preflightGsapRotationIntercept(selection, animations, iframe, fetchedAnimations);
  if (outcome.status === "blocked") return outcome;
  const selector = (selectorFromSelection(selection) ?? writeTargetSelector(selection))!;
  const workingAnimations = animations.length > 0 ? animations : fetchedAnimations;
  const postSplitFetch = workingAnimations.some((animation) => !animation.propertyGroup)
    ? fetchFallbackAnimations
    : undefined;

  // Resolve the rotation-group tween, splitting legacy mixed tweens if needed.
  const resolved = await resolveGroupTween(
    "rotation",
    workingAnimations,
    selection,
    commitMutation,
    postSplitFetch,
  );
  const resolvedAnimations = resolved?.animations ?? workingAnimations;

  // Fallback: legacy heuristic for hand-written scripts
  let anim =
    resolved?.anim && animationWritesAnyProperty(resolved.anim, ROTATION_CHANNEL_SET)
      ? resolved.anim
      : null;
  if (!anim) {
    anim =
      workingAnimations.find((a) => animationWritesAnyProperty(a, ROTATION_CHANNEL_SET)) ?? null;
  }

  // `angle` is the ABSOLUTE target rotation resolved by the gesture (gsap base +
  // pointer sweep) or the inspector — so it IS the new rotation. No base re-add: the
  // gesture's live preview already gsap.set this value (single source of truth).
  const newRotation = Math.round(angle);
  // STATIC case (single source of truth = GSAP timeline): no rotation tween, so the
  // angle belongs in a `tl.set("#el",{rotation})`, not a keyframe conversion —
  // mirroring the static position set. Idempotent: re-rotate updates an existing
  // rotation set in place, else add a new one. This replaces the old
  // `--hf-studio-rotation` CSS-var fallback (the same dual-channel bug class).
  if (!anim || isInstantHold(anim)) {
    const existingSet =
      anim ?? findRotationSetAnimation(resolvedAnimations, selector, selection.element);
    await commitStaticGsapRotation(selection, newRotation, selector, existingSet, {
      commitMutation,
      fetchAnimations: fetchFallbackAnimations,
    });
    return { status: "persisted" };
  }

  const pct = computeCurrentPercentage(selection, anim);

  // With auto-keyframe off (#1808), a rotation tween already exists for this
  // element (checked above) so nudge it as a whole rather than adding a
  // keyframe at the playhead.
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
    return { status: "persisted" };
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
  return { status: "persisted" };
}

export { readRuntimeKeyframes, scanAllRuntimeKeyframes } from "./gsapRuntimeKeyframes";

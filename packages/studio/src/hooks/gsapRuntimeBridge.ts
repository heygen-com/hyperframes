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
  commitStaticGsapSize,
  commitKeyframedSizeFromResize,
  commitWholePathOffset,
  computeCurrentPercentage,
  findPositionSetAnimation,
  findRotationSetAnimation,
  findSizeSetAnimation,
  materializeIfDynamic,
} from "./gsapDragCommit";
import { resolveTweenStart, resolveTweenDuration } from "../utils/globalTimeCompiler";
import type { GsapDragCommitCallbacks } from "./gsapDragCommit";
import { getIframeGsap, queryIframeElement, selectorFromSelection } from "./gsapShared";
import { hasNonHoldTweenForElement } from "./gsapRuntimeKeyframes";
import { roundTo3 } from "../utils/rounding";

// ── Runtime reads ──────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
function readGsapPositionFromIframe(
  iframe: HTMLIFrameElement | null,
  elementSelector: string,
): { x: number; y: number } | null {
  const gsap = getIframeGsap(iframe);
  if (!gsap) return null;

  const element = queryIframeElement(iframe, elementSelector);
  if (!element) return null;

  const x = Number(gsap.getProperty(element, "x")) || 0;
  const y = Number(gsap.getProperty(element, "y")) || 0;
  return { x, y };
}

// ── Animation matching ─────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
function animHasPosition(anim: GsapAnimation): boolean {
  if (anim.keyframes?.keyframes.some((kf) => "x" in kf.properties || "y" in kf.properties))
    return true;
  if (anim.method === "fromTo") {
    const from = anim.fromProperties;
    return (
      "x" in anim.properties || "y" in anim.properties || !!(from && ("x" in from || "y" in from))
    );
  }
  return "x" in anim.properties || "y" in anim.properties;
}

function findGsapPositionAnimation(
  animations: GsapAnimation[],
  selector?: string,
): GsapAnimation | null {
  if (animations.length === 0) return null;
  const currentTime = usePlayerStore.getState().currentTime;

  const scored = animations
    .filter((a) => animHasPosition(a) || a.keyframes || animations.length === 1)
    .map((a) => {
      let score = 0;
      if (animHasPosition(a)) score += 10;
      if (a.keyframes) score += 5;
      if (selector && a.targetSelector === selector) score += 8;
      else if (a.targetSelector.includes(",")) score -= 5;
      const pos = a.resolvedStart ?? (typeof a.position === "number" ? a.position : 0);
      const dur = a.duration ?? 0;
      if (currentTime >= pos - 0.05 && currentTime <= pos + dur + 0.05) score += 50;
      else
        score -= Math.round(
          Math.min(Math.abs(currentTime - pos), Math.abs(currentTime - pos - dur)) * 5,
        );
      return { anim: a, score };
    });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.anim ?? animations[0];
}

// ── Selector resolution ────────────────────────────────────────────────────

// ── Property-group tween resolution ───────────────────────────────────────

/**
 * From a set of candidate tweens, pick the one whose time range is closest to
 * the current playhead. A tween that *contains* the playhead wins outright;
 * otherwise the nearest endpoint wins. This ensures a drag at t=6s edits (or
 * extends) the 4s tween, not the 1.5s one. Tie-break: most keyframes (so a
 * gesture-recorded tween beats a stub when both are equidistant).
 */
function pickClosestToPlayhead(anims: GsapAnimation[]): GsapAnimation | null {
  if (anims.length <= 1) return anims[0] ?? null;
  const ct = usePlayerStore.getState().currentTime;
  return anims.reduce((best, a) => {
    const s = resolveTweenStart(a) ?? 0;
    const e = s + resolveTweenDuration(a);
    const dist = ct >= s && ct <= e ? 0 : Math.min(Math.abs(ct - s), Math.abs(ct - e));
    const bestS = resolveTweenStart(best) ?? 0;
    const bestE = bestS + resolveTweenDuration(best);
    const bestDist =
      ct >= bestS && ct <= bestE ? 0 : Math.min(Math.abs(ct - bestS), Math.abs(ct - bestE));
    if (dist < bestDist) return a;
    if (
      dist === bestDist &&
      (a.keyframes?.keyframes.length ?? 0) > (best.keyframes?.keyframes.length ?? 0)
    )
      return a;
    return best;
  });
}

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
async function resolveGroupTween(
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

/**
 * Attempt to handle a drag commit via the GSAP script mutation path.
 *
 * Returns a Promise that resolves to true if the drag was handled via GSAP
 * (caller should skip the CSS path), or false if no GSAP position animation
 * exists.
 */
// fallow-ignore-next-line complexity
export async function tryGsapDragIntercept(
  selection: DomEditSelection,
  offset: { x: number; y: number },
  animations: GsapAnimation[],
  iframe: HTMLIFrameElement | null,
  commitMutation: GsapDragCommitCallbacks["commitMutation"],
  fetchFallbackAnimations?: () => Promise<GsapAnimation[]>,
  options?: { altKey?: boolean },
): Promise<boolean> {
  const selector = selectorFromSelection(selection);
  if (!selector) {
    return false;
  }

  const resolved = await resolveGroupTween(
    "position",
    animations,
    selection,
    commitMutation,
    fetchFallbackAnimations,
  );

  let posAnim = resolved?.anim ?? null;
  let resolvedAnimations = resolved?.animations ?? animations;
  if (!posAnim) {
    posAnim = findGsapPositionAnimation(animations, selector);
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
  const hasNonHold = hasNonHoldTweenForElement(iframe, selector);
  // A KEYFRAMED position tween — even one that's currently a flat constant ("hold",
  // e.g. 0% and 100% identical) — is still an animation the user is building, so a
  // drag must add/update a keyframe, NOT fall back to a static `set`. Without this,
  // dragging an element whose position tween is constant writes a `gsap.set` that
  // fights the tween (the "drag didn't create a keyframe / didn't persist" bug). The
  // static path is only for elements with NO keyframed position tween (truly static,
  // or just a leftover position-hold `set`).
  const hasKeyframedPosTween = !!posAnim?.keyframes;
  if (!hasNonHold && !hasKeyframedPosTween) {
    const existingSet =
      posAnim && posAnim.method === "set" && posAnim.targetSelector === selector
        ? posAnim
        : findPositionSetAnimation(resolvedAnimations, selector);
    await commitStaticGsapPosition(selection, offset, gsapPos, selector, existingSet, {
      commitMutation,
      fetchAnimations: fetchFallbackAnimations,
    });
    return true;
  }

  if (!posAnim) {
    return false;
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
  if (options?.altKey) {
    await commitWholePathOffset(selection, posAnim, offset, gsapPos, iframe, selector, cbs);
  } else {
    await commitGsapPositionFromDrag(selection, posAnim, offset, gsapPos, iframe, selector, cbs);
  }
  return true;
}

// ── Runtime property readers (re-exported for external callers) ───────────

export { readGsapProperty, readAllAnimatedProperties };

// ── Identity-prop synthesis ───────────────────────────────────────────────

const IDENTITY_ONE_PROPS = new Set(["opacity", "autoAlpha", "scale", "scaleX", "scaleY"]);

/** Build identity (zero / one) values for each property in `source`. */
function synthesizeIdentityProps(
  source: Record<string, number | string>,
): Record<string, number | string> {
  const id: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (typeof v === "number") id[k] = IDENTITY_ONE_PROPS.has(k) ? 1 : 0;
    else id[k] = v;
  }
  return id;
}

// ── Resize intercept ──────────────────────────────────────────────────────

export async function tryGsapResizeIntercept(
  selection: DomEditSelection,
  size: { width: number; height: number },
  animations: GsapAnimation[],
  iframe: HTMLIFrameElement | null,
  commitMutation: GsapDragCommitCallbacks["commitMutation"],
  fetchFallbackAnimations?: () => Promise<GsapAnimation[]>,
): Promise<boolean> {
  // If the element already has a scale-group tween, resize should modify scale
  // (the user is resizing something whose visual size is driven by scale).
  // Otherwise, use the size group (width/height).
  const hasScaleGroup = animations.some((a) => a.propertyGroup === "scale");
  const resizeGroup: PropertyGroupName = hasScaleGroup ? "scale" : "size";
  const resolved = await resolveGroupTween(
    resizeGroup,
    animations,
    selection,
    commitMutation,
    fetchFallbackAnimations,
  );

  let anim = resolved?.anim ?? null;
  if (!anim || anim.method === "set") {
    const sel = selectorFromSelection(selection);
    if (!sel) return false;
    const sizeSet = anim?.method === "set" ? anim : findSizeSetAnimation(animations, sel);

    // If the element is animated (has a real tween, not just a static size
    // hold), keyframe the size at the playhead so other keyframes keep theirs —
    // instead of a global set that resizes every frame.
    if (resizeGroup === "size") {
      const animatedTween = pickClosestToPlayhead(
        animations.filter((a) => a.method !== "set" && resolveTweenDuration(a) > 0),
      );
      if (animatedTween) {
        const handled = await commitKeyframedSizeFromResize(
          selection,
          size,
          sel,
          sizeSet,
          animatedTween,
          { commitMutation, fetchAnimations: fetchFallbackAnimations },
        );
        if (handled) return true;
      }
    }

    await commitStaticGsapSize(selection, size, sel, sizeSet, {
      commitMutation,
      fetchAnimations: fetchFallbackAnimations,
    });
    return true;
  }

  const { activeKeyframePct, setActiveKeyframePct } = usePlayerStore.getState();
  const pct = activeKeyframePct ?? computeCurrentPercentage(selection, anim);
  if (activeKeyframePct != null) setActiveKeyframePct(null);
  const coalesceKey = `gsap:resize:${anim.id}`;

  const selector = selectorFromSelection(selection);
  const runtimeProps = selector ? readAllAnimatedProperties(iframe, selector, anim) : {};

  let resizeProps: Record<string, number>;
  if (resizeGroup === "scale") {
    const el = iframe?.contentDocument?.querySelector(selector ?? "") as HTMLElement | null;
    // The resize draft modifies el.style.width, so read the ORIGINAL width
    // saved by the draft system before it ran.
    const origW = Number.parseFloat(el?.getAttribute("data-hf-studio-original-width") ?? "");
    const cssW = Number.isFinite(origW) && origW > 0 ? origW : 200;
    const newScale = roundTo3(size.width / cssW);
    resizeProps = { scale: newScale };
  } else {
    resizeProps = {
      width: Math.round(size.width),
      height: Math.round(size.height),
    };
  }
  const ct = usePlayerStore.getState().currentTime;
  const ts = resolveTweenStart(anim);
  const td = resolveTweenDuration(anim);
  const outsideRange = ts !== null && td > 0 && (ct < ts - 0.01 || ct > ts + td + 0.01); // Convert flat tweens to keyframes only for in-range resizes.
  // Outside-range uses the extend path which handles everything atomically.
  if (!outsideRange) {
    if (anim.hasUnresolvedKeyframes || anim.hasUnresolvedSelector) {
      const newId = await materializeIfDynamic(anim, iframe, commitMutation, selection);
      if (newId) anim = { ...anim, id: newId };
    } else if (!anim.keyframes) {
      const resolvedFromValues = selector
        ? readAllAnimatedProperties(iframe, selector, anim)
        : undefined;
      await commitMutation(
        selection,
        { type: "convert-to-keyframes", animationId: anim.id, resolvedFromValues },
        { label: "Convert to keyframes for resize", skipReload: true, coalesceKey },
      );
      if (fetchFallbackAnimations) {
        const fresh = await fetchFallbackAnimations();
        const refreshed = fresh.find(
          (a) => a.targetSelector === anim!.targetSelector && a.keyframes,
        );
        if (refreshed) anim = refreshed;
      }
    }
  }

  if (outsideRange && ts !== null) {
    // For flat tweens, synthesize the keyframes from the tween's properties
    const kfs =
      anim.keyframes?.keyframes ??
      (() => {
        const fromProps =
          anim.method === "from" || anim.method === "fromTo"
            ? { ...anim.properties }
            : synthesizeIdentityProps(anim.properties);
        const toProps =
          anim.method === "from"
            ? synthesizeIdentityProps(anim.properties)
            : { ...anim.properties };
        return [
          { percentage: 0, properties: fromProps },
          { percentage: 100, properties: toProps },
        ];
      })();
    const newStart = Math.min(ct, ts);
    const newEnd = Math.max(ct, ts + td);
    const newDuration = Math.max(0.01, newEnd - newStart);
    const existingKfs = kfs;
    const remapped: Array<{ percentage: number; properties: Record<string, number | string> }> = [];
    for (const kf of existingKfs) {
      const absTime = ts + (kf.percentage / 100) * td;
      const newPct = Math.round(((absTime - newStart) / newDuration) * 1000) / 10;
      const props = { ...kf.properties };
      // Only backfill properties that the animation already had (x, y, scale).
      // Don't backfill width/height — they should only appear on the resize keyframe.
      for (const k of Object.keys(resizeProps)) {
        if (k in props) continue;
        if (k === "width" || k === "height") continue;
        props[k] = IDENTITY_ONE_PROPS.has(k) ? 1 : 0;
      }
      remapped.push({ percentage: newPct, properties: props });
    }
    const targetPct = Math.round(((ct - newStart) / newDuration) * 1000) / 10;
    remapped.push({ percentage: targetPct, properties: resizeProps });
    remapped.sort((a, b) => a.percentage - b.percentage);

    await commitMutation(
      selection,
      {
        type: "replace-with-keyframes",
        animationId: anim.id,
        targetSelector: anim.targetSelector,
        position: roundTo3(newStart),
        duration: roundTo3(newDuration),
        keyframes: remapped,
      },
      { label: `Resize (extended to ${ct.toFixed(2)}s)`, softReload: true, coalesceKey },
    );
    return true;
  }

  const SIZE_PROPS = new Set(["width", "height"]);
  const backfillDefaults: Record<string, number> = {};
  for (const k of Object.keys(runtimeProps)) {
    if (SIZE_PROPS.has(k)) continue;
    backfillDefaults[k] = IDENTITY_ONE_PROPS.has(k) ? 1 : 0;
  }

  await commitMutation(
    selection,
    {
      type: "add-keyframe",
      animationId: anim.id,
      percentage: pct,
      properties: resizeProps,
      backfillDefaults,
    },
    { label: `Resize (keyframe ${pct}%)`, softReload: true, coalesceKey },
  );
  return true;
}

// ── Rotation intercept ────────────────────────────────────────────────────

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

  // `angle` is the ABSOLUTE target rotation resolved by the gesture (gsap base +
  // pointer sweep) or the inspector — so it IS the new rotation. No base re-add: the
  // gesture's live preview already gsap.set this value (single source of truth).
  const newRotation = Math.round(angle);

  // STATIC case (single source of truth = GSAP timeline): no rotation tween, so the
  // angle belongs in a `tl.set("#el",{rotation})`, not a keyframe conversion —
  // mirroring the static position set. Idempotent: re-rotate updates an existing
  // rotation set in place, else add a new one. This replaces the old
  // `--hf-studio-rotation` CSS-var fallback (the same dual-channel bug class).
  if (!anim) {
    const existingSet = findRotationSetAnimation(resolvedAnimations, selector);
    await commitStaticGsapRotation(selection, newRotation, selector, existingSet, {
      commitMutation,
      fetchAnimations: fetchFallbackAnimations,
    });
    return true;
  }

  const pct = computeCurrentPercentage(selection, anim);

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

export { readRuntimeKeyframes, scanAllRuntimeKeyframes } from "./gsapRuntimeKeyframes";

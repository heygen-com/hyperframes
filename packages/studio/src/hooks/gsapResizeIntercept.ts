/**
 * Resize-gesture GSAP intercept: routes a manual resize on a scale-driven
 * element into scale commits (per-axis longhands for non-uniform drags, with
 * keyframe normalization), then settles position synchronously so the drop
 * frame can't jump. Split from gsapRuntimeBridge, which owns the shared
 * group-tween resolution used by the drag/resize/rotate intercepts.
 */
import type { GsapAnimation, PropertyGroupName } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { clearStudioBoxSize } from "../components/editor/manualEdits";
import {
  STUDIO_ORIGINAL_BOX_HEIGHT_ATTR,
  STUDIO_ORIGINAL_BOX_WIDTH_ATTR,
} from "../components/editor/manualEditsTypes";
import { setElementGsapPosition, setElementGsapScale } from "../utils/elementGsap";
import { usePlayerStore } from "../player/store/playerStore";
import { hasNonHoldTweenForElement } from "./gsapRuntimeKeyframes";
import { readAllAnimatedProperties, readGsapProperty } from "./gsapRuntimeReaders";
import {
  commitStaticGsapPosition,
  commitStaticGsapSize,
  commitKeyframedSizeFromResize,
  computeCurrentPercentage,
  findExistingPositionWrite,
  findSizeSetAnimation,
  materializeIfDynamic,
} from "./gsapDragCommit";
import type { GsapDragCommitCallbacks } from "./gsapDragCommit";
import { computeDraggedGsapPosition } from "./draggedGsapPosition";
import { pickClosestToPlayhead, readGsapPositionFromIframe } from "./gsapPositionDetection";
import { commitWholePropertyOffset } from "./gsapWholePropertyOffsetCommit";
import { commitGsapPositionFromDrag } from "./gsapDragPositionCommit";
import { resolveTweenStart, resolveTweenDuration } from "../utils/globalTimeCompiler";
import { isInstantHold, selectorFromSelection, writeTargetSelector } from "./gsapShared";
import { roundTo3 } from "../utils/rounding";
import { resolveGroupTween } from "./gsapRuntimeBridge";
import { logResize } from "../utils/resizeDebug";
import {
  animationWritesAnyProperty,
  directEditOutcomeForProperties,
  type GsapEditOutcome,
} from "./gsapEditOutcome";

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

/**
 * The element's box before the resize draft ran, in CSS pixels.
 *
 * Prefers the measurement the draft recorded. Falls back to the inline style it
 * saved for restoring, which is a real value for the elements that carry one,
 * and null when neither says anything.
 */
function originalBoxSize(
  el: HTMLElement | null,
  measuredAttr: string,
  inlineProperty: "width" | "height",
): number | null {
  const measured = Number.parseFloat(el?.getAttribute(measuredAttr) ?? "");
  if (Number.isFinite(measured) && measured > 0) return measured;
  const inline = Number.parseFloat(
    el?.getAttribute(`data-hf-studio-original-${inlineProperty}`) ?? "",
  );
  return Number.isFinite(inline) && inline > 0 ? inline : null;
}

/**
 * Whether this tween already states scale as `scaleX`/`scaleY`.
 *
 * Both forms are legal, and either alone is fine. A tween holding both is not:
 * GSAP animates each property name independently, so the longhands run
 * alongside the shorthand and win, which silently discards whatever the
 * shorthand was set to.
 */
function tweenUsesScaleLonghands(anim: GsapAnimation | null): boolean {
  const isLonghand = (name: string) => name === "scaleX" || name === "scaleY";
  const inKeyframes = (anim?.keyframes?.keyframes ?? []).some((frame) =>
    Object.keys(frame.properties ?? {}).some(isLonghand),
  );
  return inKeyframes || Object.keys(anim?.properties ?? {}).some(isLonghand);
}

// ── Resize intercept ──────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
export async function tryGsapResizeIntercept(
  selection: DomEditSelection,
  size: { width: number; height: number },
  animations: GsapAnimation[],
  iframe: HTMLIFrameElement | null,
  commitMutation: GsapDragCommitCallbacks["commitMutation"],
  fetchFallbackAnimations?: () => Promise<GsapAnimation[]>,
): Promise<GsapEditOutcome> {
  const fetchedAnimations = fetchFallbackAnimations ? await fetchFallbackAnimations() : [];
  const allKnownAnimations = [...animations, ...fetchedAnimations];
  // If the element already has a scale-group tween, resize should modify scale
  // (the user is resizing something whose visual size is driven by scale).
  // Otherwise, use the size group (width/height).
  const hasScaleGroup = allKnownAnimations.some((a) => a.propertyGroup === "scale");
  const resizeGroup: PropertyGroupName = hasScaleGroup ? "scale" : "size";
  const resizeProperties =
    resizeGroup === "scale" ? new Set(["scale", "scaleX", "scaleY"]) : new Set(["width", "height"]);
  const editability = directEditOutcomeForProperties(allKnownAnimations, resizeProperties);
  if (editability.status === "blocked") return editability;
  const workingAnimations = animations.length > 0 ? animations : fetchedAnimations;
  // The initial ownership fetch already supplied the complete parse. Only retain
  // the fetch callback when a legacy mixed tween may be split and must then be
  // re-read; otherwise resolveGroupTween would perform the same network read twice.
  const postSplitFetch = workingAnimations.some((animation) => !animation.propertyGroup)
    ? fetchFallbackAnimations
    : undefined;
  const resolved = await resolveGroupTween(
    resizeGroup,
    workingAnimations,
    selection,
    commitMutation,
    postSplitFetch,
  );

  let anim =
    resolved?.anim && animationWritesAnyProperty(resolved.anim, resizeProperties)
      ? resolved.anim
      : null;
  const liveSelector = selectorFromSelection(selection);
  const hasLiveResizeTween = liveSelector
    ? hasNonHoldTweenForElement(iframe, liveSelector, undefined, [...resizeProperties])
    : false;
  if (!anim && hasLiveResizeTween) {
    return { status: "blocked", reason: "source-uneditable" };
  }
  logResize("intercept-enter", {
    hasScaleGroup,
    resizeGroup,
    animMethod: anim?.method ?? null,
    animId: anim?.id ?? null,
    size,
  });
  if (!anim || isInstantHold(anim)) {
    const sel = selectorFromSelection(selection) ?? writeTargetSelector(selection);
    if (!sel) return { status: "blocked", reason: "no-selector" };
    // A scale hold is not a size hold.
    //
    // `anim` is the tween resolved for THIS resize's group, and for a
    // scale-driven element that is the one carrying `scale`. Handing it to the
    // size commit wrote `width` and `height` into it, leaving one tween that
    // spans two property groups — which the parser then classifies as neither,
    // so it loses its group suffix and its id along with it. Every later edit
    // of that element looked for a scale tween and a size tween, found no
    // group at all, and the element became uneditable: "animation not found".
    // Size goes to a size hold of its own, and the scale hold is left alone.
    const sizeSet =
      resizeGroup === "size"
        ? (anim ?? findSizeSetAnimation(workingAnimations, sel, selection.element))
        : findSizeSetAnimation(workingAnimations, sel, selection.element);

    // If the element is animated (has a real tween, not just a static size
    // hold), keyframe the size at the playhead so other keyframes keep theirs —
    // instead of a global set that resizes every frame.
    if (resizeGroup === "size") {
      const animatedTween = pickClosestToPlayhead(
        workingAnimations.filter((a) => !isInstantHold(a) && resolveTweenDuration(a) > 0),
      );
      if (animatedTween) {
        logResize("intercept-route", { route: "keyframed-size", tweenId: animatedTween.id });
        const handled = await commitKeyframedSizeFromResize(
          selection,
          size,
          sel,
          sizeSet,
          animatedTween,
          { commitMutation, fetchAnimations: fetchFallbackAnimations },
        );
        if (handled) return { status: "persisted" };
      }
    }

    logResize("intercept-route", { route: "static-size-set", hadSizeSet: !!sizeSet, resizeGroup });
    await commitStaticGsapSize(selection, size, sel, sizeSet, {
      commitMutation,
      fetchAnimations: fetchFallbackAnimations,
    });
    return { status: "persisted" };
  }

  const tweenDuration = resolveTweenDuration(anim);
  if (tweenDuration <= 0) return { status: "blocked", reason: "source-uneditable" };

  const { activeKeyframePct, setActiveKeyframePct } = usePlayerStore.getState();
  const pct = activeKeyframePct ?? computeCurrentPercentage(selection, anim);
  if (activeKeyframePct != null) setActiveKeyframePct(null);
  const selector = selectorFromSelection(selection);
  // Scope every capture to the resize group — same contract as the rotation
  // intercept. Unfiltered, an opacity-touching intro tween on the element
  // would ride into resize conversions/backfills (the Fix-2 bake class).
  const runtimeProps = selector
    ? readAllAnimatedProperties(iframe, selector, anim, resizeGroup)
    : {};

  let resizeProps: Record<string, number>;
  let scaleDraftEl: HTMLElement | null = null;
  let scaleDraftDropPoint: { x: number; y: number } | null = null;
  /** The scale this commit is putting on the element, for the finalize step. */
  let committedScale: { x: number; y: number } | null = null;
  let nonUniformScale = false;
  /** Whether this commit writes scaleX/scaleY rather than the `scale` shorthand. */
  let useScaleLonghands = false;
  if (resizeGroup === "scale") {
    // Iframe-realm element — instanceof HTMLElement fails across realms; the
    // selector targets composition elements, and every use below is duck-typed.
    const el = iframe?.contentDocument?.querySelector(selector ?? "") as HTMLElement | null;
    // The resize draft modifies el.style.width/height, so read the ORIGINAL
    // dimensions saved by the draft system before it ran.
    //
    // The measured box first, then the inline one. The inline attributes exist
    // to restore an inline style and are empty for anything sized by a
    // stylesheet, which is how compositions are written, so reading them alone
    // sent almost every element to the fallback below: a 630px chip scaled by
    // 630/200, landing over three times the size it was dropped at, and worse
    // on the next drag because the wrong scale then counted as its live one.
    const cssW = originalBoxSize(el, STUDIO_ORIGINAL_BOX_WIDTH_ATTR, "width") ?? 200;
    const cssH = originalBoxSize(el, STUDIO_ORIGINAL_BOX_HEIGHT_ATTR, "height") ?? cssW;
    // `size` is the draft's CSS box; on screen it is multiplied by the element's
    // LIVE scale (the draft divides the cursor delta by it — see
    // resolveDomEditResizeGesture). The committed keyframe REPLACES that live
    // scale, so it must reproduce the rendered intent: css × live / original.
    // Live scale is 1 on a fresh element (first resize), so this is a no-op there.
    const rawLiveScaleX = readGsapProperty(iframe, selector ?? null, "scaleX") ?? 1;
    const rawLiveScaleY = readGsapProperty(iframe, selector ?? null, "scaleY") ?? 1;
    const liveScaleX = rawLiveScaleX > 0 ? rawLiveScaleX : 1;
    const liveScaleY = rawLiveScaleY > 0 ? rawLiveScaleY : 1;
    const newScaleX = roundTo3((size.width * liveScaleX) / cssW);
    const newScaleY = roundTo3((size.height * liveScaleY) / cssH);
    // A free-form corner drag is usually NON-uniform. A single `scale` value
    // can't represent it — committing width-derived scale used to snap the
    // height at drop. Commit scaleX/scaleY longhands instead; keep the uniform
    // shorthand when the two agree (aspect-true drags, shift-drags).
    //
    // Unless the tween already speaks longhands, in which case a uniform drag
    // has to as well. GSAP animates each property name on its own, so a
    // keyframe holding `{ scaleX: 1, scaleY: 1, scale: 0.61 }` runs all three
    // and the longhands win: the resize commits correctly and then does
    // nothing, and the element snaps back to its old size on release. The
    // tween never mixes the two forms in either direction.
    //
    // "Agree" is measured in PIXELS, not in scale. A fixed 0.01 of scale is
    // invisible on a 40px box and two pixels of height on a 408px one, so a
    // free drag whose axes happened to land within it silently gave back a box
    // shorter than the one dropped. The question is only ever whether using one
    // value for both axes would move an edge, so ask that.
    const uniformDrift = Math.abs(newScaleX - newScaleY) * cssH;
    nonUniformScale = uniformDrift > 0.5;
    useScaleLonghands = nonUniformScale || tweenUsesScaleLonghands(anim);
    resizeProps = useScaleLonghands
      ? { scaleX: newScaleX, scaleY: newScaleY }
      : { scale: newScaleX };
    logResize("intercept-route", {
      route: "scale-tween",
      cssW,
      cssH,
      liveScaleX,
      liveScaleY,
      newScaleX,
      newScaleY,
      nonUniformScale,
    });
    scaleDraftEl = el;
    // What the commit ACTUALLY writes, which is what the finalize step below
    // has to measure against. A near-uniform drag collapses to the shorthand,
    // so taking the per-axis pair here measured the element at a scaleY the
    // file never gets and tilted the correction by the difference.
    committedScale = useScaleLonghands
      ? { x: newScaleX, y: newScaleY }
      : { x: newScaleX, y: newScaleX };
    // Where the user DROPPED the box: the draft (anchor-pinned to the
    // gesture-start top-left) is still applied here, so this rect is exactly
    // what the preview showed at release. The committed scale renders around
    // the element CENTER instead — the finalize step below measures that
    // difference and compensates, so release matches the drop pixel-for-pixel
    // regardless of live scale or repeat resizes.
    if (el) {
      const dropRect = el.getBoundingClientRect();
      scaleDraftDropPoint = { x: dropRect.x, y: dropRect.y };
    }
  } else {
    resizeProps = {
      width: Math.round(size.width),
      height: Math.round(size.height),
    };
  }
  // Finalize a scale-route commit: tear down the gesture's inline width/height
  // draft (leaving it applied compounds with the committed scale — the element
  // jumps past the dragged size), then MEASURE where the committed scale
  // actually rendered the box and shift the position hold by the residual so
  // it lands back on the drop point. The compensation only applies to a STATIC
  // position (a `tl.set` hold or none) — a keyframed position path has no
  // single anchor to preserve, so it keeps the plain center-scale behavior.
  // The size route commits the same width/height channels the draft wrote, so
  // it needs none of this.
  // ponytail: for a 3D-rotated element the rects are AABBs, so the anchor is
  // approximate rather than corner-exact.
  // fallow-ignore-next-line complexity
  const finalizeScaleResizeCommit = async (): Promise<boolean> => {
    // Only the scale route captures the element, so a null draft means this
    // resize took the size route and never moved anything: the drop point is
    // the drag's to settle, not ours.
    if (!scaleDraftEl) return false;
    clearStudioBoxSize(scaleDraftEl);
    if (!scaleDraftDropPoint || !selector) return false;
    // Put the committed scale on the live element before measuring.
    //
    // This step reads where the commit lands the box and shifts the position
    // hold by the difference. That only works if the commit has actually
    // rendered, and whether it had was luck: on the FIRST resize of an element
    // the timeline had not re-seeked yet, so this measured the element at its
    // natural size, still sitting on the drop point, computed a residual of
    // zero, and skipped the correction entirely. The scale then landed, GSAP
    // rendered it around the element's centre, and the element jumped by the
    // whole drag distance. Elements that had been resized before got a
    // correction only because their PREVIOUS scale made the residual non-zero.
    //
    // Setting it here costs nothing when the commit has already rendered (same
    // value) and makes the measurement below mean what it says either way.
    if (committedScale) {
      setElementGsapScale(scaleDraftEl, committedScale.x, committedScale.y);
    }
    // Measure from the pre-gesture position, not the draft one.
    //
    // The resize draft translates the element to keep the dragged corner under
    // the cursor, but the scale route never persists that translation — the
    // element renders back at its pre-gesture position as soon as the commit
    // lands. Measuring while the draft translation was still applied made the
    // residual carry the whole drag distance, and the position commit then
    // composed that residual onto the pre-gesture base (it reads the gesture's
    // own base attributes, not the live value), so the element landed a full
    // drag away from the drop point on every scale resize.
    const gsapPos = readGsapPositionFromIframe(iframe, selector) ?? { x: 0, y: 0 };
    const { baseGsapX, baseGsapY } = computeDraggedGsapPosition(
      selection.element,
      { x: 0, y: 0 },
      gsapPos,
    );
    const base = { x: baseGsapX, y: baseGsapY };
    setElementGsapPosition(scaleDraftEl, base.x, base.y);
    const post = scaleDraftEl.getBoundingClientRect();
    const residual = { x: scaleDraftDropPoint.x - post.x, y: scaleDraftDropPoint.y - post.y };
    if (!Number.isFinite(residual.x) || !Number.isFinite(residual.y)) return false;
    if (Math.abs(residual.x) < 0.5 && Math.abs(residual.y) < 0.5) {
      logResize("scale-finalize", { skipped: "already-on-drop-point", residual, base });
      // Settled, with nothing to write. Still ours: forwarding the drag offset
      // on top would move the box off the point it is already sitting on.
      return true;
    }
    // The ONE corrected position — rounded once so the live runtime and the
    // persisted file agree exactly (commitStaticGsapPosition composes the same
    // rounded value from this delta).
    const corrected = {
      x: Math.round(base.x + residual.x),
      y: Math.round(base.y + residual.y),
    };
    logResize("scale-finalize", {
      dropPoint: scaleDraftDropPoint,
      post: { x: post.x, y: post.y },
      residual,
      gsapPos,
      base,
      corrected,
    });
    // Correct the LIVE runtime NOW, synchronously: the soft reload above just
    // rendered the committed scale around the element center — NOT at the drop
    // point — and everything up to here runs in the same microtask chain as
    // that reload, so no frame has painted the uncorrected position yet. The
    // server persist below costs network round-trips; without this set, the
    // element visibly sits at the wrong spot for those frames (the drop
    // "jump"). The persisted commit re-applies the same values (idempotent).
    setElementGsapPosition(scaleDraftEl, corrected.x, corrected.y);
    // Re-fetch: the scale commit above just rewrote the script, so the caller's
    // animation list (and its ids) may be stale for the position lookup.
    const currentAnimations = fetchFallbackAnimations
      ? await fetchFallbackAnimations()
      : (resolved?.animations ?? animations);
    // Delta chosen so the drag-path math composes back to exactly `corrected`
    // — it adds this onto the same base the measurement above used.
    const delta = { x: corrected.x - base.x, y: corrected.y - base.y };
    // An element whose position is animated needs the correction written into
    // that animation, at the playhead, or the tween renders its own value a
    // frame later and the element leaves the drop point anyway. This used to
    // stand down here instead, on the grounds that a keyframed path has no
    // single anchor to preserve. It has one: the frame the user is looking at.
    // Writing it is the same thing a drag on the same element does, through
    // the same commit.
    const positionTween = pickClosestToPlayhead(
      currentAnimations.filter(
        (a) => a.propertyGroup === "position" && !isInstantHold(a) && resolveTweenDuration(a) > 0,
      ),
    );
    if (positionTween) {
      logResize("scale-finalize", { route: "position-keyframe", tweenId: positionTween.id });
      await commitGsapPositionFromDrag(selection, positionTween, delta, base, iframe, selector, {
        commitMutation,
        fetchAnimations: fetchFallbackAnimations,
      });
      return true;
    }
    const existingSet = findExistingPositionWrite(currentAnimations, selector, selection.element);
    await commitStaticGsapPosition(selection, delta, base, selector, existingSet, {
      commitMutation,
      fetchAnimations: fetchFallbackAnimations,
    });
    return true;
  };

  // With auto-keyframe off (#1808), `anim` is already a real (non-"set")
  // tween for this resize group, so nudge it as a whole rather than adding a
  // keyframe at the playhead.
  if (!usePlayerStore.getState().autoKeyframeEnabled) {
    if (activeKeyframePct != null) setActiveKeyframePct(null);
    await commitWholePropertyOffset(
      selection,
      anim,
      resizeProps,
      pct,
      iframe,
      { commitMutation, fetchAnimations: fetchFallbackAnimations },
      "Resize animation",
    );
    return { status: "persisted", ownsDragOffset: await finalizeScaleResizeCommit() };
  }

  const ct = usePlayerStore.getState().currentTime;
  const ts = resolveTweenStart(anim);
  const td = tweenDuration;
  const outsideRange = ts !== null && td > 0 && (ct < ts - 0.01 || ct > ts + td + 0.01); // Convert flat tweens to keyframes only for in-range resizes.
  // Outside-range uses the extend path which handles everything atomically.
  if (!outsideRange) {
    // fallow-ignore-next-line code-duplication
    if (anim.hasUnresolvedKeyframes || anim.hasUnresolvedSelector) {
      const newId = await materializeIfDynamic(anim, iframe, commitMutation, selection);
      if (newId) anim = { ...anim, id: newId };
    } else if (!anim.keyframes) {
      const resolvedFromValues = selector
        ? readAllAnimatedProperties(iframe, selector, anim, resizeGroup)
        : undefined;
      await commitMutation(
        selection,
        { type: "convert-to-keyframes", animationId: anim.id, resolvedFromValues },
        { label: "Convert to keyframes for resize" },
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

  // A NON-uniform scale must also take the full-rewrite path: it mixes
  // scaleX/scaleY into a tween whose existing keyframes may carry the uniform
  // `scale` shorthand, and GSAP's percentage keyframes animate each property
  // name independently — a shorthand/longhand mix would leave the old `scale`
  // sub-tween running against the new scaleX/scaleY. The rewrite below
  // normalizes every keyframe to the longhands. For an in-range resize the
  // min/max window math below degenerates to the tween's own start/duration,
  // so timing is unchanged.
  if ((outsideRange || useScaleLonghands) && ts !== null) {
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
      // Normalize the uniform `scale` shorthand to longhands when this commit
      // writes scaleX/scaleY, so the tween never mixes the two forms.
      if (nonUniformScale && "scale" in props) {
        const uniform = props.scale;
        if (typeof uniform === "number") {
          props.scaleX = uniform;
          props.scaleY = uniform;
        }
        delete props.scale;
      }
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
    // An in-range rewrite can land on an existing keyframe's percentage —
    // merge into it instead of emitting a duplicate step.
    const collidingKf = remapped.find((kf) => Math.abs(kf.percentage - targetPct) < 0.05);
    if (collidingKf) Object.assign(collidingKf.properties, resizeProps);
    else remapped.push({ percentage: targetPct, properties: resizeProps });
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
      {
        label: outsideRange
          ? `Resize (extended to ${ct.toFixed(2)}s)`
          : `Resize (keyframe ${Math.round(((ct - newStart) / newDuration) * 1000) / 10}%)`,
        softReload: true,
      },
    );
    return { status: "persisted", ownsDragOffset: await finalizeScaleResizeCommit() };
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
    { label: `Resize (keyframe ${pct}%)`, softReload: true },
  );
  return { status: "persisted", ownsDragOffset: await finalizeScaleResizeCommit() };
}

// ── Rotation intercept ────────────────────────────────────────────────────

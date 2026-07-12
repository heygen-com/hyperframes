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
import { setElementGsapPosition } from "../utils/elementGsap";
import { usePlayerStore } from "../player/store/playerStore";
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
import { pickClosestToPlayhead, readGsapPositionFromIframe } from "./gsapPositionDetection";
import { commitWholePropertyOffset } from "./gsapWholePropertyOffsetCommit";
import { resolveTweenStart, resolveTweenDuration } from "../utils/globalTimeCompiler";
import { selectorFromSelection } from "./gsapShared";
import { roundTo3 } from "../utils/rounding";
import { resolveGroupTween, POSITION_CHANNELS } from "./gsapRuntimeBridge";
import { hasNonHoldTweenForElement } from "./gsapRuntimeKeyframes";

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

// fallow-ignore-next-line complexity
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
  // Scope every capture to the resize group — same contract as the rotation
  // intercept. Unfiltered, an opacity-touching intro tween on the element
  // would ride into resize conversions/backfills (the Fix-2 bake class).
  const runtimeProps = selector
    ? readAllAnimatedProperties(iframe, selector, anim, resizeGroup)
    : {};

  let resizeProps: Record<string, number>;
  let scaleDraftEl: HTMLElement | null = null;
  let scaleDraftDropPoint: { x: number; y: number } | null = null;
  let nonUniformScale = false;
  if (resizeGroup === "scale") {
    // Iframe-realm element — instanceof HTMLElement fails across realms; the
    // selector targets composition elements, and every use below is duck-typed.
    const el = iframe?.contentDocument?.querySelector(selector ?? "") as HTMLElement | null;
    // The resize draft modifies el.style.width/height, so read the ORIGINAL
    // dimensions saved by the draft system before it ran.
    const origW = Number.parseFloat(el?.getAttribute("data-hf-studio-original-width") ?? "");
    const origH = Number.parseFloat(el?.getAttribute("data-hf-studio-original-height") ?? "");
    const cssW = Number.isFinite(origW) && origW > 0 ? origW : 200;
    const cssH = Number.isFinite(origH) && origH > 0 ? origH : cssW;
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
    nonUniformScale = Math.abs(newScaleX - newScaleY) > 0.01;
    resizeProps = nonUniformScale ? { scaleX: newScaleX, scaleY: newScaleY } : { scale: newScaleX };
    scaleDraftEl = el;
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
  const finalizeScaleResizeCommit = async () => {
    if (!scaleDraftEl) return;
    clearStudioBoxSize(scaleDraftEl);
    if (!scaleDraftDropPoint || !selector) return;
    const hasLivePositionTween = hasNonHoldTweenForElement(
      iframe,
      selector,
      undefined,
      POSITION_CHANNELS,
    );
    if (hasLivePositionTween) {
      return;
    }
    // The scale commit has rendered (instant patch or soft-reload seek) and the
    // draft is cleared — this rect is where the element ACTUALLY sits now.
    const post = scaleDraftEl.getBoundingClientRect();
    const residual = { x: scaleDraftDropPoint.x - post.x, y: scaleDraftDropPoint.y - post.y };
    if (!Number.isFinite(residual.x) || !Number.isFinite(residual.y)) return;
    if (Math.abs(residual.x) < 0.5 && Math.abs(residual.y) < 0.5) return;
    const gsapPos = readGsapPositionFromIframe(iframe, selector) ?? { x: 0, y: 0 };
    // The ONE corrected position — rounded once so the live runtime and the
    // persisted file agree exactly (commitStaticGsapPosition composes the same
    // rounded value from this delta).
    const corrected = {
      x: Math.round(gsapPos.x + residual.x),
      y: Math.round(gsapPos.y + residual.y),
    };
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
    const existingSet = findExistingPositionWrite(currentAnimations, selector);
    // Delta chosen so the drag-path math composes back to exactly `corrected`
    // (no drag scratch attrs exist during a resize, so base = gsapPos).
    await commitStaticGsapPosition(
      selection,
      { x: corrected.x - gsapPos.x, y: corrected.y - gsapPos.y },
      gsapPos,
      selector,
      existingSet,
      {
        commitMutation,
        fetchAnimations: fetchFallbackAnimations,
      },
    );
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
    await finalizeScaleResizeCommit();
    return true;
  }

  const ct = usePlayerStore.getState().currentTime;
  const ts = resolveTweenStart(anim);
  const td = resolveTweenDuration(anim);
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

  // A NON-uniform scale must also take the full-rewrite path: it mixes
  // scaleX/scaleY into a tween whose existing keyframes may carry the uniform
  // `scale` shorthand, and GSAP's percentage keyframes animate each property
  // name independently — a shorthand/longhand mix would leave the old `scale`
  // sub-tween running against the new scaleX/scaleY. The rewrite below
  // normalizes every keyframe to the longhands. For an in-range resize the
  // min/max window math below degenerates to the tween's own start/duration,
  // so timing is unchanged.
  if ((outsideRange || nonUniformScale) && ts !== null) {
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
        coalesceKey,
      },
    );
    await finalizeScaleResizeCommit();
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
  await finalizeScaleResizeCommit();
  return true;
}

// ── Rotation intercept ────────────────────────────────────────────────────

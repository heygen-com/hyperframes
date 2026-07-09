import type { GsapAnimation, PropertyGroupName } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";
import { resolveTweenDuration, resolveTweenStart } from "../utils/globalTimeCompiler";
import { roundTo3 } from "../utils/rounding";
import {
  commitKeyframedSizeFromResize,
  commitStaticGsapSize,
  computeCurrentPercentage,
  findSizeSetAnimation,
  materializeIfDynamic,
  type GsapDragCommitCallbacks,
} from "./gsapDragCommit";
import { pickClosestToPlayhead } from "./gsapPositionDetection";
import { readAllAnimatedProperties } from "./gsapRuntimeReaders";
import { resolveGroupTween } from "./gsapRuntimeGroupTween";
import { selectorFromSelection } from "./gsapShared";
import { commitWholePropertyOffset } from "./gsapWholePropertyOffsetCommit";

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
    // hold), keyframe the size at the playhead so other keyframes keep theirs.
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
    return true;
  }

  const ct = usePlayerStore.getState().currentTime;
  const ts = resolveTweenStart(anim);
  const td = resolveTweenDuration(anim);
  const outsideRange = ts !== null && td > 0 && (ct < ts - 0.01 || ct > ts + td + 0.01);
  // Convert flat tweens to keyframes only for in-range resizes.
  if (!outsideRange) {
    // fallow-ignore-next-line code-duplication
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

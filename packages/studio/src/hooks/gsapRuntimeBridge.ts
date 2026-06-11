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
import {
  commitGsapPositionFromDrag,
  computeCurrentPercentage,
  materializeIfDynamic,
} from "./gsapDragCommit";
import { resolveTweenStart, resolveTweenDuration } from "../utils/globalTimeCompiler";
import type { GsapDragCommitCallbacks } from "./gsapDragCommit";

// ── Runtime reads ──────────────────────────────────────────────────────────

interface IframeGsap {
  getProperty: (el: Element, prop: string) => number;
}

// fallow-ignore-next-line complexity
function readGsapPositionFromIframe(
  iframe: HTMLIFrameElement | null,
  elementSelector: string,
): { x: number; y: number } | null {
  if (!iframe?.contentWindow) return null;

  let gsap: IframeGsap | undefined;
  try {
    gsap = (iframe.contentWindow as unknown as { gsap?: IframeGsap }).gsap;
  } catch {
    return null;
  }
  if (!gsap?.getProperty) return null;

  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    return null;
  }
  if (!doc) return null;

  const element = doc.querySelector(elementSelector);
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
      if (currentTime >= pos - 0.05 && currentTime <= pos + dur + 0.05) score += 4;
      return { anim: a, score };
    });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.anim ?? animations[0];
}

// ── Selector resolution ────────────────────────────────────────────────────

function selectorForSelection(selection: DomEditSelection): string | null {
  if (selection.id) return `#${selection.id}`;
  if (selection.selector) return selection.selector;
  return null;
}

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
async function resolveGroupTween(
  group: PropertyGroupName,
  animations: GsapAnimation[],
  selection: DomEditSelection,
  commitMutation: GsapDragCommitCallbacks["commitMutation"],
  fetchFallbackAnimations?: () => Promise<GsapAnimation[]>,
): Promise<{ anim: GsapAnimation; animations: GsapAnimation[] } | null> {
  // 1. Already-split group tween — prefer the one with the most keyframes
  // to avoid targeting a stub when a gesture-recorded tween also exists.
  const groupAnims = animations.filter((a) => a.propertyGroup === group);
  const groupAnim =
    groupAnims.length > 1
      ? groupAnims.sort(
          (a, b) => (b.keyframes?.keyframes.length ?? 0) - (a.keyframes?.keyframes.length ?? 0),
        )[0]
      : (groupAnims[0] ?? null);
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
): Promise<boolean> {
  const selector = selectorForSelection(selection);
  if (!selector) return false;

  // Resolve the position-group tween, splitting legacy mixed tweens if needed.
  const resolved = await resolveGroupTween(
    "position",
    animations,
    selection,
    commitMutation,
    fetchFallbackAnimations,
  );

  // Fallback: use the legacy scoring heuristic for compositions that don't
  // have group-tagged tweens at all (e.g. hand-written scripts).
  let posAnim = resolved?.anim ?? null;
  if (!posAnim) {
    posAnim = findGsapPositionAnimation(animations, selector);
    if (!posAnim && fetchFallbackAnimations) {
      const fresh = await fetchFallbackAnimations();
      posAnim = findGsapPositionAnimation(fresh, selector);
    }
  }
  if (!posAnim) return false;

  // Keyframe writes at 0%/100% when outside the tween range. Acceptable
  // trade-off — CSS path must NEVER touch GSAP-targeted elements because
  // changing the CSS offset corrupts all existing keyframes (baked mismatch).

  const gsapPos = readGsapPositionFromIframe(iframe, selector);
  if (!gsapPos) return false;

  await commitGsapPositionFromDrag(selection, posAnim, offset, gsapPos, iframe, selector, {
    commitMutation,
    fetchAnimations: fetchFallbackAnimations,
  });
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
  if (!anim) {
    // No size-group tween exists — create one. Use the element's timing
    // from any existing animation, or fall back to element data attributes.
    const refAnim = animations[0];
    const elStart =
      refAnim?.resolvedStart ?? (Number.parseFloat(selection.dataAttributes?.start ?? "0") || 0);
    const elDuration = Number.parseFloat(selection.dataAttributes?.duration ?? "5") || 5;
    const ct = usePlayerStore.getState().currentTime;
    const pct = elDuration > 0 ? Math.round(((ct - elStart) / elDuration) * 1000) / 10 : 0;
    const sel = selectorForSelection(selection);
    if (!sel) return false;
    await commitMutation(
      selection,
      {
        type: "add-with-keyframes",
        targetSelector: sel,
        position: Math.round(elStart * 1000) / 1000,
        duration: Math.round(elDuration * 1000) / 1000,
        keyframes: [
          {
            percentage: Math.max(0, Math.min(100, pct)),
            properties: { width: Math.round(size.width), height: Math.round(size.height) },
          },
        ],
      },
      { label: "Resize (new size keyframe)", softReload: true },
    );
    return true;
  }

  const { activeKeyframePct, setActiveKeyframePct } = usePlayerStore.getState();
  const pct = activeKeyframePct ?? computeCurrentPercentage(selection, anim);
  if (activeKeyframePct != null) setActiveKeyframePct(null);
  const coalesceKey = `gsap:resize:${anim.id}`;

  const selector = selectorForSelection(selection);
  const runtimeProps = selector ? readAllAnimatedProperties(iframe, selector, anim) : {};

  let resizeProps: Record<string, number>;
  if (resizeGroup === "scale") {
    const el = iframe?.contentDocument?.querySelector(selector ?? "") as HTMLElement | null;
    // The resize draft modifies el.style.width, so read the ORIGINAL width
    // saved by the draft system before it ran.
    const origW = Number.parseFloat(el?.getAttribute("data-hf-studio-original-width") ?? "");
    const cssW = Number.isFinite(origW) && origW > 0 ? origW : 200;
    const newScale = Math.round((size.width / cssW) * 1000) / 1000;
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
        position: Math.round(newStart * 1000) / 1000,
        duration: Math.round(newDuration * 1000) / 1000,
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
  // Resolve the rotation-group tween, splitting legacy mixed tweens if needed.
  const resolved = await resolveGroupTween(
    "rotation",
    animations,
    selection,
    commitMutation,
    fetchFallbackAnimations,
  );

  // Fallback: legacy heuristic for hand-written scripts
  let anim = resolved?.anim ?? null;
  if (!anim) {
    anim = animations.find((a) => "rotation" in a.properties || a.keyframes) ?? null;
    if (!anim && fetchFallbackAnimations) {
      const fresh = await fetchFallbackAnimations();
      anim = fresh.find((a) => "rotation" in a.properties || a.keyframes) ?? null;
    }
  }
  if (!anim) return false;

  const selector = selectorForSelection(selection);
  if (!selector) return false;

  let gsapRotation = 0;
  if (iframe?.contentWindow) {
    try {
      const gsap = (
        iframe.contentWindow as unknown as {
          gsap?: { getProperty: (el: Element, prop: string) => number };
        }
      ).gsap;
      const doc = iframe.contentDocument;
      const el = doc?.querySelector(selector);
      if (gsap?.getProperty && el) {
        gsapRotation = Number(gsap.getProperty(el, "rotation")) || 0;
      }
    } catch {
      /* cross-origin guard */
    }
  }

  const pct = computeCurrentPercentage(selection, anim);
  const newRotation = Math.round(gsapRotation + angle);

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

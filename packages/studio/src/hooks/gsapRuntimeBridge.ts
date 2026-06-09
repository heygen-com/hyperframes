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
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";

import { usePlayerStore } from "../player/store/playerStore";
import { readRuntimeKeyframes, scanAllRuntimeKeyframes } from "./gsapRuntimeKeyframes";
import {
  absoluteToPercentage,
  resolveTweenStart,
  resolveTweenDuration,
} from "../utils/globalTimeCompiler";

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
function findGsapPositionAnimation(animations: GsapAnimation[]): GsapAnimation | null {
  // Prefer animations that already have x/y
  for (const anim of animations) {
    if (anim.keyframes) {
      const hasPos = anim.keyframes.keyframes.some(
        (kf) => "x" in kf.properties || "y" in kf.properties,
      );
      if (hasPos) return anim;
    }
    const props = anim.properties;
    const fromProps = anim.fromProperties;
    if (anim.method === "fromTo") {
      if ("x" in props || "y" in props || (fromProps && ("x" in fromProps || "y" in fromProps))) {
        return anim;
      }
    } else if ("x" in props || "y" in props) {
      return anim;
    }
  }
  // Fall back to any keyframed animation — drag will add x/y to it
  for (const anim of animations) {
    if (anim.keyframes) return anim;
  }
  // Fall back to any animation — will be converted to keyframes
  return animations[0] ?? null;
}

// ── Selector resolution ────────────────────────────────────────────────────

function selectorForSelection(selection: DomEditSelection): string | null {
  if (selection.id) return `#${selection.id}`;
  if (selection.selector) return selection.selector;
  return null;
}

// ── Percentage computation ─────────────────────────────────────────────────

function computeCurrentPercentage(selection: DomEditSelection, animation?: GsapAnimation): number {
  const currentTime = usePlayerStore.getState().currentTime;
  if (animation) {
    const start = resolveTweenStart(animation);
    const duration = resolveTweenDuration(animation);
    if (start !== null) {
      return absoluteToPercentage(currentTime, start, duration);
    }
  }
  const elStart = Number.parseFloat(selection.dataAttributes?.start ?? "0") || 0;
  const elDuration = Number.parseFloat(selection.dataAttributes?.duration ?? "1") || 1;
  return elDuration > 0
    ? Math.max(0, Math.min(100, Math.round(((currentTime - elStart) / elDuration) * 1000) / 10))
    : 0;
}

// ── Dynamic keyframe materialization ──────────────────────────────────────

async function materializeIfDynamic(
  anim: GsapAnimation,
  iframe: HTMLIFrameElement | null,
  commitMutation: GsapDragCommitCallbacks["commitMutation"],
  selection: DomEditSelection,
): Promise<string | void> {
  if (!anim.hasUnresolvedKeyframes && !anim.hasUnresolvedSelector) return;

  if (anim.hasUnresolvedSelector) {
    // Unroll: read ALL elements' keyframes from runtime and replace the loop
    const allScanned = scanAllRuntimeKeyframes(iframe);
    if (allScanned.size === 0) return;
    const allElements = Array.from(allScanned.entries()).map(([id, data]) => ({
      selector: `#${id}`,
      keyframes: data.keyframes,
      easeEach: data.easeEach,
    }));
    await commitMutation(
      selection,
      {
        type: "materialize-keyframes",
        animationId: anim.id,
        keyframes: allScanned.get(selection.id ?? "")?.keyframes ?? [],
        allElements,
      },
      { label: "Unroll dynamic animations", skipReload: true },
    );
    return `${anim.targetSelector}-to-0`;
  }

  const runtime = readRuntimeKeyframes(iframe, anim.targetSelector);
  if (!runtime || runtime.keyframes.length === 0) return;
  await commitMutation(
    selection,
    {
      type: "materialize-keyframes",
      animationId: anim.id,
      keyframes: runtime.keyframes,
      easeEach: runtime.easeEach,
    },
    { label: "Materialize dynamic keyframes", skipReload: true },
  );
}

// ── High-level intercept ───────────────────────────────────────────────────

export interface GsapDragCommitCallbacks {
  commitMutation: (
    selection: DomEditSelection,
    mutation: Record<string, unknown>,
    options: {
      label: string;
      coalesceKey?: string;
      softReload?: boolean;
      skipReload?: boolean;
      beforeReload?: () => void;
    },
  ) => Promise<void>;
}

/**
 * Attempt to handle a drag commit via the GSAP script mutation path.
 *
 * Returns a Promise that resolves to true if the drag was handled via GSAP
 * (caller should skip the CSS path), or false if no GSAP position animation
 * exists. The promise resolves only AFTER the mutation has been persisted and
 * the preview soft-reloaded — the CSS offset stays visible until then so the
 * element doesn't snap back during the async gap.
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
  let posAnim = findGsapPositionAnimation(animations);
  if (!posAnim && fetchFallbackAnimations) {
    const fresh = await fetchFallbackAnimations();
    posAnim = findGsapPositionAnimation(fresh);
  }
  if (!posAnim) return false;

  const selector = selectorForSelection(selection);
  if (!selector) return false;

  // Keyframe writes at 0%/100% when outside the tween range. Acceptable
  // trade-off — CSS path must NEVER touch GSAP-targeted elements because
  // changing the CSS offset corrupts all existing keyframes (baked mismatch).

  const gsapPos = readGsapPositionFromIframe(iframe, selector);
  if (!gsapPos) return false;

  await commitGsapPositionFromDrag(selection, posAnim, offset, gsapPos, iframe, selector, {
    commitMutation,
  });
  return true;
}

// ── Commit helpers ─────────────────────────────────────────────────────────

/**
 * Compute the new GSAP position values from runtime-read positions + drag
 * offset, then commit the mutation to the GSAP script.
 *
 * `gsap.getProperty` reads from GSAP's internal cache (element._gsap), not
 * from the DOM transform matrix. The strip in `applyStudioPathOffset` does
 * not affect the cached values, so the formula is simply:
 *   newValue = cachedGsapValue + dragOffset
 *
 * For flat tweens (to/set), the mutation would change the tween endpoint,
 * which is invisible at t=0. Instead, we convert to keyframes first so the
 * position is set at the exact seek percentage via a keyframe.
 */
// fallow-ignore-next-line complexity
async function commitGsapPositionFromDrag(
  selection: DomEditSelection,
  anim: GsapAnimation,
  studioOffset: { x: number; y: number },
  gsapPos: { x: number; y: number },
  iframe: HTMLIFrameElement | null,
  selector: string,
  callbacks: GsapDragCommitCallbacks,
): Promise<void> {
  // CSS composition: translate → rotate → transform. The studioOffset is in
  // pre-rotation space (CSS translate), but GSAP x/y are in post-CSS-rotate
  // space (CSS transform). Counter-rotate the offset to match GSAP's frame.
  const rotStyle = selection.element.style.getPropertyValue("--hf-studio-rotation");
  const rotDeg = Number.parseFloat(rotStyle) || 0;
  const rad = (-rotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const el = selection.element;
  const origX = Number.parseFloat(el.getAttribute("data-hf-drag-initial-offset-x") ?? "") || 0;
  const origY = Number.parseFloat(el.getAttribute("data-hf-drag-initial-offset-y") ?? "") || 0;
  const deltaX = studioOffset.x - origX;
  const deltaY = studioOffset.y - origY;
  const adjX = deltaX * cos - deltaY * sin;
  const adjY = deltaX * sin + deltaY * cos;
  // Use the GSAP base captured at drag start — the live gsapPos is corrupted
  // by the draft's gsap.set() calls during drag.
  const baseGsapX =
    Number.parseFloat(el.getAttribute("data-hf-drag-gsap-base-x") ?? "") || gsapPos.x;
  const baseGsapY =
    Number.parseFloat(el.getAttribute("data-hf-drag-gsap-base-y") ?? "") || gsapPos.y;
  const newX = Math.round(baseGsapX + adjX);
  const newY = Math.round(baseGsapY + adjY);
  // Restore the CSS offset to pre-drag value so the baked translate stays
  // consistent with existing keyframes. The drag is captured in the new keyframe.
  const restoreOffset = () => {
    el.style.setProperty("--hf-studio-offset-x", `${origX}px`);
    el.style.setProperty("--hf-studio-offset-y", `${origY}px`);
    el.removeAttribute("data-hf-drag-initial-offset-x");
    el.removeAttribute("data-hf-drag-initial-offset-y");
  };

  if (anim.keyframes) {
    const newId = await materializeIfDynamic(anim, iframe, callbacks.commitMutation, selection);
    const effectiveAnim = newId ? { ...anim, id: newId } : anim;
    const runtimeProps = readAllAnimatedProperties(iframe, selector, anim);

    // Check if current time is outside the tween's range — extend the tween
    // to cover the playhead, remap existing keyframes, then add the new one.
    const ct = usePlayerStore.getState().currentTime;
    const ts = resolveTweenStart(effectiveAnim);
    const td = resolveTweenDuration(effectiveAnim);
    if (ts !== null && td > 0 && (ct < ts - 0.01 || ct > ts + td + 0.01)) {
      await extendTweenAndAddKeyframe(
        selection,
        effectiveAnim,
        { ...runtimeProps, x: newX, y: newY },
        ct,
        ts,
        td,
        callbacks,
        restoreOffset,
      );
    } else {
      await commitKeyframedPosition(
        selection,
        effectiveAnim,
        { ...runtimeProps, x: newX, y: newY },
        callbacks,
        restoreOffset,
      );
    }
  } else if (anim.method === "from" || anim.method === "fromTo") {
    // from()/fromTo() — convert to keyframes in a single mutation, placing
    // the dragged position at the 100% (rest) keyframe. A single mutation
    // avoids the stable-id flip (from→to) that breaks chained mutations.
    await callbacks.commitMutation(
      selection,
      {
        type: "convert-to-keyframes",
        animationId: anim.id,
        resolvedFromValues: { x: newX, y: newY },
      },
      { label: "Move layer (keyframe rest)", softReload: true, beforeReload: restoreOffset },
    );
  } else {
    // Flat to()/set() — convert to keyframes then add at current percentage.
    const runtimeProps = readAllAnimatedProperties(iframe, selector, anim);
    await commitFlatViaKeyframes(
      selection,
      anim,
      { ...runtimeProps, x: newX, y: newY },
      callbacks,
      restoreOffset,
    );
  }
}

/**
 * Extend a tween's time range to cover `targetTime`, remap all existing
 * keyframe percentages to preserve their absolute positions, then add
 * a new keyframe at the target time.
 */
async function extendTweenAndAddKeyframe(
  selection: DomEditSelection,
  anim: GsapAnimation,
  properties: Record<string, number>,
  targetTime: number,
  tweenStart: number,
  tweenDuration: number,
  callbacks: GsapDragCommitCallbacks,
  beforeReload?: () => void,
): Promise<void> {
  const tweenEnd = tweenStart + tweenDuration;
  const newStart = Math.min(targetTime, tweenStart);
  const newEnd = Math.max(targetTime, tweenEnd);
  const newDuration = Math.max(0.01, newEnd - newStart);

  // Step 1: Remap all existing keyframes to preserve their absolute times
  // in the new range, then add the new keyframe.
  const existingKfs = anim.keyframes?.keyframes ?? [];
  const remappedKfs: Array<{ percentage: number; properties: Record<string, number | string> }> =
    [];
  for (const kf of existingKfs) {
    const absTime = tweenStart + (kf.percentage / 100) * tweenDuration;
    const newPct = Math.round(((absTime - newStart) / newDuration) * 1000) / 10;
    remappedKfs.push({ percentage: newPct, properties: { ...kf.properties } });
  }

  // Add the new keyframe at the target time
  const targetPct = Math.round(((targetTime - newStart) / newDuration) * 1000) / 10;
  remappedKfs.push({ percentage: targetPct, properties });

  // Sort and dedupe
  remappedKfs.sort((a, b) => a.percentage - b.percentage);

  // Step 2: Delete the old tween and create a new one with the extended range
  // and all remapped keyframes. Using delete + add-with-keyframes as an atomic pair.
  await callbacks.commitMutation(
    selection,
    { type: "delete", animationId: anim.id },
    { label: "Extend tween range", skipReload: true },
  );

  const selector = anim.targetSelector;
  await callbacks.commitMutation(
    selection,
    {
      type: "add-with-keyframes",
      targetSelector: selector,
      position: Math.round(newStart * 1000) / 1000,
      duration: Math.round(newDuration * 1000) / 1000,
      keyframes: remappedKfs,
    },
    { label: `Move layer (extended keyframe)`, softReload: true, beforeReload },
  );
}

// fallow-ignore-next-line complexity
async function commitKeyframedPosition(
  selection: DomEditSelection,
  anim: GsapAnimation,
  properties: Record<string, number>,
  callbacks: GsapDragCommitCallbacks,
  beforeReload?: () => void,
): Promise<void> {
  const pct = computeCurrentPercentage(selection, anim);

  await callbacks.commitMutation(
    selection,
    {
      type: "add-keyframe",
      animationId: anim.id,
      percentage: pct,
      properties,
    },
    { label: `Move layer (keyframe ${pct}%)`, softReload: true, beforeReload },
  );
}

/**
 * For flat to()/set() tweens, convert to keyframes first so we can place the
 * drag position at the current percentage. Without conversion, the mutation
 * only changes the tween endpoint, which is invisible at t=0.
 */
// fallow-ignore-next-line complexity
async function commitFlatViaKeyframes(
  selection: DomEditSelection,
  anim: GsapAnimation,
  properties: Record<string, number>,
  callbacks: GsapDragCommitCallbacks,
  beforeReload?: () => void,
): Promise<void> {
  await callbacks.commitMutation(
    selection,
    { type: "convert-to-keyframes", animationId: anim.id },
    { label: "Convert to keyframes for drag", skipReload: true },
  );

  const pct = computeCurrentPercentage(selection, anim);

  await callbacks.commitMutation(
    selection,
    {
      type: "add-keyframe",
      animationId: anim.id,
      percentage: pct,
      properties,
    },
    { label: `Move layer (keyframe ${pct}%)`, softReload: true, beforeReload },
  );
}

// ── Runtime property reader ───────────────────────────────────────────────

export function readGsapProperty(
  iframe: HTMLIFrameElement | null,
  selector: string | null,
  prop: string,
): number | null {
  if (!iframe?.contentWindow || !selector) return null;
  try {
    const gsap = (iframe.contentWindow as unknown as { gsap?: IframeGsap }).gsap;
    if (!gsap?.getProperty) return null;
    const el = iframe.contentDocument?.querySelector(selector);
    if (!el) return null;
    const val = Number(gsap.getProperty(el, prop));
    return Number.isFinite(val) ? Math.round(val) : null;
  } catch {
    return null;
  }
}

export function readAllAnimatedProperties(
  iframe: HTMLIFrameElement | null,
  selector: string,
  anim: GsapAnimation,
): Record<string, number> {
  const result: Record<string, number> = {};
  if (!iframe?.contentWindow) return result;
  let gsap: IframeGsap | undefined;
  try {
    gsap = (iframe.contentWindow as unknown as { gsap?: IframeGsap }).gsap;
  } catch {
    return result;
  }
  if (!gsap?.getProperty) return result;
  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    return result;
  }
  const el = doc?.querySelector(selector);
  if (!el) return result;

  const propKeys = new Set<string>();
  if (anim.keyframes) {
    for (const kf of anim.keyframes.keyframes) {
      for (const p of Object.keys(kf.properties)) {
        if (typeof kf.properties[p] === "number") propKeys.add(p);
      }
    }
  } else {
    for (const p of Object.keys(anim.properties)) propKeys.add(p);
  }

  for (const prop of propKeys) {
    const val = Number(gsap.getProperty(el, prop));
    if (Number.isFinite(val)) result[prop] = Math.round(val);
  }
  return result;
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
  let anim = animations.find(
    (a) => "width" in a.properties || "height" in a.properties || a.keyframes,
  );
  if (!anim && fetchFallbackAnimations) {
    const fresh = await fetchFallbackAnimations();
    anim = fresh.find((a) => "width" in a.properties || "height" in a.properties || a.keyframes);
  }
  if (!anim) return false;

  const pct = computeCurrentPercentage(selection, anim);

  if (anim.hasUnresolvedKeyframes || anim.hasUnresolvedSelector) {
    const newId = await materializeIfDynamic(anim, iframe, commitMutation, selection);
    if (newId) anim = { ...anim, id: newId };
  } else if (!anim.keyframes) {
    await commitMutation(
      selection,
      { type: "convert-to-keyframes", animationId: anim.id },
      { label: "Convert to keyframes for resize", skipReload: true },
    );
  }

  const selector = selectorForSelection(selection);
  const runtimeProps = selector ? readAllAnimatedProperties(iframe, selector, anim) : {};

  const backfillDefaults: Record<string, number> = { ...runtimeProps };
  if (!("width" in runtimeProps)) {
    const cssW = readGsapProperty(iframe, selector, "width");
    backfillDefaults.width = cssW ?? Math.round(size.width);
  }
  if (!("height" in runtimeProps)) {
    const cssH = readGsapProperty(iframe, selector, "height");
    backfillDefaults.height = cssH ?? Math.round(size.height);
  }

  const properties = {
    ...runtimeProps,
    width: Math.round(size.width),
    height: Math.round(size.height),
  };

  await commitMutation(
    selection,
    {
      type: "add-keyframe",
      animationId: anim.id,
      percentage: pct,
      properties,
      backfillDefaults,
    },
    { label: `Resize (keyframe ${pct}%)`, softReload: true },
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
  let anim = animations.find((a) => "rotation" in a.properties || a.keyframes);
  if (!anim && fetchFallbackAnimations) {
    const fresh = await fetchFallbackAnimations();
    anim = fresh.find((a) => "rotation" in a.properties || a.keyframes);
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
    await commitMutation(
      selection,
      { type: "convert-to-keyframes", animationId: anim.id },
      { label: "Convert to keyframes for rotation", skipReload: true },
    );
  }

  const runtimeProps = readAllAnimatedProperties(iframe, selector, anim);

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

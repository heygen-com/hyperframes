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

import { resolveTweenStart, resolveTweenDuration } from "../utils/globalTimeCompiler";
import { readAllAnimatedProperties, readGsapProperty } from "./gsapRuntimeReaders";
import {
  commitGsapPositionFromDrag,
  computeCurrentPercentage,
  materializeIfDynamic,
} from "./gsapDragCommit";
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
  let posAnim = findGsapPositionAnimation(animations);
  if (!posAnim && fetchFallbackAnimations) {
    const fresh = await fetchFallbackAnimations();
    posAnim = findGsapPositionAnimation(fresh);
  }
  if (!posAnim) return false;

  const selector = selectorForSelection(selection);
  if (!selector) return false;

  const gsapPos = readGsapPositionFromIframe(iframe, selector);
  if (!gsapPos) return false;

  await commitGsapPositionFromDrag(selection, posAnim, offset, gsapPos, iframe, selector, {
    commitMutation,
  });
  return true;
}

// ── Runtime property readers (re-exported for external callers) ───────────

export { readGsapProperty, readAllAnimatedProperties };

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

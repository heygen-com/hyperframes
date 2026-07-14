import { useCallback, useEffect, useRef } from "react";
import {
  LAYER_REVEAL_PRIOR_POSITION_ATTR,
  LAYER_REVEAL_PRIOR_Z_ATTR,
} from "../../player/lib/timelineElementHelpers";
import { readEffectiveZIndex } from "./canvasContextMenuZOrder";

/** The lifted paint order — far above any authored z. Only the RENDERER sees
 *  it: every studio z reader is reveal-transparent (readLayerRevealPriorZ). */
export const LAYER_REVEAL_LIFT_Z = "2147483000";

interface RevealedNode {
  element: HTMLElement;
  priors: { display: string; visibility: string; opacity: string };
  /** Values THIS override wrote — restore only while they are still in place. */
  applied: { display?: string; visibility?: string; opacity?: string };
}

interface RevealLift {
  priors: { zIndex: string; position: string };
  positionLifted: boolean;
}

interface RevealState {
  /** The layer element the reveal was applied for (deselect detection). */
  base: HTMLElement;
  nodes: RevealedNode[];
  lift: RevealLift | null;
}

function restoreInline(el: HTMLElement, property: string, prior: string): void {
  if (prior) el.style.setProperty(property, prior);
  else el.style.removeProperty(property);
}

/** Restore a property ONLY when its current inline value is still the one this
 *  override wrote — a later real edit (commit, animation seek) is the new
 *  truth and must not be clobbered. */
function restoreIfOurs(
  el: HTMLElement,
  property: "display" | "visibility" | "opacity",
  applied: string | undefined,
  prior: string,
): void {
  if (applied == null) return;
  if (el.style.getPropertyValue(property) !== applied) return;
  restoreInline(el, property, prior);
}

/** What hides this node at the current frame, per computed style. */
function readHideSignals(el: HTMLElement, win: Window) {
  const computed = win.getComputedStyle(el);
  const opacity = Number.parseFloat(computed.opacity);
  return {
    display: computed.display === "none",
    visibility: computed.visibility === "hidden" || computed.visibility === "collapse",
    opacity: Number.isFinite(opacity) && opacity <= 0.01,
  };
}

/** Force one hidden node visible with inline styles; returns priors + applied. */
function revealNode(
  el: HTMLElement,
  win: Window,
  needs: ReturnType<typeof readHideSignals>,
): RevealedNode {
  const priors = {
    display: el.style.display,
    visibility: el.style.visibility,
    opacity: el.style.opacity,
  };
  const applied: RevealedNode["applied"] = {};
  if (needs.display) {
    // Prefer whatever the stylesheet says once the inline hide is lifted;
    // only force block when the sheet itself hides it.
    el.style.removeProperty("display");
    if (win.getComputedStyle(el).display === "none") el.style.display = "block";
    applied.display = el.style.display;
  }
  if (needs.visibility) {
    el.style.visibility = "visible";
    applied.visibility = "visible";
  }
  if (needs.opacity) {
    el.style.opacity = "1";
    applied.opacity = "1";
  }
  return { element: el, priors, applied };
}

/** Walk `element` → body, force-revealing every hiding node; returns the touched nodes. */
function revealHiddenChain(element: HTMLElement): RevealedNode[] {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  if (!win) return [];
  const nodes: RevealedNode[] = [];
  let el: HTMLElement | null = element;
  while (el && el !== doc.body && el !== doc.documentElement) {
    let needs: ReturnType<typeof readHideSignals>;
    try {
      needs = readHideSignals(el, win);
    } catch {
      break; // detached / cross-realm — leave the rest alone
    }
    if (needs.display || needs.visibility || needs.opacity) nodes.push(revealNode(el, win, needs));
    el = el.parentElement;
  }
  return nodes;
}

/**
 * Lift the selected element to the TOP of the paint order while selected —
 * regardless of its authored z or panel position. The true z is parked in
 * LAYER_REVEAL_PRIOR_Z_ATTR so every studio z reader keeps reporting it (the
 * lift is invisible to menus, badges, the lane mirror, and the panel sort);
 * only the renderer sees the lifted inline value. A static element gets a
 * temporary position:relative (layout-preserving) so the z applies, with the
 * prior position parked in LAYER_REVEAL_PRIOR_POSITION_ATTR for the z-commit's
 * static check. Exported for direct unit testing.
 */
export function liftElementToTop(element: HTMLElement): RevealLift | null {
  const win = element.ownerDocument.defaultView;
  if (!win) return null;
  const priors = { zIndex: element.style.zIndex, position: element.style.position };
  let positionLifted = false;
  try {
    element.setAttribute(LAYER_REVEAL_PRIOR_Z_ATTR, String(readEffectiveZIndex(element)));
    if (win.getComputedStyle(element).position === "static") {
      element.setAttribute(LAYER_REVEAL_PRIOR_POSITION_ATTR, "static");
      element.style.position = "relative";
      positionLifted = true;
    }
  } catch {
    element.removeAttribute(LAYER_REVEAL_PRIOR_Z_ATTR);
    return null; // detached / cross-realm — no lift
  }
  element.style.zIndex = LAYER_REVEAL_LIFT_Z;
  return { priors, positionLifted };
}

/**
 * Undo an active lift. Skipped entirely when the prior-z attribute is gone —
 * a z-reorder commit consumed the lift (handleDomZIndexReorderCommit removes
 * the attributes and writes the new real z), and that commit is the truth.
 * Exported for direct unit testing.
 */
export function restoreLiftedElement(element: HTMLElement, lift: RevealLift): void {
  if (!element.hasAttribute(LAYER_REVEAL_PRIOR_Z_ATTR)) return;
  element.removeAttribute(LAYER_REVEAL_PRIOR_Z_ATTR);
  element.removeAttribute(LAYER_REVEAL_PRIOR_POSITION_ATTR);
  if (element.style.zIndex === LAYER_REVEAL_LIFT_Z) {
    restoreInline(element, "z-index", lift.priors.zIndex);
  }
  if (lift.positionLifted && element.style.position === "relative") {
    restoreInline(element, "position", lift.priors.position);
  }
}

/**
 * Temporary "show me this element" override for the Layers panel
 * (Webflow-navigator style): clicking a layer forces it (and every hiding
 * ancestor up to the body) visible with LIVE inline styles, and paints it on
 * TOP of the stack while selected (see liftElementToTop).
 *
 * Strictly ephemeral by construction:
 * - Exact prior inline values are recorded per touched node and restored on
 *   every exit path — reveal of a different layer, deselect, playback start,
 *   unmount. Nothing is ever sent to a persist path, and each property is
 *   restored only while it still holds the value this override wrote.
 * - A post-edit iframe reload replaces the DOM; detached nodes are skipped on
 *   restore (the fresh document never had the override).
 * - Scrubbing/playing lets the runtime and GSAP rewrite these same inline
 *   styles — that is the animation showing reality, and the override is
 *   dropped on play for exactly that reason.
 */
export function useLayerRevealOverride({ isPlaying }: { isPlaying: boolean }): {
  reveal: (element: HTMLElement) => void;
  restoreReveal: () => void;
  /** The element the active reveal targets, or null. */
  revealedBase: () => HTMLElement | null;
} {
  const stateRef = useRef<RevealState | null>(null);

  const restoreReveal = useCallback(() => {
    const state = stateRef.current;
    stateRef.current = null;
    if (!state) return;
    for (const { element, priors, applied } of state.nodes) {
      if (!element.isConnected) continue;
      restoreIfOurs(element, "display", applied.display, priors.display);
      restoreIfOurs(element, "visibility", applied.visibility, priors.visibility);
      restoreIfOurs(element, "opacity", applied.opacity, priors.opacity);
    }
    if (state.lift && state.base.isConnected) restoreLiftedElement(state.base, state.lift);
  }, []);

  const reveal = useCallback(
    (element: HTMLElement) => {
      restoreReveal();
      const nodes = revealHiddenChain(element);
      const lift = liftElementToTop(element);
      if (nodes.length > 0 || lift) stateRef.current = { base: element, nodes, lift };
    },
    [restoreReveal],
  );

  // Playback start: the animation owns visibility again.
  useEffect(() => {
    if (isPlaying) restoreReveal();
  }, [isPlaying, restoreReveal]);

  // Unmount: never leave overrides behind.
  useEffect(() => restoreReveal, [restoreReveal]);

  const revealedBase = useCallback(() => stateRef.current?.base ?? null, []);

  return { reveal, restoreReveal, revealedBase };
}

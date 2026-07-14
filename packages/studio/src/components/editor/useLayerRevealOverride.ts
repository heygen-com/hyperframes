import { useCallback, useEffect, useRef } from "react";

interface RevealedNode {
  element: HTMLElement;
  priors: { display: string; visibility: string; opacity: string };
}

interface RevealState {
  /** The layer element the reveal was applied for (deselect detection). */
  base: HTMLElement;
  nodes: RevealedNode[];
}

function restoreInline(el: HTMLElement, property: string, prior: string): void {
  if (prior) el.style.setProperty(property, prior);
  else el.style.removeProperty(property);
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

/** Force one hidden node visible with inline styles; returns its priors. */
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
  if (needs.display) {
    // Prefer whatever the stylesheet says once the inline hide is lifted;
    // only force block when the sheet itself hides it.
    el.style.removeProperty("display");
    if (win.getComputedStyle(el).display === "none") el.style.display = "block";
  }
  if (needs.visibility) el.style.visibility = "visible";
  if (needs.opacity) el.style.opacity = "1";
  return { element: el, priors };
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
 * Temporary "show me this element" override for the Layers panel
 * (Webflow-navigator style): clicking a layer that is hidden at the current
 * frame — an animation parked it at opacity:0, the runtime display/visibility-
 * hid an inactive region, or a hidden ancestor covers it — forces it (and every
 * hiding ancestor up to the body) visible with LIVE inline styles only.
 *
 * Strictly ephemeral by construction:
 * - Exact prior inline values are recorded per touched node and restored on
 *   every exit path — reveal of a different layer, deselect, playback start,
 *   unmount. Nothing is ever sent to a persist path.
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
    for (const { element, priors } of state.nodes) {
      if (!element.isConnected) continue;
      restoreInline(element, "display", priors.display);
      restoreInline(element, "visibility", priors.visibility);
      restoreInline(element, "opacity", priors.opacity);
    }
  }, []);

  const reveal = useCallback(
    (element: HTMLElement) => {
      restoreReveal();
      const nodes = revealHiddenChain(element);
      if (nodes.length > 0) stateRef.current = { base: element, nodes };
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

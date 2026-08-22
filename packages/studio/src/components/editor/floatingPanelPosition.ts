/**
 * Viewport-aware placement for a timeline surface portaled to `document.body`.
 *
 * Shared because the timeline's floating surfaces sit at the BOTTOM of the
 * studio window, so the naive `top: anchorRect.bottom + 4` puts them off the
 * bottom edge — a click that appears to do nothing. The FX popover grew this
 * handling; the group-creation dialog was still positioning itself raw. One
 * implementation, so the next surface cannot drift again.
 */

import type { CSSProperties } from "react";

/** Keep this much clear of every viewport edge. */
const VIEWPORT_MARGIN = 8;
/** The gap between the anchor and the surface it opens. */
const ANCHOR_GAP = 4;

export interface FloatingPanelPlacement {
  /** Fixed width of the surface, in px — needed to clamp the right edge. */
  width: number;
  /**
   * How tall the surface wants to be. Below this much room underneath, it
   * flips above the anchor (when there is genuinely more room there).
   */
  preferredHeight: number;
  /** Never cap shorter than this; the surface scrolls instead of vanishing. */
  minHeight: number;
}

/**
 * Placement for `anchorRect`, as inline style. Flips above the anchor when
 * below is too tight, clamps horizontally into the viewport, and caps the
 * height to whichever side it chose so the surface cannot run off-screen.
 */
export function floatingPanelStyle(
  anchorRect: DOMRect,
  { width, preferredHeight, minHeight }: FloatingPanelPlacement,
): CSSProperties {
  const left = Math.min(
    Math.max(anchorRect.left, VIEWPORT_MARGIN),
    Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
  );
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  // The space actually available above. Equal to `anchorRect.top` for a
  // viewport-relative rect; named because the height cap needs it too.
  const spaceAbove = anchorRect.top;
  const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
  const available = (openUpward ? spaceAbove : spaceBelow) - VIEWPORT_MARGIN - ANCHOR_GAP;
  // `minHeight` is a floor against a tight GAP, not against a tight window —
  // so cap it by the viewport too, or a short window gets a surface taller
  // than the screen it opened on.
  const height = Math.min(Math.max(minHeight, available), window.innerHeight - VIEWPORT_MARGIN * 2);
  // A floor larger than the gap would hang the surface off the edge it opened
  // away from — reachable at high browser zoom, where both gaps fall under the
  // floor. Slide it back in-bounds the way `left` is already clamped, rather
  // than shrinking below the floor: the offset that keeps BOTH edges inside is
  // `innerHeight - height - VIEWPORT_MARGIN`, from either side.
  const inset = (desired: number) =>
    Math.max(
      VIEWPORT_MARGIN,
      Math.min(desired, Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)),
    );
  return {
    position: "fixed",
    left,
    width,
    maxHeight: height,
    ...(openUpward
      ? { bottom: inset(window.innerHeight - anchorRect.top + ANCHOR_GAP) }
      : { top: inset(anchorRect.bottom + ANCHOR_GAP) }),
  };
}

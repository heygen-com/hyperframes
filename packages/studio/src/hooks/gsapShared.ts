/**
 * Shared GSAP utilities used across multiple Studio hooks.
 */
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";

import {
  absoluteToPercentage,
  resolveTweenStart,
  resolveTweenDuration,
} from "../utils/globalTimeCompiler";

// ── Selector resolution ────────────────────────────────────────────────────

/**
 * Get a CSS selector string from a DomEditSelection.
 * Returns `#id` if the selection has an id, otherwise the raw selector,
 * or null if neither exists.
 */
export function selectorFromSelection(selection: DomEditSelection): string | null {
  if (selection.id) return `#${selection.id}`;
  if (selection.selector) return selection.selector;
  return null;
}

// ── Percentage computation ─────────────────────────────────────────────────

/**
 * Compute the current playback percentage within an element's animation range.
 * Uses the animation's resolved timing if available, otherwise falls back to
 * the element's data-start / data-duration attributes.
 */
export function computeElementPercentage(
  currentTime: number,
  selection: DomEditSelection,
  animation?: GsapAnimation | null,
): number {
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

// ── Iframe document access ─────────────────────────────────────────────────

/**
 * Safely access an iframe's contentDocument, returning null on cross-origin
 * errors or if the iframe/document is unavailable.
 */
export function getIframeDocument(iframe: HTMLIFrameElement | null): Document | null {
  if (!iframe) return null;
  try {
    return iframe.contentDocument;
  } catch {
    return null;
  }
}

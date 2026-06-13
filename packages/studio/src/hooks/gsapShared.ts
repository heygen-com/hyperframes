/**
 * Shared GSAP primitives used across multiple hook files.
 * Centralises duplicated interfaces, constants, and small utilities
 * to reduce drift risk.
 */
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import {
  absoluteToPercentage,
  resolveTweenStart,
  resolveTweenDuration,
} from "../utils/globalTimeCompiler";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Canonical interface for the iframe-hosted GSAP runtime. */
export interface IframeGsap {
  getProperty: (el: Element, prop: string) => number;
  set?: (target: string, vars: Record<string, number | string>) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const PROPERTY_DEFAULTS: Record<string, number> = {
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  width: 100,
  height: 100,
};

// ── Selector resolution ───────────────────────────────────────────────────────

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

// ── Percentage computation ────────────────────────────────────────────────────

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

// ── Iframe accessors ──────────────────────────────────────────────────────────

/** Safely retrieve the GSAP runtime from the preview iframe. */
export function getIframeGsap(iframe: HTMLIFrameElement | null): IframeGsap | null {
  if (!iframe?.contentWindow) return null;
  try {
    const gsap = (iframe.contentWindow as unknown as { gsap?: IframeGsap }).gsap;
    return gsap?.getProperty ? gsap : null;
  } catch {
    return null;
  }
}

/** Safely query an element inside the preview iframe's document. */
export function queryIframeElement(
  iframe: HTMLIFrameElement | null,
  selector: string,
): Element | null {
  try {
    return iframe?.contentDocument?.querySelector(selector) ?? null;
  } catch {
    return null;
  }
}

/** Safely access an iframe's contentDocument, returning null on cross-origin errors. */
export function getIframeDocument(iframe: HTMLIFrameElement | null): Document | null {
  if (!iframe) return null;
  try {
    return iframe.contentDocument;
  } catch {
    return null;
  }
}

// ── Keyframe parsing ──────────────────────────────────────────────────────────

export interface ParsedPercentageKeyframes {
  keyframes: Array<{ percentage: number; properties: Record<string, number | string> }>;
  easeEach?: string;
}

/**
 * Parse a GSAP percentage-keyframe object (`{ "0%": { x: 10 }, "100%": { x: 200 } }`)
 * into a sorted array of `{ percentage, properties }` entries.
 * Returns `null` when the object contains no valid keyframe entries.
 */
export function parsePercentageKeyframes(
  kfObj: Record<string, unknown>,
): ParsedPercentageKeyframes | null {
  const keyframes: ParsedPercentageKeyframes["keyframes"] = [];
  let easeEach: string | undefined;

  for (const [key, val] of Object.entries(kfObj)) {
    if (key === "easeEach") {
      if (typeof val === "string") easeEach = val;
      continue;
    }
    const pctMatch = key.match(/^(\d+(?:\.\d+)?)%$/);
    if (!pctMatch || !val || typeof val !== "object") continue;
    const percentage = parseFloat(pctMatch[1]);
    const properties: Record<string, number | string> = {};
    for (const [pk, pv] of Object.entries(val as Record<string, unknown>)) {
      if (pk === "ease") continue;
      if (typeof pv === "number") properties[pk] = Math.round(pv * 1000) / 1000;
      else if (typeof pv === "string") properties[pk] = pv;
    }
    if (Object.keys(properties).length > 0) {
      keyframes.push({ percentage, properties });
    }
  }

  if (keyframes.length === 0) return null;
  keyframes.sort((a, b) => a.percentage - b.percentage);
  return { keyframes, easeEach };
}

// ── Time conversion ───────────────────────────────────────────────────────────

/** Convert a tween-relative percentage to an absolute time. */
export function toAbsoluteTime(tweenPos: number, tweenDur: number, percentage: number): number {
  return tweenPos + (percentage / 100) * tweenDur;
}

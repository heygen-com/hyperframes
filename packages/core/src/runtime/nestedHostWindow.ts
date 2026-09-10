/**
 * Nested composition slot window. Preview and render use this so a slot
 * `data-playback-start` / `data-playback-rate` shifts descendant media the
 * same way.
 *
 * master = hostStart + (local − inPoint) / hostRate, composed through each
 * host. Visible start/end are clamped to the slot; origin is the unclamped
 * mapped start. Descendant `data-media-start` stays the source-file offset —
 * do not bump it for the host in-point (that shrinks loop periods).
 *
 * Host `data-start` is resolved by the caller (`HostStartResolver`): the
 * runtime and the render pipeline each already own an id-ref resolver, and
 * this module stays free of document access.
 *
 * Identity slots (no in-point, rate 1) report `remaps: false` and
 * `mapNestedMediaElement` returns null for them: the runtime keeps its
 * existing composition-context timing for that case, so this module only
 * takes over when a slot actually re-times its children.
 */

import { MEDIA_START_BASIS_ATTR, readMediaStartBasis } from "../mediaTiming";
import { normalizePlaybackRate, readElementPlaybackRate, readMediaStart } from "./playbackRate";

export type AttrNode = {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  parentElement: AttrNode | null;
};

/**
 * A host's `data-start` in its parent composition's own seconds — numeric or an
 * id-ref to a sibling — never an absolute root time. The window composes the
 * host chain itself; an absolute value would be offset twice.
 */
export type HostStartResolver = (host: AttrNode) => number;

export type NestedHostWindow = {
  /** Master time of child-local t=0. */
  offset: number;
  /** Composed host playback rate: child seconds per master second. */
  rate: number;
  limit: number;
  windowStart: number;
  remaps: boolean;
};

/** The root timeline: no host, nothing shifted. */
export const IDENTITY_HOST_WINDOW: NestedHostWindow = {
  offset: 0,
  rate: 1,
  limit: Infinity,
  windowStart: 0,
  remaps: false,
};

/** The same slot bounds with no shift: for media that keeps its authored root time. */
export function boundsOnly(window: NestedHostWindow): NestedHostWindow {
  return { ...IDENTITY_HOST_WINDOW, limit: window.limit, windowStart: window.windowStart };
}

/**
 * A clip window on the master timeline. `start`/`end` are the visible slot,
 * clamped to the host; a clip that falls outside it is zero-width
 * (`end === start`). `origin` is where local t=0 landed, unclamped.
 */
export type MappedClip = {
  start: number;
  end: number;
  origin: number;
  playbackRate: number;
};

/** A mapped media element; `mediaStart` is its own source-file offset. */
export type MappedMedia = MappedClip & { mediaStart: number };

function parseNum(el: AttrNode, name: string): number | null {
  const raw = el.getAttribute(name);
  if (raw == null || raw === "") return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Authored clip end: `data-end`, else `start + data-duration`, else open. The
 * runtime strips both public attributes from composition hosts and keeps them
 * under `data-hf-authored-*`, so a host is read through either spelling.
 */
function resolveEnd(el: AttrNode, start: number): number | null {
  const end = parseNum(el, "data-end") ?? parseNum(el, "data-hf-authored-end");
  if (end != null) return end;
  const duration = parseNum(el, "data-duration") ?? parseNum(el, "data-hf-authored-duration");
  return duration != null && duration > 0 ? start + duration : null;
}

function isNestedCompositionHost(el: AttrNode): boolean {
  return el.hasAttribute("data-composition-file") || el.hasAttribute("data-composition-src");
}

export function resolveNestedHostWindow(
  element: AttrNode,
  hostStart: HostStartResolver,
): NestedHostWindow | null {
  const hosts: AttrNode[] = [];
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (isNestedCompositionHost(ancestor)) hosts.push(ancestor);
  }
  if (hosts.length === 0) return null;

  let { offset, rate, limit, windowStart, remaps } = IDENTITY_HOST_WINDOW;
  for (const host of hosts.reverse()) {
    const start = hostStart(host);
    const end = resolveEnd(host, start);
    const inPoint = readMediaStart(host);
    const hostRate = readElementPlaybackRate(host);
    if (inPoint > 0 || hostRate !== 1) remaps = true;
    windowStart = Math.max(windowStart, offset + start / rate);
    if (end != null) limit = Math.min(limit, offset + end / rate);
    offset += (start - inPoint / hostRate) / rate;
    rate *= hostRate;
  }
  return { offset, rate, limit, windowStart, remaps };
}

/** Source-file time of a clip at a master-timeline time. Anchored on `origin`, not the clamped `start`. */
export function sourceTimeAt(
  clip: { origin: number; mediaStart: number; playbackRate?: number },
  timelineTime: number,
): number {
  return (
    (timelineTime - clip.origin) * normalizePlaybackRate(clip.playbackRate ?? 1) + clip.mediaStart
  );
}

export function mapClipThroughHostWindow(
  localStart: number,
  localEnd: number,
  window: NestedHostWindow,
  childRate = 1,
): MappedClip {
  const origin = localStart / window.rate + window.offset;
  const start = Math.min(Math.max(origin, window.windowStart), window.limit);
  const end = Math.min(Math.max(localEnd / window.rate + window.offset, start), window.limit);
  return { start, end, origin, playbackRate: window.rate * childRate };
}

/**
 * Null when no slot re-times this element (identity or root timing applies).
 * A nested `data-start` id-ref, and legacy media authored in root time
 * (`data-hf-media-start-basis="global"`), are left to the composition-context
 * resolver.
 */
export function mapNestedMediaElement(
  element: AttrNode,
  hostStart: HostStartResolver,
): MappedMedia | null {
  if (readMediaStartBasis(element.getAttribute(MEDIA_START_BASIS_ATTR)) === "global") return null;
  const window = resolveNestedHostWindow(element, hostStart);
  if (!window?.remaps) return null;
  const localStart = parseNum(element, "data-start");
  if (localStart == null) return null;
  const localEnd = resolveEnd(element, localStart) ?? Infinity;
  return {
    ...mapClipThroughHostWindow(localStart, localEnd, window, readElementPlaybackRate(element)),
    mediaStart: readMediaStart(element),
  };
}

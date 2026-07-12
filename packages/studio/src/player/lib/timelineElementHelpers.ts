/**
 * Low-level helpers for building and identifying TimelineElement objects.
 *
 * Covers: duration reading, media-element metadata extraction, selector/key/
 * identity builders, DOM node lookup, and implicit layer detection. These are
 * intentionally dependency-free (no store, no hooks) so they can be used in
 * both the React hook and test environments.
 */

import type { TimelineElement } from "../store/playerStore";
import type { ClipManifestClip } from "./playbackTypes";
import { isFinitePositive } from "./playbackAdapter";

// ---------------------------------------------------------------------------
// Duration attribute helpers
// ---------------------------------------------------------------------------

function readDurationAttribute(el: Element | null | undefined): number {
  if (!el) return 0;
  const duration =
    Number.parseFloat(el.getAttribute("data-duration") ?? "") ||
    Number.parseFloat(el.getAttribute("data-hf-authored-duration") ?? "");
  return isFinitePositive(duration) ? duration : 0;
}

export function isTimelineIgnoredElement(el: Element): boolean {
  return Boolean(
    el.closest(
      [
        "[data-hyperframes-ignore]",
        "[data-hyperframes-picker-ignore]",
        "[data-hf-ignore]",
        "[data-hf-color-grading-canvas]",
      ].join(","),
    ),
  );
}

export function readTimelineDurationFromDocument(doc: Document | null | undefined): number {
  if (!doc) return 0;
  const rootDuration = readDurationAttribute(doc.querySelector("[data-composition-id]"));
  if (rootDuration > 0) return rootDuration;

  let maxEnd = 0;
  for (const node of Array.from(doc.querySelectorAll("[data-start]"))) {
    if (isTimelineIgnoredElement(node)) continue;
    const start = Number.parseFloat(node.getAttribute("data-start") ?? "");
    const duration = readDurationAttribute(node);
    if (!Number.isFinite(start) || start < 0 || duration <= 0) continue;
    maxEnd = Math.max(maxEnd, start + duration);
  }
  return maxEnd;
}

// ---------------------------------------------------------------------------
// DOM element type guards
// ---------------------------------------------------------------------------

function isHtmlElement(el: Element): el is HTMLElement {
  const HtmlElementCtor = el.ownerDocument.defaultView?.HTMLElement ?? globalThis.HTMLElement;
  return typeof HtmlElementCtor !== "undefined" && el instanceof HtmlElementCtor;
}

export function resolveMediaElement(el: Element): HTMLMediaElement | HTMLImageElement | null {
  const win = el.ownerDocument.defaultView ?? window;
  const MediaElementCtor = win.HTMLMediaElement ?? globalThis.HTMLMediaElement;
  const ImageElementCtor = win.HTMLImageElement ?? globalThis.HTMLImageElement;
  if (el instanceof MediaElementCtor || el instanceof ImageElementCtor) return el;
  const candidate = el.querySelector("video, audio, img");
  return candidate instanceof MediaElementCtor || candidate instanceof ImageElementCtor
    ? candidate
    : null;
}

export function applyMediaMetadataFromElement(entry: TimelineElement, el: Element): void {
  const mediaStartAttr = el.getAttribute("data-playback-start")
    ? "playback-start"
    : el.getAttribute("data-media-start")
      ? "media-start"
      : undefined;
  const mediaStartValue =
    el.getAttribute("data-playback-start") ?? el.getAttribute("data-media-start");
  if (mediaStartValue != null) {
    const playbackStart = parseFloat(mediaStartValue);
    if (Number.isFinite(playbackStart)) entry.playbackStart = playbackStart;
  }
  if (mediaStartAttr) entry.playbackStartAttr = mediaStartAttr;

  const mediaEl = resolveMediaElement(el);
  if (!mediaEl) return;

  entry.tag = mediaEl.tagName.toLowerCase();
  const src = mediaEl.getAttribute("src");
  if (src) entry.src = src;

  const win = mediaEl.ownerDocument.defaultView ?? window;
  const MediaElementCtor = win.HTMLMediaElement ?? globalThis.HTMLMediaElement;
  if (typeof MediaElementCtor === "undefined" || !(mediaEl instanceof MediaElementCtor)) return;

  const sourceDurationAttr =
    el.getAttribute("data-source-duration") ?? mediaEl.getAttribute("data-source-duration");
  const sourceDuration = sourceDurationAttr ? parseFloat(sourceDurationAttr) : mediaEl.duration;
  if (Number.isFinite(sourceDuration) && sourceDuration > 0) {
    entry.sourceDuration = sourceDuration;
  }

  const playbackRate = mediaEl.defaultPlaybackRate;
  if (Number.isFinite(playbackRate) && playbackRate > 0) {
    entry.playbackRate = playbackRate;
  }
}

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

export function getTimelineElementDisplayLabel(input: {
  id?: string | null;
  label?: string | null;
  tag?: string | null;
}): string {
  const label = input.label?.trim();
  if (label) return label;
  const id = input.id?.trim();
  if (id) return id;
  const tag = input.tag?.trim().toLowerCase();
  return tag ? `${tag} clip` : "Timeline clip";
}

const IMPLICIT_TIMELINE_LAYER_SKIP_TAGS = new Set([
  "base",
  "link",
  "meta",
  "noscript",
  "script",
  "style",
  "template",
]);

function humanizeTimelineIdentifier(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function getImplicitTimelineLayerLabel(el: HTMLElement): string {
  const explicitLabel =
    el.getAttribute("data-timeline-label") ??
    el.getAttribute("data-label") ??
    el.getAttribute("aria-label");
  if (explicitLabel?.trim()) return explicitLabel.trim();
  if (el.id.trim()) return humanizeTimelineIdentifier(el.id);
  const classes = el.className.split(/\s+/).filter(Boolean);
  const className = classes.find((value) => value !== "clip") ?? classes[0];
  if (className) return humanizeTimelineIdentifier(className);
  return getTimelineElementDisplayLabel({ tag: el.tagName });
}

// ---------------------------------------------------------------------------
// Selector / identity / key builders
// ---------------------------------------------------------------------------

export function getTimelineElementSelector(el: Element): string | undefined {
  if (isHtmlElement(el) && el.id) return `#${CSS.escape(el.id)}`;
  const compId = el.getAttribute("data-composition-id");
  if (compId) return `[data-composition-id="${CSS.escape(compId)}"]`;
  if (isHtmlElement(el)) {
    const classes = el.className.split(/\s+/).filter(Boolean);
    const firstClass = classes.find((className) => className !== "clip") ?? classes[0];
    if (firstClass) return `.${CSS.escape(firstClass)}`;
  }
  return undefined;
}

export function getTimelineElementSourceFile(el: Element): string | undefined {
  const ownerRoot = el.parentElement?.closest("[data-composition-id]");
  return (
    ownerRoot?.getAttribute("data-composition-file") ??
    ownerRoot?.getAttribute("data-composition-src") ??
    undefined
  );
}

export function getTimelineElementSelectorIndex(
  doc: Document,
  el: Element,
  selector: string | undefined,
): number | undefined {
  if (!selector || selector.startsWith("#") || selector.startsWith("[data-composition-id=")) {
    return undefined;
  }

  try {
    const matches = Array.from(doc.querySelectorAll(selector));
    const matchIndex = matches.indexOf(el);
    return matchIndex >= 0 ? matchIndex : undefined;
  } catch {
    return undefined;
  }
}

export function buildTimelineElementKey(params: {
  id: string;
  fallbackIndex: number;
  domId?: string;
  selector?: string;
  selectorIndex?: number;
  sourceFile?: string;
}): string {
  const scope = params.sourceFile ?? "index.html";
  if (params.domId) return `${scope}#${params.domId}`;
  if (params.selector) return `${scope}:${params.selector}:${params.selectorIndex ?? 0}`;
  return `${scope}:${params.id}:${params.fallbackIndex}`;
}

export function buildTimelineElementIdentity(params: {
  preferredId?: string | null;
  label: string;
  fallbackIndex: number;
  domId?: string;
  selector?: string;
  selectorIndex?: number;
  sourceFile?: string;
}): { id: string; key: string } {
  const id =
    params.preferredId?.trim() ||
    buildTimelineElementKey({
      id: params.label,
      fallbackIndex: params.fallbackIndex,
      domId: params.domId,
      selector: params.selector,
      selectorIndex: params.selectorIndex,
      sourceFile: params.sourceFile,
    });
  const key = buildTimelineElementKey({
    id,
    fallbackIndex: params.fallbackIndex,
    domId: params.domId,
    selector: params.selector,
    selectorIndex: params.selectorIndex,
    sourceFile: params.sourceFile,
  });
  return { id, key };
}

export function getTimelineElementIdentity(element: { key?: string | null; id: string }): string {
  return element.key ?? element.id;
}

// ---------------------------------------------------------------------------
// DOM node querying
// ---------------------------------------------------------------------------

function getTimelineDomNodes(doc: Document): Element[] {
  const rootComp = doc.querySelector("[data-composition-id]");
  return Array.from(doc.querySelectorAll("[data-start]")).filter(
    (node) => node !== rootComp && !isTimelineIgnoredElement(node),
  );
}

function numbersNearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001;
}

function nodeMatchesManifestClip(node: Element, clip: ClipManifestClip): boolean {
  const tagName = clip.tagName?.toLowerCase();
  if (tagName && node.tagName.toLowerCase() !== tagName) return false;

  const start = Number.parseFloat(node.getAttribute("data-start") ?? "");
  if (Number.isFinite(start) && !numbersNearlyEqual(start, clip.start)) return false;

  const duration = Number.parseFloat(node.getAttribute("data-duration") ?? "");
  if (Number.isFinite(duration) && !numbersNearlyEqual(duration, clip.duration)) return false;

  const track = Number.parseInt(node.getAttribute("data-track-index") ?? "", 10);
  if (Number.isFinite(track) && track !== clip.track) return false;

  return true;
}

function findTimelineDomNode(doc: Document, id: string): Element | null {
  return (
    doc.getElementById(id) ??
    doc.querySelector(`[data-composition-id="${CSS.escape(id)}"]`) ??
    doc.querySelector(`.${CSS.escape(id)}`) ??
    null
  );
}

export function findTimelineDomNodeForClip(
  doc: Document,
  clip: ClipManifestClip,
  fallbackIndex: number,
  usedNodes = new Set<Element>(),
): Element | null {
  const byIdentity = clip.id ? findTimelineDomNode(doc, clip.id) : null;
  if (byIdentity && !usedNodes.has(byIdentity)) return byIdentity;

  const candidates = getTimelineDomNodes(doc).filter((node) => !usedNodes.has(node));
  const exact = candidates.find((node) => nodeMatchesManifestClip(node, clip));
  if (exact) return exact;

  return candidates[fallbackIndex] ?? null;
}

// ---------------------------------------------------------------------------
// Implicit layer detection
// ---------------------------------------------------------------------------

export function isImplicitTimelineLayerCandidate(root: Element, el: Element): el is HTMLElement {
  if (!isHtmlElement(el)) return false;
  if (isTimelineIgnoredElement(el)) return false;
  if (el.parentElement !== root) return false;
  const tagName = el.tagName.toLowerCase();
  if (IMPLICIT_TIMELINE_LAYER_SKIP_TAGS.has(tagName)) return false;
  if (el.hasAttribute("data-start") || el.hasAttribute("data-track-index")) return false;
  return Boolean(getTimelineElementSelector(el));
}

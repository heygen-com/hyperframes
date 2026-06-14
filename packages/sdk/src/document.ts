/**
 * SDK document model — adaptation layer on top of @hyperframes/core.
 *
 * F6 decision: SDK builds ON core, no parser duplication.
 * - ensureHfIds (from core) is the parse entry point: all construction starts here.
 * - DOMParser is NOT used (browser-only). linkedom is the node-safe primitive.
 * - ParsedHtml (core) is the Studio timeline view (timed elements only).
 *   HyperFramesElement is the editing view (ALL editable elements, with raw attrs).
 */

import { parseHTML } from "linkedom";
import { ensureHfIds } from "@hyperframes/core/hf-ids";
import { findRoot, getElementStyles, isNewHostBoundary } from "./engine/model.js";
import type { HyperFramesElement, SdkDocument } from "./types.js";

// Tags that carry no editable content and must not enter the element tree.
const EXCLUDED_TAGS = new Set([
  "script",
  "style",
  "template",
  "meta",
  "link",
  "noscript",
  "base",
  "head",
]);

// Snapshot text is TRIMMED for display (markup indentation produces noisy
// whitespace text nodes). setText writes verbatim — engine getOwnText/setOwnText
// operate on raw text. el.text is a display value, not a round-trip identity.
function ownText(el: Element): string | null {
  let text = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) text += (n as Text).nodeValue ?? "";
  });
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// fallow-ignore-next-line complexity
function buildElement(el: Element, scopePrefix: string): HyperFramesElement | null {
  const tag = el.tagName.toLowerCase();
  if (EXCLUDED_TAGS.has(tag)) return null;

  const id = el.getAttribute("data-hf-id") ?? "";
  if (!id) return null; // should never happen after ensureHfIds, but guard defensively

  // scopedId: if we're inside a sub-comp scope, prefix with "scopePrefix/".
  // The host element itself is in the PARENT scope (no prefix change for its own id).
  const scopedId = scopePrefix ? `${scopePrefix}/${id}` : id;

  // Children inherit the scope prefix from their parent.
  // If this element is a new host boundary (starts a new sub-comp scope), its
  // children use THIS element's scopedId as their prefix.
  // Otherwise, children inherit the same prefix that this element used.
  const childPrefix = isNewHostBoundary(el) ? scopedId : scopePrefix;

  const inlineStyles = getElementStyles(el);

  const classAttr = el.getAttribute("class") ?? "";
  const classNames = classAttr
    .split(/\s+/)
    .map((c) => c.trim())
    .filter(Boolean);

  const attributes: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === "style" || attr.name === "class" || attr.name.startsWith("data-hf-")) {
      continue;
    }
    attributes[attr.name] = attr.value;
  }

  const startAttr = el.getAttribute("data-start");
  const endAttr = el.getAttribute("data-end");
  const trackAttr = el.getAttribute("data-track-index");

  const start = startAttr !== null ? parseFloat(startAttr) : null;
  const duration =
    start !== null && endAttr !== null ? Math.max(0, parseFloat(endAttr) - start) : null;
  const trackIndex = trackAttr !== null ? parseInt(trackAttr, 10) : null;

  const children: HyperFramesElement[] = [];
  for (const child of Array.from(el.children)) {
    const built = buildElement(child, childPrefix);
    if (built) children.push(built);
  }

  return {
    id,
    scopedId,
    tag,
    children,
    inlineStyles,
    classNames,
    attributes,
    text: ownText(el),
    start,
    duration,
    trackIndex,
    animationIds: [],
  };
}

// fallow-ignore-next-line complexity
function extractGsapScript(doc: Document): string | null {
  // GSAP script is the first <script> tag whose text references gsap
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    const text = script.textContent ?? "";
    if (text.includes("gsap") || text.includes("ScrollTrigger")) {
      return text;
    }
  }
  return null;
}

function extractStyles(doc: Document): string | null {
  const styleEl = doc.querySelector("style");
  return styleEl ? styleEl.textContent : null;
}

// Root resolution delegates to the engine's findRoot so dimension extraction
// and mutations agree on which element is the composition root.
// fallow-ignore-next-line complexity
function extractDimensions(doc: Document): { width: number | null; height: number | null } {
  const stage = findRoot(doc);
  if (!stage) return { width: null, height: null };
  // data-width/data-height are the runtime's forced override — prefer them.
  const wAttr = stage.getAttribute("data-width");
  const hAttr = stage.getAttribute("data-height");
  const style = (stage as HTMLElement).getAttribute?.("style") ?? "";
  const wm = /width:\s*(\d+)px/.exec(style);
  const hm = /height:\s*(\d+)px/.exec(style);
  return {
    width: wAttr !== null ? parseInt(wAttr, 10) : wm ? parseInt(wm[1] ?? "", 10) : null,
    height: hAttr !== null ? parseInt(hAttr, 10) : hm ? parseInt(hm[1] ?? "", 10) : null,
  };
}

function extractDuration(doc: Document): number | null {
  const root = findRoot(doc) ?? doc.body;
  const dur = root?.getAttribute("data-duration");
  return dur ? parseFloat(dur) : null;
}

/**
 * Build the element tree from an already-parsed (hf-id-stamped) linkedom Document.
 * Walks the live DOM directly — no serialize/re-parse round trip. This is what
 * the session's query API uses against its mutable document.
 */
export function buildRoots(document: Document): HyperFramesElement[] {
  const body = document.body;
  const roots: HyperFramesElement[] = [];
  if (body) {
    for (const child of Array.from(body.children)) {
      const built = buildElement(child, "");
      if (built) roots.push(built);
    }
  }
  return roots;
}

/**
 * Parse an HTML string into the SDK document model.
 * Calls ensureHfIds first so every element has a stable data-hf-id.
 * Uses linkedom — node-safe (works in agents, CI, server-side).
 */
export function buildDocument(html: string): SdkDocument {
  const stamped = ensureHfIds(html);

  const hasShell = /<!doctype|<html[\s>]/i.test(stamped);
  const wrapped = !hasShell;
  const { document } = wrapped
    ? parseHTML(`<!DOCTYPE html><html><head></head><body>${stamped}</body></html>`)
    : parseHTML(stamped);

  const dims = extractDimensions(document);

  return {
    roots: buildRoots(document),
    gsapScript: extractGsapScript(document),
    styles: extractStyles(document),
    width: dims.width,
    height: dims.height,
    compositionDuration: extractDuration(document),
    html: stamped,
  };
}

/** Flat walk of the element tree — returns every element in document order */
export function flatElements(roots: readonly HyperFramesElement[]): HyperFramesElement[] {
  const result: HyperFramesElement[] = [];
  function walk(el: HyperFramesElement) {
    result.push(el);
    for (const child of el.children) walk(child);
  }
  for (const root of roots) walk(root);
  return result;
}

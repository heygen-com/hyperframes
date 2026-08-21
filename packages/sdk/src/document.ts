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
import { ensureHfIds, isCompositionTemplate } from "@hyperframes/parsers/hf-ids";
import { parseGsapScriptAcornForWrite } from "@hyperframes/core/gsap-parser-acorn";
import {
  findRoot,
  getElementStyles,
  getGsapScripts,
  getOwnText,
  isNewHostBoundary,
  querySelectorAllDeep,
} from "./engine/model.js";
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
// whitespace text nodes). The raw text target is shared with setText so shadow
// value checks and dispatch serialization use the same DOM target.
function snapshotText(el: Element): string | null {
  const trimmed = getOwnText(el).trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Parsing the GSAP script (acorn AST walk) is the expensive part and depends
// only on the script text, so memoize the {tween id, selector} pairs by script.
// Selector→hf-id resolution still runs each call — it depends on the live DOM,
// which changes on dispatch. Single-entry cache covers the hot path (same comp,
// repeated getElements() rebuilds) and stays bounded.
let gsapLocatedCacheKey: string | null = null;
let gsapLocatedCacheVal: Array<{ id: string; selector: string }> = [];

function parseLocatedCached(script: string): Array<{ id: string; selector: string }> {
  if (gsapLocatedCacheKey === script) return gsapLocatedCacheVal;
  const parsed = parseGsapScriptAcornForWrite(script);
  gsapLocatedCacheVal = parsed
    ? parsed.located.map(({ id, animation }) => ({ id, selector: animation.targetSelector }))
    : [];
  gsapLocatedCacheKey = script;
  return gsapLocatedCacheVal;
}

/**
 * Map each element's data-hf-id → the GSAP tween ids targeting it. Tween ids
 * come from the acorn parser's stable `targetSelector-method-position` scheme —
 * the SAME id-space the studio-api read path and the SDK GSAP ops use, so these
 * ids are dispatchable as-is via setGsapTween/removeGsapTween. Best-effort: a
 * malformed selector or unparseable script yields no entries (animationIds: []).
 */
function buildAnimationIdMap(document: Document): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const script of getGsapScripts(document)) {
    for (const { id, selector } of parseLocatedCached(script)) {
      appendAnimationIdsForSelector(map, document, id, selector);
    }
  }
  return map;
}

function appendAnimationIdsForSelector(
  map: Map<string, string[]>,
  document: Document,
  animationId: string,
  selector: string,
): void {
  if (!selector) return;

  let matches: Element[];
  try {
    matches = querySelectorAllDeep(document, selector);
  } catch {
    return; // selector not valid for querySelectorAll — skip
  }

  for (const el of matches) {
    const hfId = el.getAttribute("data-hf-id");
    if (!hfId) continue;
    const list = map.get(hfId);
    if (list) list.push(animationId);
    else map.set(hfId, [animationId]);
  }
}

/**
 * Every GSAP tween id `parseLocatedCached` finds in the script, with no DOM
 * matching at all — the same id space the server-side script ops
 * (removeAllKeyframesFromScript et al.) resolve against. Unlike
 * buildAnimationIdMap's per-element map, this never drops an id just because
 * its selector doesn't currently CSS-match a live element — that gap is what
 * caused a false animation_not_found divergence in the resolver-shadow
 * tripwire (a tween on a renamed/duplicate/scoped selector still resolves on
 * the server, which reads the script directly).
 */
export function parsedAnimationIds(script: string): Set<string> {
  return new Set(parseLocatedCached(script).map(({ id }) => id));
}

/**
 * Build the element list for a parent's children, treating a COMPOSITION
 * template (`<template data-composition-id>`) as a TRANSPARENT container: its
 * inner elements are spliced in at the template's position, the template
 * itself gets no node. This mirrors the studio preview, which unwraps exactly
 * that pattern into the served body — so template-based sub-comps expose the
 * same elements (and hf-ids) here as the timeline reads from the live preview
 * DOM. A plain <template> (runtime clone-source) stays fully excluded: its
 * inert interior is not editable and its content is duplicated at runtime.
 */
function buildChildren(
  parent: Element,
  scopePrefix: string,
  animationIdsByHfId: Map<string, string[]>,
): HyperFramesElement[] {
  const out: HyperFramesElement[] = [];
  for (const child of Array.from(parent.children)) {
    if (child.tagName.toLowerCase() === "template") {
      if (isCompositionTemplate(child)) {
        out.push(...buildChildren(child, scopePrefix, animationIdsByHfId));
      }
      continue;
    }
    const built = buildElement(child, scopePrefix, animationIdsByHfId);
    if (built) out.push(built);
  }
  return out;
}

// fallow-ignore-next-line complexity
function buildElement(
  el: Element,
  scopePrefix: string,
  animationIdsByHfId: Map<string, string[]>,
): HyperFramesElement | null {
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

  const children = buildChildren(el, childPrefix, animationIdsByHfId);

  return {
    id,
    scopedId,
    tag,
    children,
    inlineStyles,
    classNames,
    attributes,
    text: snapshotText(el),
    start,
    duration,
    trackIndex,
    animationIds: animationIdsByHfId.get(id) ?? [],
  };
}

// fallow-ignore-next-line complexity
function extractGsapScript(doc: Document): string | null {
  return getGsapScripts(doc)[0] ?? null;
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
  if (!body) return [];
  return buildChildren(body, "", buildAnimationIdMap(document));
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

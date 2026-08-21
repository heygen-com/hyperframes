/**
 * Stable hf- element id minting (R1). Node-safe (linkedom only, not browser DOM).
 *
 * Two surfaces share these helpers:
 *  - ensureHfIds(html): node-id surface — mints data-hf-id on every element.
 *  - mintHfId(el, assigned): shared by htmlParser for clip ids.
 *
 * Hash is CONTENT ONLY (tag + sorted attrs + own text) — no sibling position,
 * so inserting a non-identical sibling never shifts another element's id.
 */
import { parseHTML } from "linkedom";

// Non-editable / non-visual elements that should never receive a stable id.
export const EXCLUDED_TAGS = new Set([
  "script",
  "style",
  "template",
  "meta",
  "link",
  "noscript",
  "base",
]);

// 32-bit FNV-1a. Pure, deterministic, no crypto, no Math.random.
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// 4 base-36 chars · 36^4 ≈ 1.68M ids per document. Birthday-paradox collision
// ≈ N²/(2·36^4): well under 1% per document after dup rehash at realistic
// clip-model sizes (≤ a few hundred elements). The dup-rehash in mintHfId
// resolves the rare collision; width is deliberately small for readable ids.
function toHfId(hash: number): string {
  const s = (hash >>> 0).toString(36);
  // Use suffix (most-avalanched bits) for better distribution within the 4-char window.
  const four = s.length >= 4 ? s.slice(-4) : s.padStart(4, "0");
  return `hf-${four}`;
}

// Element's own direct text (TEXT_NODE children), not descendants'.
function ownText(el: Element): string {
  let text = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) text += (n as Text).nodeValue ?? "";
  });
  return text.trim();
}

function contentKey(el: Element): string {
  // Exclude all data-hf-* attrs (ids, studio state) — they must not influence the hash.
  // Use \x00 / \x01 separators (invalid in HTML attrs) to prevent ambiguous serialization.
  const attrs = Array.from(el.attributes)
    .filter((a) => !a.name.startsWith("data-hf-"))
    .map((a) => `${a.name}\x00${a.value}`)
    .sort()
    .join("\x01");
  return `${el.tagName.toLowerCase()}|${attrs}|${ownText(el)}`;
}

/**
 * Collision tiebreak for byte-identical siblings: document-order dup counter
 * (`hash(key#N)`). This IS order-dependent — two identical `<span></span>`
 * get different ids based on which comes first in the DOM. This is unavoidable:
 * unique ids for byte-identical elements require a positional signal.
 *
 * Why this is safe in practice: once `ensureHfIds` write-back persists
 * `data-hf-id` to source the attribute is physically bound to its element.
 * Reordering identical siblings carries the attribute along → zero
 * order-dependence post-persist. `ensureHfIds` skips pinned elements
 * (`if (el.getAttribute("data-hf-id")) continue`), so normal operation
 * never re-exposes the ordering after first persist.
 */
// WIRE CONTRACT: id minting is content-keyed (FNV1a of innerHTML + tag). R7's
// preview route relies on mintHfId producing identical ids across mint contexts
// (disk-persist pass vs. in-memory bundle pass) — see preview.test.ts
// "bundle returning untagged HTML gets same ids as disk". Any change that adds
// positional, session, or random input to the hash breaks that invariant and
// makes hf- ids diverge between disk and served HTML, silently corrupting
// drag-to-edit targeting.
export function mintHfId(el: Element, assigned: Set<string>): string {
  const key = contentKey(el);
  let id = toHfId(fnv1a(key));
  let dup = 0;
  while (assigned.has(id)) {
    dup += 1;
    // Graceful fallback instead of a hard throw: rehashing only fails to find a
    // free 4-char slot in a pathological document (~1.6M identical elements).
    // Rather than crash the whole parse, widen the id with the dup counter —
    // still deterministic and unique, just longer than the 4-char norm.
    if (dup > 10000) {
      id = `hf-${(fnv1a(key) >>> 0).toString(36)}-${dup}`;
      break;
    }
    id = toHfId(fnv1a(`${key}#${dup}`));
  }
  assigned.add(id);
  return id;
}

/**
 * True for a sub-composition authoring template whose content the studio preview
 * unwraps into the served body. Two accepted forms:
 *   A) `<template data-composition-id="X">…` — the id on the template itself.
 *   B) `<template id="X-template"><div data-composition-id="X">…` — the id on the
 *      wrapped root div (the form `hyperframes add` scaffolds and registry blocks use).
 * Only these are treated as transparent containers for hf-id purposes. A plain
 * `<template>` (runtime clone-source: list item, particle, etc.) must NOT get
 * inner ids — its content is cloned N times into the live DOM, so a persisted
 * inner id would be duplicated across every clone. Form B is distinguished from
 * a clone-source by the presence of a direct `[data-composition-id]` child.
 */
function getChildElements(parent: Element): Element[] {
  const directChildren = Array.from(parent.children);
  if (directChildren.length || parent.tagName.toLowerCase() !== "template") return directChildren;
  const content = (parent as HTMLTemplateElement).content;
  if (content?.children.length) return Array.from(content.children);
  return directChildren;
}

export function isCompositionTemplate(el: Element): boolean {
  if (el.tagName.toLowerCase() !== "template") return false;
  if (el.getAttribute("data-composition-id") !== null) return true;
  for (const child of getChildElements(el)) {
    if (child.getAttribute("data-composition-id") !== null) return true;
  }
  return false;
}

/**
 * Walk document-order descendants, descending through composition templates
 * while keeping plain templates inert. linkedom's querySelectorAll does not
 * expose template contents, so callers that model the served composition use
 * this traversal instead.
 */
export function walkCompositionDescendants(
  root: Document | Element,
  visit: (el: Element) => void,
): void {
  const rootElement: Element | null =
    root.nodeType === 9 ? (root as Document).documentElement : (root as Element);
  if (!rootElement) return;

  const walk = (parent: Element): void => {
    for (const child of getChildElements(parent)) {
      const isTemplate = child.tagName.toLowerCase() === "template";
      if (isTemplate && !isCompositionTemplate(child)) continue;
      visit(child);
      walk(child);
    }
  };

  walk(rootElement);
}

/**
 * Document-order walk of every element under `root`, descending into
 * composition `<template>` subtrees — linkedom's querySelectorAll does not, so
 * template-based sub-comps would otherwise never get inner ids (the preview
 * unwraps the template and stamps the SAME content, so skipping here splits
 * the id space between the served DOM and the raw file). Plain templates are
 * skipped entirely (see isCompositionTemplate).
 */
function walkElements(root: Element, visit: (el: Element) => void): void {
  walkCompositionDescendants(root, visit);
}

export function ensureHfIds(html: string): string {
  // Mirror parseSourceDocument's fragment-wrapping so bare fragments don't land
  // outside <body> in linkedom, which would cause body.querySelectorAll to return [].
  const hasDocumentShell = /<!doctype|<html[\s>]/i.test(html);
  const wrapped = !hasDocumentShell;
  const { document } = wrapped
    ? parseHTML(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`)
    : parseHTML(html);
  const body = document.body;
  if (!body) return html;

  const assigned = new Set<string>();
  // Seed with already-present ids (pin) so fresh mints never collide with them.
  // Scope to <body> to match the mint walk below — a stray data-hf-id in <head>
  // must not pin an id into the set that a body element would then be bumped off.
  walkElements(body, (el) => {
    const existing = el.getAttribute("data-hf-id");
    if (existing) assigned.add(existing);
  });

  walkElements(body, (el) => {
    if (EXCLUDED_TAGS.has(el.tagName.toLowerCase())) return;
    if (el.getAttribute("data-hf-id")) return; // pinned
    el.setAttribute("data-hf-id", mintHfId(el, assigned));
  });

  return wrapped ? document.body.innerHTML || "" : document.toString();
}

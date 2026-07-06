/**
 * Mutable document — linkedom Document wrapper for Phase 3 editing.
 *
 * The linkedom Document IS the mutable backing store. All dispatch mutations
 * go here. serialize() walks the live DOM; no separate mutable tree to sync.
 */

import { parseHTML } from "linkedom";
import { ensureHfIds } from "@hyperframes/core/hf-ids";

export interface ParsedDocument {
  document: Document;
  /** True when the input was a fragment (no <html> shell) and was wrapped. */
  wrapped: boolean;
  /** ensureHfIds-stamped original HTML — used as fallback / diff base. */
  stamped: string;
}

export function parseMutable(html: string): ParsedDocument {
  const stamped = ensureHfIds(html);
  const hasShell = /<!doctype|<html[\s>]/i.test(stamped);
  const wrapped = !hasShell;
  const { document } = wrapped
    ? parseHTML(`<!DOCTYPE html><html><head></head><body>${stamped}</body></html>`)
    : parseHTML(stamped);
  return { document: document as unknown as Document, wrapped, stamped };
}

// ─── Element lookup ───────────────────────────────────────────────────────────

export function findById(document: Document, id: string): Element | null {
  // Delegate to resolveScoped so patch replay (undo/redo, override-set apply)
  // resolves an id the SAME way forward dispatch does: canonical-first for an
  // ambiguous bare id, and scoped-path ("hf-host/hf-leaf") aware. Otherwise the
  // two paths disagree on which duplicate a bare id targets and undo reverts the
  // wrong element. (function declaration is hoisted.)
  return resolveScoped(document, id);
}

export function escapeHfId(id: string): string {
  return id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * querySelectorAll that also descends into COMPOSITION `<template>` subtrees
 * (`data-composition-id` — the pattern the studio preview unwraps) — linkedom's
 * querySelectorAll does not, so template-based sub-comp content would be
 * unreachable for resolution/dispatch even though buildRoots models it.
 *
 * Implemented as a document-order DOM walk (not qsa + append) so duplicate-id
 * tiebreaks resolve in TRUE document order — appending template matches after
 * all top-level matches would make resolveScoped pick a different duplicate
 * than the preview's unwrapped DOM does. Plain templates (runtime clone
 * sources) are skipped, matching buildChildren and ensureHfIds.
 *
 * Throws like querySelectorAll on an invalid selector (Element.matches).
 */
export function querySelectorAllDeep(root: Document | Element, selector: string): Element[] {
  const out: Element[] = [];
  const start: Element | null =
    "body" in root ? ((root as Document).body ?? null) : (root as Element);
  const walk = (parent: Element): void => {
    for (const child of Array.from(parent.children)) {
      if (child.tagName.toLowerCase() === "template") {
        if (child.getAttribute("data-composition-id") !== null) walk(child);
        continue;
      }
      if (child.matches(selector)) out.push(child);
      walk(child);
    }
  };
  if (start) {
    // When rooted at an Element (scoped-path step), the root itself is the
    // context, not a candidate — only descendants match, like querySelectorAll.
    walk(start);
  }
  return out;
}

/**
 * True when an element lives at the top-level (canonical) scope — i.e. its
 * scopedId equals its bare id because no ancestor opens a sub-composition
 * boundary. This mirrors document.ts's scopedId construction (childPrefix only
 * changes at isNewHostBoundary elements) without rebuilding the snapshot tree.
 */
function isCanonicalScope(el: Element): boolean {
  for (let cur = el.parentElement; cur; cur = cur.parentElement) {
    if (isNewHostBoundary(cur)) return false;
  }
  return true;
}

/**
 * Resolve a bare or scoped hf-id to its DOM element.
 *
 * Bare id ("hf-x"): top-level document search. When the bare id is ambiguous
 * (duplicated across a sub-composition and the top level), prefer the canonical
 * (top-level) instance — the one whose scopedId equals the bare id — falling
 * back to document order when no canonical match exists. This matches
 * getElement()'s resolution rule so removeElement / getElement agree on which
 * instance an ambiguous bare id targets.
 *
 * Scoped id ("hf-HOST/hf-LEAF", any depth): each segment narrows the search
 * into the subtree of the previous match. This unambiguously addresses an
 * element inside a sub-composition even when bare ids collide.
 */
export function resolveScoped(document: Document, id: string): Element | null {
  const parts = id.split("/");

  // Bare id: prefer the canonical (top-level) match when one exists, so
  // resolution agrees with getElement (scopedId === id wins over document order).
  if (parts.length === 1) {
    const escaped = escapeHfId(id);
    const matches = querySelectorAllDeep(document, `[data-hf-id="${escaped}"]`);
    if (matches.length > 0) {
      return matches.find((el) => isCanonicalScope(el)) ?? matches[0] ?? null;
    }
    // Fall back to a sub-composition ROOT addressed by its composition id. A
    // host element carries data-hf-id (its own leaf id) AND data-composition-id
    // (the id studio passes when targeting the sub-comp root). data-hf-id takes
    // precedence above; only when no hf-id matches do we treat the bare id as a
    // composition id, making comp-ids first-class resolvable addresses.
    return querySelectorAllDeep(document, `[data-composition-id="${escaped}"]`)[0] ?? null;
  }

  let context: Element | Document = document;
  for (const part of parts) {
    const escaped = escapeHfId(part);
    const found: Element | null =
      querySelectorAllDeep(context, `[data-hf-id="${escaped}"]`)[0] ?? null;
    if (!found) return null;
    context = found;
  }
  return context as Element;
}

/**
 * Returns true when this element starts a new sub-composition scope — i.e. it
 * is a host element (has data-composition-file) and is NOT the outerHTML
 * innerRoot of the SAME sub-composition (same dcf value as parent).
 *
 * outerHTML case: both host and innerRoot carry data-composition-file="sub.html".
 * The innerRoot has the SAME value as the host (its parent) → not a new boundary.
 * A genuine nested host inside a sub-comp has a DIFFERENT dcf value.
 */
export function isNewHostBoundary(el: Element): boolean {
  const dcf = el.getAttribute("data-composition-file");
  if (!dcf) return false;
  const parentDcf = el.parentElement?.getAttribute("data-composition-file") ?? null;
  return dcf !== parentDcf;
}

export function findRoot(document: Document): Element | null {
  return (
    document.querySelector("[data-hf-root]") ??
    document.getElementById("stage") ??
    document.body?.firstElementChild ??
    null
  );
}

// ─── Inline style helpers ─────────────────────────────────────────────────────

export function toCamel(prop: string): string {
  if (prop.startsWith("--")) return prop;
  return prop.replace(/-([a-z])/g, (_, c: string) => (c as string).toUpperCase());
}

function toKebab(prop: string): string {
  if (prop.startsWith("--")) return prop;
  return prop.replace(/([A-Z])/g, (c) => `-${c.toLowerCase()}`);
}

/** Parse style attribute string → camelCase map (custom props kept as-is). */
interface StyleDeclarationScan {
  depth: number;
  quote: "'" | '"' | null;
  skip: boolean;
}

function advanceStyleDeclarationScan(scan: StyleDeclarationScan, ch: string, next: string): void {
  if (scan.quote) {
    if (ch === "\\" && next) {
      scan.skip = true;
      return;
    }
    if (ch === scan.quote) scan.quote = null;
    return;
  }
  if (ch === "'" || ch === '"') {
    scan.quote = ch;
    return;
  }
  if (ch === "(") scan.depth++;
  else if (ch === ")") scan.depth = Math.max(0, scan.depth - 1);
}

function splitStyleDeclarations(style: string): string[] {
  const declarations: string[] = [];
  const scan: StyleDeclarationScan = { depth: 0, quote: null, skip: false };
  let start = 0;
  for (let i = 0; i < style.length; i++) {
    if (scan.skip) {
      scan.skip = false;
      continue;
    }
    const ch = style[i] ?? "";
    if (ch === ";" && scan.depth === 0 && scan.quote === null) {
      declarations.push(style.slice(start, i));
      start = i + 1;
    } else {
      advanceStyleDeclarationScan(scan, ch, style[i + 1] ?? "");
    }
  }
  declarations.push(style.slice(start));
  return declarations;
}

function parseStyleAttr(styleAttr: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const decl of splitStyleDeclarations(styleAttr)) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const rawProp = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (!rawProp) continue;
    result[toCamel(rawProp)] = value;
  }
  return result;
}

/** Serialize camelCase style map → style attribute string. */
function serializeStyleAttr(styles: Record<string, string>): string {
  return Object.entries(styles)
    .map(([k, v]) => `${toKebab(k)}: ${v}`)
    .join("; ");
}

export function getElementStyles(el: Element): Record<string, string> {
  const attr = el.getAttribute("style") ?? "";
  return parseStyleAttr(attr);
}

export function setElementStyles(el: Element, updates: Record<string, string | null>): void {
  const current = getElementStyles(el);
  for (const [prop, value] of Object.entries(updates)) {
    // Stored map is keyed camelCase (parseStyleAttr); custom props (--foo) stay
    // verbatim. Normalize the incoming key the same way for both set and delete.
    const key = toCamel(prop);
    if (value === null) {
      delete current[key];
    } else {
      current[key] = value;
    }
  }
  const serialized = serializeStyleAttr(current);
  if (serialized) {
    el.setAttribute("style", serialized);
  } else {
    el.removeAttribute("style");
  }
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

function isHTMLElementTarget(el: Element): boolean {
  const HTMLElementCtor = el.ownerDocument.defaultView?.HTMLElement;
  if (HTMLElementCtor) return el instanceof HTMLElementCtor;
  return "style" in el;
}

function resolveSingleChildTextTarget(el: Element): Element | null {
  const inner = el.children.length === 1 ? el.firstElementChild : null;
  return inner && isHTMLElementTarget(inner) ? inner : null;
}

/** Read the text target used by SDK setText. */
export function getOwnText(el: Element): string {
  const singleChild = resolveSingleChildTextTarget(el);
  if (singleChild) return singleChild.textContent ?? "";
  let text = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) text += (n as Text).nodeValue ?? "";
  });
  return text;
}

/** Replace the SDK text target without destroying multi-child element structure. */
export function setOwnText(el: Element, text: string): void {
  const singleChild = resolveSingleChildTextTarget(el);
  if (singleChild) {
    singleChild.textContent = text;
    return;
  }

  const doc = el.ownerDocument;
  const children = Array.from(el.childNodes);
  // Track original position of the first text node so we restore there, not at firstChild.
  let firstTextIdx = -1;
  for (let i = 0; i < children.length; i++) {
    if (children[i]?.nodeType === 3) {
      firstTextIdx = i;
      break;
    }
  }
  for (const child of children) {
    if (child.nodeType === 3) el.removeChild(child);
  }
  if (text) {
    // No text nodes before firstTextIdx (it's the first one), so index is stable.
    const current = Array.from(el.childNodes);
    const ref = firstTextIdx >= 0 ? (current[firstTextIdx] ?? null) : null;
    el.insertBefore(doc.createTextNode(text), ref);
  }
}

// ─── CSS style helpers ────────────────────────────────────────────────────────

function findStyleElement(document: Document): Element | null {
  return document.querySelector("style") as unknown as Element | null;
}

export function getStyleSheet(document: Document): string {
  return findStyleElement(document)?.textContent ?? "";
}

export function setStyleSheet(document: Document, css: string): void {
  const existing = findStyleElement(document);
  if (!css) {
    existing?.remove();
    return;
  }
  let el = existing;
  if (!el) {
    el = document.createElement("style") as unknown as Element;
    const head =
      (document.querySelector("head") as unknown as Element | null) ??
      (document.body as unknown as Element);
    (head as any).appendChild(el);
  }
  el.textContent = css;
}

// ─── GSAP script helpers ──────────────────────────────────────────────────────

function findGsapScriptElement(document: Document): Element | null {
  const scripts = document.querySelectorAll("script");
  for (const script of Array.from(scripts)) {
    const text = script.textContent ?? "";
    if (text.includes("gsap") || text.includes("ScrollTrigger"))
      return script as unknown as Element;
  }
  return null;
}

export function getGsapScript(document: Document): string | null {
  const el = findGsapScriptElement(document);
  return el ? (el.textContent ?? "") : null;
}

export function setGsapScript(document: Document, newScript: string): void {
  const existing = findGsapScriptElement(document);
  if (!newScript) {
    existing?.remove();
    return;
  }
  let el = existing;
  if (!el) {
    el = document.createElement("script") as unknown as Element;
    const head =
      (document.querySelector("head") as unknown as Element | null) ??
      (document.body as unknown as Element);
    (head as any).appendChild(el);
  }
  el.textContent = newScript;
}

// ─── Sibling index ────────────────────────────────────────────────────────────

export function getSiblingIndex(el: Element): number {
  const parent = el.parentElement;
  if (!parent) return 0;
  return Array.from(parent.children).indexOf(el);
}

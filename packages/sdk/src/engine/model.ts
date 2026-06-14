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
  // CSS.escape is browser-only; hf-ids are restricted identifiers so simple quote-escaping is safe.
  const escaped = id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return document.querySelector(`[data-hf-id="${escaped}"]`);
}

function escapeHfId(id: string): string {
  return id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Resolve a bare or scoped hf-id to its DOM element.
 *
 * Bare id ("hf-x"): equivalent to findById — top-level document search.
 * Scoped id ("hf-HOST/hf-LEAF", any depth): each segment narrows the search
 * into the subtree of the previous match. This unambiguously addresses an
 * element inside a sub-composition even when bare ids collide.
 */
export function resolveScoped(document: Document, id: string): Element | null {
  const parts = id.split("/");
  let context: Element | Document = document;
  for (const part of parts) {
    const escaped = escapeHfId(part);
    const found: Element | null =
      context === document
        ? (context as Document).querySelector(`[data-hf-id="${escaped}"]`)
        : (context as Element).querySelector(`[data-hf-id="${escaped}"]`);
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

function toCamel(prop: string): string {
  if (prop.startsWith("--")) return prop;
  return prop.replace(/-([a-z])/g, (_, c: string) => (c as string).toUpperCase());
}

function toKebab(prop: string): string {
  if (prop.startsWith("--")) return prop;
  return prop.replace(/([A-Z])/g, (c) => `-${c.toLowerCase()}`);
}

/** Parse style attribute string → camelCase map (custom props kept as-is). */
function parseStyleAttr(styleAttr: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const decl of styleAttr.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const rawProp = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (!rawProp || !value) continue;
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
    if (value === null) {
      delete current[prop];
    } else {
      current[prop] = value;
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

/** Read only direct (non-descendant) text node content. */
export function getOwnText(el: Element): string {
  let text = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) text += (n as Text).nodeValue ?? "";
  });
  return text;
}

/** Replace only direct text nodes — preserves child elements. */
export function setOwnText(el: Element, text: string): void {
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

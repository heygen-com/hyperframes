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

// ─── Sibling index ────────────────────────────────────────────────────────────

export function getSiblingIndex(el: Element): number {
  const parent = el.parentElement;
  if (!parent) return 0;
  return Array.from(parent.children).indexOf(el);
}

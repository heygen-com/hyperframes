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
const EXCLUDED_TAGS = new Set(["script", "style", "template", "meta", "link", "noscript", "base"]);

// 32-bit FNV-1a. Pure, deterministic, no crypto, no Math.random.
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

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

export function mintHfId(el: Element, assigned: Set<string>): string {
  const key = contentKey(el);
  let id = toHfId(fnv1a(key));
  let dup = 0;
  while (assigned.has(id)) {
    if (dup > 1000) throw new Error("ensureHfIds: hash collision limit exceeded");
    dup += 1;
    id = toHfId(fnv1a(`${key}#${dup}`));
  }
  assigned.add(id);
  return id;
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
  for (const el of Array.from(document.querySelectorAll("[data-hf-id]"))) {
    const existing = el.getAttribute("data-hf-id");
    if (existing) assigned.add(existing);
  }

  for (const el of Array.from(body.querySelectorAll("*"))) {
    if (EXCLUDED_TAGS.has(el.tagName.toLowerCase())) continue;
    if (el.getAttribute("data-hf-id")) continue; // pinned
    el.setAttribute("data-hf-id", mintHfId(el, assigned));
  }

  return wrapped ? document.body.innerHTML || "" : document.toString();
}

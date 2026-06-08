/**
 * Stable hf- element id minting (R1). Browser-safe: linkedom only, no recast.
 *
 * Two surfaces share these helpers:
 *  - ensureHfIds(html): node-id surface — mints data-hf-id on every element.
 *  - mintHfId(el, assigned): shared by htmlParser for clip ids.
 *
 * Hash is CONTENT ONLY (tag + sorted attrs + own text) — no sibling position,
 * so inserting a non-identical sibling never shifts another element's id.
 */
import { parseHTML } from "linkedom";

const EXCLUDED_TAGS = new Set(["script", "style", "template", "meta"]);

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
  const four = s.length >= 4 ? s.slice(0, 4) : s.padStart(4, "0");
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
  const attrs = Array.from(el.attributes)
    .filter((a) => a.name !== "data-hf-id" && !a.name.startsWith("data-hf-studio-"))
    .map((a) => `${a.name}=${a.value}`)
    .sort()
    .join("&");
  return `${el.tagName.toLowerCase()}|${attrs}|${ownText(el)}`;
}

export function mintHfId(el: Element, assigned: Set<string>): string {
  const key = contentKey(el);
  let id = toHfId(fnv1a(key));
  let dup = 0;
  while (assigned.has(id)) {
    dup += 1;
    id = toHfId(fnv1a(`${key}#${dup}`));
  }
  assigned.add(id);
  return id;
}

export function ensureHfIds(html: string): string {
  const { document } = parseHTML(html);
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

  return document.toString();
}

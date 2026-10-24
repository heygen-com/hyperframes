/** How far a mover's own paint reaches past its box: shadows, glows, outlines and filters. */

import { isHtmlElement } from "../domRealm";

const MAX_PAD = 256;
const NODE_LIMIT = 64;

const COLOR = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/g;

/** The px lengths of one shadow value, colour and `inset` removed. */
function lengths(value: string): number[] {
  return [...value.replace(COLOR, " ").matchAll(/-?\d*\.?\d+(?=px|\s|$)/g)].map((m) =>
    Number(m[0]),
  );
}

/** Split on commas that are not inside parentheses. */
function topLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(value.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(value.slice(from));
  return parts;
}

/** Reach of a box- or text-shadow list: offset, blur and spread, outer shadows only. */
export function shadowReach(value: string): number {
  if (!value || value === "none") return 0;
  return Math.max(
    0,
    ...topLevel(value)
      .filter((s) => !/\binset\b/.test(s))
      .map((s) => {
        const [dx = 0, dy = 0, blur = 0, spread = 0] = lengths(s);
        return Math.max(Math.abs(dx), Math.abs(dy)) + blur + Math.max(0, spread);
      }),
  );
}

/** Reach of a `filter` value: drop-shadow() like a shadow, blur() three sigmas. */
export function filterReach(value: string): number {
  if (!value || value === "none") return 0;
  let reach = 0;
  for (const m of value.matchAll(/drop-shadow\(((?:[^()]|\([^)]*\))*)\)/g)) {
    const [dx = 0, dy = 0, blur = 0] = lengths(m[1] ?? "");
    reach = Math.max(reach, Math.max(Math.abs(dx), Math.abs(dy)) + blur * 1.5);
  }
  for (const m of value.matchAll(/(?<!-)blur\(\s*([\d.]+)px\s*\)/g))
    reach = Math.max(reach, Number(m[1]) * 3);
  return reach;
}

function nodeReach(el: Element): number {
  const cs = getComputedStyle(el);
  const outline =
    cs.outlineStyle !== "none" ? parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset) : 0;
  return Math.max(
    shadowReach(cs.boxShadow),
    shadowReach(cs.textShadow),
    filterReach(cs.filter),
    Number.isFinite(outline) ? Math.max(0, outline) : 0,
  );
}

/** Px the mover's ink extends beyond its box in its own space, from it and its first descendants. */
export function inkPad(el: HTMLElement): number {
  let reach = nodeReach(el);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
  for (let n = 0; n < NODE_LIMIT && walker.nextNode(); n++) {
    const node = walker.currentNode;
    if (isHtmlElement(node)) reach = Math.max(reach, nodeReach(node));
  }
  return Math.min(MAX_PAD, Math.ceil(reach));
}

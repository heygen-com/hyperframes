import { roundTo3 } from "../../utils/rounding";
import { gsapWritesPosition } from "../../hooks/gsapRuntimeKeyframes";
import { readStudioPathOffset } from "./manualEditsDom";
import { splitTopLevelWhitespace } from "./manualEditsStyleHelpers";
import type { PatchOperation } from "../../utils/sourcePatcher";

type Point = { x: number; y: number };

const TOKEN = /\s*(?:(\d*\.?\d+(?:e[-+]?\d+)?)(px|%)?|([a-z]+)\(|([-+*/(),]))/giy;
const FUNCTIONS: Record<string, (args: number[]) => number> = {
  "(": ([a = Number.NaN]) => a,
  "calc(": ([a = Number.NaN]) => a,
  "min(": (args) => Math.min(...args),
  "max(": (args) => Math.max(...args),
  "clamp(": ([lo = Number.NaN, v = Number.NaN, hi = Number.NaN]) => Math.max(lo, Math.min(v, hi)),
};

/** Lengths become px against `side`; functions keep their "(" so they can't pass for an operator. */
function tokenize(value: string, side: number): (number | string)[] {
  const tokens: (number | string)[] = [];
  const end = value.trimEnd().length;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(value); m; m = TOKEN.lastIndex < end ? TOKEN.exec(value) : null) {
    if (m[1]) tokens.push(Number(m[1]) * (m[2] === "%" ? side / 100 : 1));
    else tokens.push(m[3] ? `${m[3].toLowerCase()}(` : (m[4] ?? ""));
  }
  return TOKEN.lastIndex < end ? [] : tokens;
}

/** Chrome's computed length (px, %, calc/min/max/clamp, + - * /) in px against `side`; NaN otherwise. */
function evaluateLength(value: string, side: number): number {
  const tokens = tokenize(value, side);
  let i = 0;
  const next = () => tokens[i++];
  const take = (...ops: string[]) => ops.includes(tokens[i] as string) && next();
  function sum(): number {
    let total = product();
    for (let op = take("+", "-"); op; op = take("+", "-"))
      total += (op === "+" ? 1 : -1) * product();
    return total;
  }
  function product(): number {
    let total = unary();
    for (let op = take("*", "/"); op; op = take("*", "/"))
      total = op === "*" ? total * unary() : total / unary();
    return total;
  }
  function unary(): number {
    return take("-") ? -unary() : atom();
  }
  function atom(): number {
    const token = next();
    if (typeof token === "number") return token;
    const fn = FUNCTIONS[token ?? ""];
    if (!fn) return Number.NaN;
    const args = [sum()];
    while (take(",")) args.push(sum());
    return take(")") ? fn(args) : Number.NaN;
  }
  const total = tokens.length ? sum() : Number.NaN;
  return i === tokens.length ? total : Number.NaN;
}

const CONTENT_BOXES = new Set(["content-box", "fill-box"]);

/** The side % resolves against: the box `transform-box` names (fill-box is the content box on HTML). */
function referenceBox(
  cs: CSSStyleDeclaration,
  size: "width" | "height",
  a: string,
  b: string,
): number {
  const n = (prop: string) => Number.parseFloat(cs.getPropertyValue(prop)) || 0;
  const pad =
    n(`padding-${a}`) + n(`padding-${b}`) + n(`border-${a}-width`) + n(`border-${b}-width`);
  const content = n(size) - (cs.boxSizing === "border-box" ? pad : 0);
  return CONTENT_BOXES.has(cs.getPropertyValue("transform-box")) ? content : content + pad;
}

/** The element's CSS `translate` in px, as it renders now. */
// ponytail: a 3-value translate loses its z on the next move; keep z when a fixture needs it.
export function readTranslatePx(el: HTMLElement): Point {
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
  // Computed first: Chrome resolves em, vw and var() there and leaves only % to work out.
  const value = cs?.translate || el.style.getPropertyValue("translate") || "none";
  if (value === "none") return { x: 0, y: 0 };
  const [x = "0px", y = "0px"] = splitTopLevelWhitespace(value);
  const side = (size: "width" | "height", a: string, b: string) =>
    cs ? referenceBox(cs, size, a, b) : 0;
  return {
    x: evaluateLength(x, side("width", "left", "right")),
    y: evaluateLength(y, side("height", "top", "bottom")),
  };
}

export const UNREADABLE_TRANSLATE =
  "Studio can't read this layer's translate. Move it in the Code tab.";

/** Plain px only: GSAP's CSSPlugin splits `translate` on spaces and drops a calc(). */
function formatTranslatePx(p: Point): string {
  return `${roundTo3(p.x)}px ${roundTo3(p.y)}px`;
}

export function translatePatch(p: Point): PatchOperation & { value: string } {
  return { type: "inline-style", property: "translate", value: formatTranslatePx(p) };
}

export function writeTranslatePx(el: HTMLElement, p: Point): void {
  el.style.setProperty("translate", formatTranslatePx(p));
}

/** The position the panel shows and edits: the translate a move writes, unless GSAP positions it. */
export function readMoveOffset(el: HTMLElement, plainTranslate = !gsapWritesPosition(el)): Point {
  return plainTranslate ? readTranslatePx(el) : readStudioPathOffset(el);
}

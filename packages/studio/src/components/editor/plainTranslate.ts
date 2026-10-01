import { roundTo3 } from "../../utils/rounding";
import { gsapWritesPosition } from "../../hooks/gsapRuntimeKeyframes";
import { readStudioPathOffset } from "./manualEditsDom";
import { splitTopLevelWhitespace } from "./manualEditsStyleHelpers";
import type { PatchOperation } from "../../utils/sourcePatcher";

type Point = { x: number; y: number };

const TERM = /^(-?\d*\.?\d+(?:e[-+]?\d+)?)(px|%)$/i;

/** px, %, or Chrome's computed `calc(P% + Lpx)`, against the border-box side; null for min()/max()/clamp(). */
function resolveLength(value: string, side: number): number | null {
  const parts = (/^calc\((.*)\)$/.exec(value)?.[1] ?? value).split(" ");
  let total = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const term = TERM.exec(parts[i] ?? "");
    const sign = i === 0 || parts[i - 1] === "+" ? 1 : parts[i - 1] === "-" ? -1 : 0;
    if (!term || !sign) return null;
    total += sign * Number(term[1]) * (term[2] === "%" ? side / 100 : 1);
  }
  return parts.length % 2 === 1 ? total : null;
}

function borderBox(
  cs: CSSStyleDeclaration,
  size: "width" | "height",
  a: string,
  b: string,
): number {
  const n = (prop: string) => Number.parseFloat(cs.getPropertyValue(prop)) || 0;
  const pad =
    n(`padding-${a}`) + n(`padding-${b}`) + n(`border-${a}-width`) + n(`border-${b}-width`);
  return n(size) + (cs.boxSizing === "border-box" ? 0 : pad);
}

// Chrome resolves min()/max()/clamp() inside a transform function to a matrix; an unrendered box has none.
function resolveInTransform(el: HTMLElement, x: string, y: string): Point {
  const style = el.style;
  const saved = [style.getPropertyValue("transform"), style.getPropertyPriority("transform")];
  style.setProperty("transform", `translate(${x}, ${y})`, "important");
  try {
    const resolved = el.ownerDocument.defaultView?.getComputedStyle(el).transform ?? "";
    const matrix = new DOMMatrixReadOnly(resolved.startsWith("matrix") ? resolved : undefined);
    return { x: matrix.m41, y: matrix.m42 };
  } finally {
    style.setProperty("transform", saved[0] ?? "", saved[1] ?? "");
  }
}

/** The element's CSS `translate` in px, as it renders now. */
// ponytail: a 3-value translate loses its z on the next move; keep z when a fixture needs it.
export function readTranslatePx(el: HTMLElement): Point {
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
  const value = el.style.getPropertyValue("translate") || cs?.translate || "none";
  if (value === "none") return { x: 0, y: 0 };
  const [x = "0px", y = "0px"] = splitTopLevelWhitespace(value);
  const px = cs && resolveLength(x, borderBox(cs, "width", "left", "right"));
  const py = cs && resolveLength(y, borderBox(cs, "height", "top", "bottom"));
  return px != null && py != null ? { x: px, y: py } : resolveInTransform(el, x, y);
}

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
export function readMoveOffset(el: HTMLElement): Point {
  return gsapWritesPosition(el) ? readStudioPathOffset(el) : readTranslatePx(el);
}

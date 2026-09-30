import { roundTo3 } from "../../utils/rounding";
import { gsapWritesPosition } from "../../hooks/gsapRuntimeKeyframes";
import { readStudioPathOffset } from "./manualEditsDom";
import { splitTopLevelWhitespace } from "./manualEditsStyleHelpers";
import type { PatchOperation } from "../../utils/sourcePatcher";

type Point = { x: number; y: number };

const PX = /^-?\d*\.?\d+(?:e[-+]?\d+)?px$/i;

// Chrome resolves %, calc(), min()/max()/clamp() and em inside a transform function to a matrix.
function resolveInTransform(el: HTMLElement, x: string, y: string): Point {
  const style = el.style;
  const saved = [style.getPropertyValue("transform"), style.getPropertyPriority("transform")];
  style.setProperty("transform", `translate(${x}, ${y})`, "important");
  const view = el.ownerDocument.defaultView;
  const matrix = new DOMMatrixReadOnly(view?.getComputedStyle(el).transform ?? "none");
  style.setProperty("transform", saved[0] ?? "", saved[1] ?? "");
  return { x: matrix.m41, y: matrix.m42 };
}

/** The element's CSS `translate` in px, as it renders now. */
// ponytail: a 3-value translate loses its z on the next move; keep z when a fixture needs it.
export function readTranslatePx(el: HTMLElement): Point {
  const computed = () => el.ownerDocument.defaultView?.getComputedStyle(el).translate ?? "none";
  const value = el.style.getPropertyValue("translate") || computed();
  if (value === "none") return { x: 0, y: 0 };
  const [x = "0px", y = "0px"] = splitTopLevelWhitespace(value);
  if (PX.test(x) && PX.test(y)) return { x: Number.parseFloat(x), y: Number.parseFloat(y) };
  return resolveInTransform(el, x, y);
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

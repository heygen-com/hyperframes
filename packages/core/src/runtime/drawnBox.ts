/**
 * How a draft draws an element's box, shared by the frame's editing channel and a parent that scripts
 * the frame itself, so both measure a resize the same way. Reads the DOM only when called.
 */
import type { StylableElement as Styled } from "./domRealm";

export const SIZE_PROPERTIES = [
  "box-sizing",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
] as const;

export const PROBE_PX = 100;
export const MIN_PROBE_RESPONSE = 0.01;
type Point = { x: number; y: number };
/** Frame px its centre moves per px of drawn width, `a, b`, and height, `c, d`; null when it has no box. */
export type Grow = { a: number; b: number; c: number; d: number } | null;

/** "calc(50% + 2px) 4px" as its top-level parts. */
function axes(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let part = "";
  for (const char of value.trim()) {
    depth += char === "(" ? 1 : char === ")" ? -1 : 0;
    if (/\s/.test(char) && depth === 0) {
      if (part) parts.push(part);
      part = "";
    } else part += char;
  }
  if (part) parts.push(part);
  return parts;
}

/** The side a translate's % takes a share of: the box `transform-box` names. */
function percentSide(computed: CSSStyleDeclaration, size: "width" | "height"): number {
  const [a, b] = size === "width" ? ["left", "right"] : ["top", "bottom"];
  const n = (name: string) => Number.parseFloat(computed.getPropertyValue(name)) || 0;
  const pad =
    n(`padding-${a}`) + n(`padding-${b}`) + n(`border-${a}-width`) + n(`border-${b}-width`);
  const content = n(size) - (computed.getPropertyValue("box-sizing") === "border-box" ? pad : 0);
  const box = computed.getPropertyValue("transform-box");
  return box === "content-box" || box === "fill-box" ? content : content + pad;
}

/** Each % as the px it is now, so a resize drawn with it does not move the element again. */
function percentAsPx(axis: string, side: number): string {
  return axis.replace(
    /(-?\d*\.?\d+(?:e[-+]?\d+)?)%/gi,
    (_, n: string) => `${(Number(n) * side) / 100}px`,
  );
}

export function computedTranslateAxes(element: Styled): string[] {
  const computed = (element.ownerDocument.defaultView ?? window).getComputedStyle(element);
  const translate = computed.getPropertyValue("translate");
  if (!translate || translate === "none") return [];
  const sides = [percentSide(computed, "width"), percentSide(computed, "height")];
  return axes(translate).map((axis, i) => (i < 2 ? percentAsPx(axis, sides[i]!) : axis));
}

export function movedTranslate(
  [x = "0px", y = "0px", z]: string[],
  offset: { x: number; y: number },
) {
  return `calc(${x} + ${offset.x}px) calc(${y} + ${offset.y}px)${z ? ` ${z}` : ""}`;
}

export function writeDrawnSize(
  style: CSSStyleDeclaration,
  size: { width: number; height: number },
): void {
  style.setProperty("box-sizing", "border-box");
  style.setProperty("width", `${size.width}px`);
  style.setProperty("height", `${size.height}px`);
  for (const name of ["min-width", "min-height"]) style.setProperty(name, "0px");
  for (const name of ["max-width", "max-height"]) style.setProperty(name, "none");
}

/** Where its centre goes as a draft draws its size, so a resize can pin it; its inline size put back. */
export function measureGrowResponse(
  element: Styled,
  layout: { width: number; height: number },
): Grow {
  const { style } = element;
  const kept = [...SIZE_PROPERTIES, "translate"].map(
    (name) => [name, style.getPropertyValue(name), style.getPropertyPriority(name)] as const,
  );
  const translateAsTheResizeDraftDrawsIt = movedTranslate(computedTranslateAxes(element), {
    x: 0,
    y: 0,
  });
  const centre = (width: number, height: number): Point | null => {
    style.setProperty("translate", translateAsTheResizeDraftDrawsIt);
    writeDrawnSize(style, { width, height });
    const box = element.getBoundingClientRect();
    return box.width > 0 || box.height > 0
      ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      : null;
  };
  try {
    if (layout.width < 1 || layout.height < 1) return null;
    const origin = centre(layout.width, layout.height);
    const wider = centre(layout.width + PROBE_PX, layout.height);
    const taller = centre(layout.width, layout.height + PROBE_PX);
    if (!origin || !wider || !taller) return null;
    const per = (p: Point) => [(p.x - origin.x) / PROBE_PX, (p.y - origin.y) / PROBE_PX];
    const [[a, b], [c, d]] = [per(wider), per(taller)] as [number[], number[]];
    return [a, b, c, d].every(Number.isFinite) ? { a: a!, b: b!, c: c!, d: d! } : null;
  } finally {
    for (const [name, value, priority] of kept) {
      if (value) style.setProperty(name, value, priority);
      else style.removeProperty(name);
    }
  }
}

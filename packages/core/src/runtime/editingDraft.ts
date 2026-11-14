/**
 * Gesture drafts for the editing channel. A parent that cannot script the frame draws a drag or a
 * resize here, on the element's inline style, so the preview moves with the pointer. What the
 * element had before its first draft is kept until the parent ends the draft or the frame loads again.
 */
import { isStylableElement, type StylableElement as Styled } from "./domRealm";
import { elementForHandle } from "./editingHandles";
import type { EditingDraft } from "./editingPort";

const SIZE_PROPERTIES = [
  "box-sizing",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
] as const;
const DRAWN = ["translate", ...SIZE_PROPERTIES] as const;

interface Before {
  inline: Array<[name: string, value: string, priority: string]>;
  /** The computed translate, split into its axes with each % as px, that a draft's translate adds to. */
  translate: string[];
}

const before = new WeakMap<Element, Before>();

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
  const computed = getComputedStyle(element);
  const translate = computed.getPropertyValue("translate");
  if (!translate || translate === "none") return [];
  const sides = [percentSide(computed, "width"), percentSide(computed, "height")];
  return axes(translate).map((axis, i) => (i < 2 ? percentAsPx(axis, sides[i]!) : axis));
}

function beforeOf(element: Styled): Before {
  let saved = before.get(element);
  if (!saved) {
    const { style } = element;
    saved = {
      inline: DRAWN.map((name) => [
        name,
        style.getPropertyValue(name),
        style.getPropertyPriority(name),
      ]),
      translate: computedTranslateAxes(element),
    };
    before.set(element, saved);
  }
  return saved;
}

function restore(element: Styled, names: readonly string[]): void {
  for (const [name, value, priority] of before.get(element)?.inline ?? []) {
    if (!names.includes(name)) continue;
    if (value) element.style.setProperty(name, value, priority);
    else element.style.removeProperty(name);
  }
}

export function movedTranslate(
  [x = "0px", y = "0px", z]: string[],
  offset: { x: number; y: number },
) {
  return `calc(${x} + ${offset.x}px) calc(${y} + ${offset.y}px)${z ? ` ${z}` : ""}`;
}

function drawTranslate(element: Styled, offset: { x: number; y: number }): void {
  element.style.setProperty("translate", movedTranslate(beforeOf(element).translate, offset));
}

function drawSize(element: Styled, size: { width: number; height: number }): void {
  beforeOf(element);
  const { style } = element;
  style.setProperty("box-sizing", "border-box");
  style.setProperty("width", `${size.width}px`);
  style.setProperty("height", `${size.height}px`);
  for (const name of ["min-width", "min-height"]) style.setProperty(name, "0px");
  for (const name of ["max-width", "max-height"]) style.setProperty(name, "none");
}

function apply(element: Styled, draft: EditingDraft): void {
  if ("end" in draft) {
    if (draft.end === "restore") restore(element, DRAWN);
    before.delete(element);
    return;
  }
  if (draft.translate) drawTranslate(element, draft.translate);
  else restore(element, ["translate"]);
  if (draft.size) drawSize(element, draft.size);
  else restore(element, SIZE_PROPERTIES);
}

/** Applies each draft in order; one for an element this load no longer has is skipped. */
export function drawDrafts(drafts: readonly EditingDraft[]): { drawn: number } {
  let drawn = 0;
  for (const draft of drafts) {
    const element = elementForHandle(draft.handle);
    if (!isStylableElement(element)) continue;
    apply(element, draft);
    drawn++;
  }
  return { drawn };
}

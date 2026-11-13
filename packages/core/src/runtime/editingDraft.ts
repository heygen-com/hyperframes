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
  /** The computed translate, split into its axes, that a draft's translate adds to. */
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

function beforeOf(element: Styled): Before {
  let saved = before.get(element);
  if (!saved) {
    const { style } = element;
    const translate = getComputedStyle(element).getPropertyValue("translate");
    saved = {
      inline: DRAWN.map((name) => [
        name,
        style.getPropertyValue(name),
        style.getPropertyPriority(name),
      ]),
      translate: translate && translate !== "none" ? axes(translate) : [],
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

function drawTranslate(element: Styled, offset: { x: number; y: number }): void {
  const [x = "0px", y = "0px", z] = beforeOf(element).translate;
  const value = `calc(${x} + ${offset.x}px) calc(${y} + ${offset.y}px)${z ? ` ${z}` : ""}`;
  element.style.setProperty("translate", value);
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

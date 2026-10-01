import { readCssRotation } from "../../hooks/draggedGsapPosition";
import { roundTo3 } from "../../utils/rounding";
import type { PatchOperation } from "../../utils/sourcePatcher";
import {
  readStudioRotation,
  restoreStudioRotation,
  type StudioRotationSnapshot,
} from "./manualEdits";
import { getOffsetDragGsap } from "./manualOffsetDrag";

const TRAILING_TURN = /\s*rotate\(\s*-?[\d.]+(?:e[+-]?\d+)?deg\s*\)\s*$/;

// ponytail: the authored transform if it moves the box, from the last matching rule in sheet order;
// specificity, !important and @media are not weighed. Weigh them when a film's rule is missed.
function translatingTransform(element: HTMLElement): string {
  const view = element.ownerDocument.defaultView;
  const computed = view?.getComputedStyle(element).transform ?? "none";
  const m = computed === "none" ? null : new view!.DOMMatrix(computed);
  if (!m || (m.m41 === 0 && m.m42 === 0)) return "";
  let value = element.style.getPropertyValue("transform");
  for (const sheet of value ? [] : Array.from(element.ownerDocument.styleSheets)) {
    let rules: CSSRule[];
    try {
      rules = Array.from(sheet.cssRules);
    } catch {
      continue; // a cross-origin sheet
    }
    for (const rule of rules as CSSStyleRule[]) {
      const declared = rule.style?.getPropertyValue("transform");
      if (declared && element.matches(rule.selectorText)) value = declared;
    }
  }
  return value === "none" ? "" : value;
}

/** Where a plain rotate draws its turn, read once at press: the element's own `rotate`, or, when its
 *  transform translates it (often the translate(-50%, -50%) centring), a trailing rotate() in that
 *  transform, so the translate is not turned with the box. `share` is what the rest already turns. */
export interface CssRotationTarget {
  property: "rotate" | "transform";
  prefix: string;
  share: number;
  /** An inline box does not transform, so the turn makes it inline-block. */
  inline: boolean;
}

export function readCssRotationTarget(element: HTMLElement): CssRotationTarget {
  const view = element.ownerDocument.defaultView;
  const inline = view?.getComputedStyle(element).display === "inline";
  const transform = translatingTransform(element);
  if (!transform) {
    return { property: "rotate", prefix: "", share: readCssRotation(element, false), inline };
  }
  const prefix = transform.replace(TRAILING_TURN, "");
  const style = element.style;
  const saved = [style.getPropertyValue("transform"), style.getPropertyPriority("transform")];
  style.setProperty("transform", prefix || "none");
  const share = readCssRotation(element);
  style.setProperty("transform", saved[0] ?? "", saved[1] ?? "");
  return { property: "transform", prefix, share, inline };
}

/** Draws `angle` where `target` says, and returns the source patches that save it as drawn. */
export function applyCssRotation(
  element: HTMLElement,
  angle: number,
  target = readCssRotationTarget(element),
): Array<PatchOperation & { value: string }> {
  const turn = `${roundTo3(angle - target.share)}deg`;
  const value = target.property === "rotate" ? turn : `${target.prefix} rotate(${turn})`.trim();
  const patches = [{ type: "inline-style" as const, property: target.property, value }];
  if (target.inline)
    patches.unshift({ type: "inline-style", property: "display", value: "inline-block" });
  for (const patch of patches) element.style.setProperty(patch.property, patch.value);
  return patches;
}

/** Back to the press: the rotation snapshot and, for a plain rotate, the inline transform it drew in. */
export function restorePlainRotation(element: HTMLElement, snapshot: StudioRotationSnapshot): void {
  restoreStudioRotation(element, snapshot);
  element.style.setProperty("transform", snapshot.transform);
  element.style.setProperty("display", snapshot.display);
}

// `plain`, read at press: where a turn GSAP does not own draws; null for GSAP's rotation.
export function applyRotationDraft(
  element: HTMLElement,
  angle: number,
  plain: CssRotationTarget | null,
): void {
  if (plain) return void applyCssRotation(element, angle, plain);
  element.style.setProperty("rotate", "none");
  getOffsetDragGsap(element)?.set(element, { rotation: angle });
}

/** Back to the gesture start: the CSS snapshot, and GSAP's rotation without the legacy var. */
export function restoreRotationDraft(
  element: HTMLElement,
  angle: number,
  snapshot: StudioRotationSnapshot,
  plain: boolean,
): void {
  if (plain) return restorePlainRotation(element, snapshot);
  getOffsetDragGsap(element)?.set(element, {
    rotation: angle - (Number.parseFloat(snapshot.studioRotation) || 0),
  });
  restoreStudioRotation(element, snapshot);
}

/** The angle a rotate gesture starts from, as the element shows it. */
export function readRotationBase(element: HTMLElement, plain: boolean): number {
  if (plain) return readCssRotation(element);
  const gsapRotation = Number(getOffsetDragGsap(element)?.getProperty(element, "rotation") ?? 0);
  return gsapRotation + readStudioRotation(element).angle;
}

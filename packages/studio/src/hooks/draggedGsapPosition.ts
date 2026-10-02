import { roundTo3 } from "../utils/rounding";

/**
 * Drag → GSAP position math, shared by the commit path
 * (`gsapDragCommit.commitGsapPositionFromDrag` / `commitStaticGsapPosition`) and
 * the live preview (`manualOffsetDrag.applyManualOffsetDrag*`). Kept in its own
 * leaf module — no store/runtime/core imports — so the live-preview file can use
 * it without pulling the GSAP commit graph into its module scope.
 */

const cssValue = (style: CSSStyleDeclaration, prop: string) => {
  const value = style.getPropertyValue(prop).trim();
  return value === "none" ? "" : value;
};

// Without GSAP, the rotation GSAP will parse from the CSS `rotate`, `scale` and `transform`; with
// `withRotate` false, only the part `scale` and `transform` draw. GSAP folds them into one transform,
// and a list the browser rejects (e.g. `rotate: x 30deg`) leaves it only the plain transform.
export function readCssRotation(element: HTMLElement, withRotate = true): number {
  const view = element.ownerDocument.defaultView;
  if (!view) return 0;
  const style = view.getComputedStyle(element);
  const rotate = withRotate ? cssValue(style, "rotate") : "";
  const scale = cssValue(style, "scale");
  const transform = cssValue(style, "transform");
  const angle = (list: string) => {
    if (!list) return 0;
    const m = new view.DOMMatrix(list);
    return (Math.atan2(m.b, m.a) * 180) / Math.PI;
  };
  const folded = [rotate && `rotate(${rotate})`, scale && `scale(${scale.split(/\s+/).join(",")})`];
  try {
    return angle([...folded, transform].join(" ").trim());
  } catch {
    return angle(transform);
  }
}

/**
 * Translate a studio drag offset into absolute GSAP x/y, accounting for the
 * element's rotation and its drag-start base pose. Reads the drag-start
 * attributes stamped by `createManualOffsetDragMember`
 * (`data-hf-drag-initial-offset-*`, `data-hf-drag-gsap-base-*`); `fallbackBase`
 * is used when the base attributes are absent (e.g. a static element that GSAP
 * hasn't given an x/y yet).
 *
 * Used by both the tweened commit and the static `set` commit / live preview, so
 * the preview and the committed value agree by construction.
 */
// fallow-ignore-next-line complexity
export function computeDraggedGsapPosition(
  element: HTMLElement,
  studioOffset: { x: number; y: number },
  fallbackBase: { x: number; y: number },
): { newX: number; newY: number; baseGsapX: number; baseGsapY: number } {
  const rotStyle = element.style.getPropertyValue("--hf-studio-rotation");
  const rotDeg = Number.parseFloat(rotStyle) || 0;
  const rad = (-rotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const origX = Number.parseFloat(element.getAttribute("data-hf-drag-initial-offset-x") ?? "") || 0;
  const origY = Number.parseFloat(element.getAttribute("data-hf-drag-initial-offset-y") ?? "") || 0;
  const deltaX = studioOffset.x - origX;
  const deltaY = studioOffset.y - origY;
  const adjX = deltaX * cos - deltaY * sin;
  const adjY = deltaX * sin + deltaY * cos;
  const parsedBaseX = Number.parseFloat(element.getAttribute("data-hf-drag-gsap-base-x") ?? "");
  const parsedBaseY = Number.parseFloat(element.getAttribute("data-hf-drag-gsap-base-y") ?? "");
  const baseGsapX = Number.isFinite(parsedBaseX) ? parsedBaseX : fallbackBase.x;
  const baseGsapY = Number.isFinite(parsedBaseY) ? parsedBaseY : fallbackBase.y;
  return {
    newX: roundTo3(baseGsapX + adjX),
    newY: roundTo3(baseGsapY + adjY),
    baseGsapX,
    baseGsapY,
  };
}

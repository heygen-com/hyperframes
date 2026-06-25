/**
 * Drag → GSAP position math, shared by the commit path
 * (`gsapDragCommit.commitGsapPositionFromDrag` / `commitStaticGsapPosition`) and
 * the live preview (`manualOffsetDrag.applyManualOffsetDrag*`). Kept in its own
 * leaf module — no store/runtime/core imports — so the live-preview file can use
 * it without pulling the GSAP commit graph into its module scope.
 */

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
    newX: Math.round(baseGsapX + adjX),
    newY: Math.round(baseGsapY + adjY),
    baseGsapX,
    baseGsapY,
  };
}

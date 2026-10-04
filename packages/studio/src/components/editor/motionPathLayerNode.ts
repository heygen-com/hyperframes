type Point = { x: number; y: number };

const LAYER_BOX = '[data-dom-edit-selection-box="true"]';

/** How far a node's dot reaches; a selected node draws it larger. */
export const dotRadius = (r: number, selected: boolean) => (selected ? r * 1.5 : r);

/** A press on the layer's own node, or anywhere in its box (even on another keyframe's dot), is the layer's. */
export function pressBelongsToLayer(
  e: React.PointerEvent,
  pressed: Point,
  live: Point | null,
): boolean {
  if (live && Math.abs(pressed.x - live.x) < 0.5 && Math.abs(pressed.y - live.y) < 0.5) return true;
  return Boolean(layerBoxUnder(e));
}

export function layerBoxUnder(e: React.PointerEvent): Element | null {
  const hits = e.currentTarget.ownerDocument.elementsFromPoint(e.clientX, e.clientY);
  return hits.find((el) => el.closest(LAYER_BOX))?.closest(LAYER_BOX) ?? null;
}

/** Hands a press to the selected layer's box; true when the box started a gesture with it. */
export function pressSelectedLayer(e: React.PointerEvent): boolean {
  const box = e.currentTarget.ownerDocument.querySelector(LAYER_BOX);
  if (!box || getComputedStyle(box).pointerEvents === "none") return false;
  return !box.dispatchEvent(new PointerEvent("pointerdown", e.nativeEvent));
}

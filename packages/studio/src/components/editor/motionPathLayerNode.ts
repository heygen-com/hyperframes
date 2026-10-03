type Point = { x: number; y: number };
type DrawnNode = Point & { ax: number; ay: number };

const LAYER_BOX = '[data-dom-edit-selection-box="true"]';

/** A press on the layer's own node, or in its box but off a node's dot, belongs to the layer. */
export function pressBelongsToLayer(
  e: React.PointerEvent,
  point: Point,
  pressed: DrawnNode,
  dotR: number,
  live: Point | null,
): boolean {
  if (live && Math.abs(pressed.x - live.x) < 0.5 && Math.abs(pressed.y - live.y) < 0.5) return true;
  const hits = e.currentTarget.ownerDocument.elementsFromPoint(e.clientX, e.clientY);
  const inBox = hits.some((el) => el.closest(LAYER_BOX));
  return inBox && Math.hypot(point.x - pressed.ax, point.y - pressed.ay) > dotR;
}

/** Hands a press to the selected layer's box, which starts the move a press on the layer starts. */
export function pressSelectedLayer(e: React.PointerEvent): boolean {
  const box = e.currentTarget.ownerDocument.querySelector(LAYER_BOX);
  if (!box) return false;
  box.dispatchEvent(new PointerEvent("pointerdown", e.nativeEvent));
  return true;
}

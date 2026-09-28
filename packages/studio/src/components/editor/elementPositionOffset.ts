import type { PatchOperation } from "../../utils/sourcePatcher";

interface LayoutBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const layoutBox = (el: HTMLElement): LayoutBox => ({
  left: el.offsetLeft,
  top: el.offsetTop,
  width: el.offsetWidth,
  height: el.offsetHeight,
});

function readDragStart(el: HTMLElement, axis: "x" | "y"): number {
  const value = Number.parseFloat(el.getAttribute(`data-hf-drag-initial-offset-${axis}`) ?? "");
  return Number.isFinite(value) ? value : 0;
}

/**
 * Moves one element by `left`/`top` on itself, the channel for an element whose GSAP
 * position tween also moves its siblings: GSAP never parses left/top, so the offset
 * renders once and the shared entrance still plays. Adds to any left/top it already
 * has. Returns null, with the element untouched, when the layout would not shift by
 * exactly the delta (a right/bottom-anchored or stretched box).
 */
export function applyElementPositionOffset(
  el: HTMLElement,
  gestureOffset: { x: number; y: number },
): PatchOperation[] | null {
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!cs) return null;
  const dx = Math.round(gestureOffset.x - readDragStart(el, "x"));
  const dy = Math.round(gestureOffset.y - readDragStart(el, "y"));
  const isStatic = !/^(relative|absolute|fixed|sticky)$/.test(cs.position);
  const baseLeft = isStatic ? 0 : Number.parseFloat(cs.left) || 0;
  const baseTop = isStatic ? 0 : Number.parseFloat(cs.top) || 0;
  const previous = { position: el.style.position, left: el.style.left, top: el.style.top };
  const before = layoutBox(el);
  if (isStatic) el.style.position = "relative";
  el.style.left = `${Math.round(baseLeft) + dx}px`;
  el.style.top = `${Math.round(baseTop) + dy}px`;
  const after = layoutBox(el);
  const shiftedExactly =
    Math.abs(after.left - before.left - dx) <= 1 &&
    Math.abs(after.top - before.top - dy) <= 1 &&
    Math.abs(after.width - before.width) <= 1 &&
    Math.abs(after.height - before.height) <= 1;
  if (!shiftedExactly) {
    Object.assign(el.style, previous);
    return null;
  }
  return [
    ...(isStatic
      ? [{ type: "inline-style", property: "position", value: "relative" } as const]
      : []),
    { type: "inline-style", property: "left", value: el.style.left },
    { type: "inline-style", property: "top", value: el.style.top },
  ];
}

import { fadeCurveThroughMidpoint } from "./clipFades";

/**
 * Turning a pointer position into a fade.
 *
 * One handle owns both of a fade's properties, on the axis each one lives on:
 * across is how long it lasts, up and down is how it bends. That works because
 * the handle is defined as the curve's own MIDPOINT, which makes both gestures
 * direct manipulation. Drag sideways and the midpoint is where you put it, so
 * the fade is twice as long as the pointer travelled. Drag up and the curve has
 * to pass through the pointer, so the bend is whatever produces that level
 * halfway along.
 *
 * Anywhere else on the curve and one of the two would drift out from under the
 * pointer as the shape changed.
 *
 * Kept apart from the component because the arithmetic is the whole gesture and
 * it is worth testing without mounting a timeline to do it.
 */

/** Where the handle sits, in the clip's own pixel box. */
export interface FadeHandlePosition {
  x: number;
  y: number;
}

/**
 * The midpoint of a fade's curve, or null when there is no fade to sit on.
 *
 * A clip without one parks its handle on the corner instead, which is a layout
 * question rather than a curve one, so the component owns that spot.
 */
export function fadeHandlePosition(input: {
  edge: "in" | "out";
  seconds: number;
  pixelsPerSecond: number;
  width: number;
  height: number;
  level: number;
}): FadeHandlePosition | null {
  const { edge, seconds, pixelsPerSecond, width, height, level } = input;
  const span = Math.min(seconds * pixelsPerSecond, width);
  if (span <= 0 || height <= 0) return null;
  return { x: edge === "in" ? span / 2 : width - span / 2, y: (1 - level) * height };
}

/**
 * The fade length a pointer at `offsetX` asks for, measured from the clip's own
 * left edge.
 *
 * The handle is the midpoint, so the fade reaches twice as far as the pointer
 * does. That is not a gain to tune, it is what keeps the handle exactly under
 * the finger dragging it: put the midpoint here, and the fade ends over there.
 */
export function lengthFromPointer(input: {
  edge: "in" | "out";
  offsetX: number;
  pixelsPerSecond: number;
  width: number;
}): number {
  const { edge, offsetX, pixelsPerSecond, width } = input;
  if (!(pixelsPerSecond > 0)) return 0;
  const fromEdge = edge === "in" ? offsetX : width - offsetX;
  return Math.max(0, (fromEdge * 2) / pixelsPerSecond);
}

/**
 * The bend a pointer at `offsetY` asks for, given the clip's pixel height.
 *
 * Reading top-down pixels as a bottom-up level is the only conversion here, and
 * it is the one that decides which way "drag up" bends the fade: up is a higher
 * level halfway through, which is a fade that arrives early.
 */
export function bendFromPointer(offsetY: number, height: number): number {
  if (!(height > 0)) return 0;
  const level = 1 - offsetY / height;
  return fadeCurveThroughMidpoint(level);
}

/** Which of the two properties a drag is changing. */
export type FadeDragAxis = "length" | "bend";

/** Travel, in px, before a drag commits to an axis. */
const AXIS_LOCK_PX = 3;

/**
 * The axis a drag belongs to, or null while it is still too small to tell.
 *
 * Locked once and never revisited, because the handle is small and a real hand
 * wanders: without the lock a drag along one axis picks up stray movement on
 * the other, and silently changes a property nobody aimed at.
 */
export function resolveDragAxis(dx: number, dy: number): FadeDragAxis | null {
  if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return null;
  return Math.abs(dx) >= Math.abs(dy) ? "length" : "bend";
}

import { fadeCurveThroughMidpoint } from "@hyperframes/core/clip-fade";

/**
 * Turning a pointer position into a fade's bend.
 *
 * The gesture is direct manipulation: the fade line is dragged, and the curve
 * has to end up passing under the pointer rather than drifting towards it. So
 * the pointer's height inside the clip IS the level the curve must reach at the
 * halfway point, and the bend is whatever produces that level.
 *
 * Kept apart from the component because the arithmetic is the whole gesture and
 * it is worth testing without mounting a timeline to do it.
 */

/** Where the bend handle sits, in the clip's own pixel box. */
export interface BendHandlePosition {
  x: number;
  y: number;
}

/**
 * The midpoint of a fade's curve, which is where the handle is drawn and the
 * only place the drag reads from: bending about any other point would let the
 * handle slide out from under the pointer as the curve changes shape.
 */
export function bendHandlePosition(input: {
  edge: "in" | "out";
  seconds: number;
  pixelsPerSecond: number;
  width: number;
  height: number;
  level: number;
}): BendHandlePosition | null {
  const { edge, seconds, pixelsPerSecond, width, height, level } = input;
  const span = Math.min(seconds * pixelsPerSecond, width);
  if (span <= 0 || height <= 0) return null;
  return {
    x: edge === "in" ? span / 2 : width - span / 2,
    y: (1 - level) * height,
  };
}

/**
 * The bend a pointer at `offsetY` asks for, given the clip's pixel height.
 *
 * Reading top-down pixels as a bottom-up level is the only conversion here, and
 * it is the one that decides which way "drag up" bends the fade: up is a higher
 * level halfway through, which is a fade that gets loud early.
 */
export function bendFromPointer(offsetY: number, height: number): number {
  if (!(height > 0)) return 0;
  const level = 1 - offsetY / height;
  return fadeCurveThroughMidpoint(level);
}

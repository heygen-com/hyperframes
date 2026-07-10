/**
 * Rotation-correct corner-resize math (the industry OBB model shared by tldraw
 * `Resizing.ts`, Fabric.js `wrapWithFixedAnchor.ts`, Konva `Transformer.ts`).
 *
 * The old screen-space path (`resolveDomEditResizeGesture` + `resolveResizeHandleDeltas`)
 * added the raw pointer dx/dy to width/height along SCREEN axes, which is only correct
 * when the element is unrotated. Here the pointer delta is projected into the element's
 * LOCAL frame (inverse-rotated by the element's live rotation, divided by the display
 * scale) before it becomes a width/height change, so a rotated element grows along its
 * own axes. The anchor corner (opposite the grabbed handle) stays world-fixed BY
 * CONSTRUCTION when the caller repositions the element to the returned local size.
 *
 * All math here is pure and unit-tested; the live wiring (measuring the element's
 * transform, feeding the anchor translate through the manual-offset channel) lives in
 * useDomEditOverlayGestures.ts.
 */
import type { ResizeHandle } from "./domEditOverlayGestures";

/** Minimum element edge in LOCAL px — mirrors the old MIN_RESIZE_EDGE_PX clamp
 *  (no flip-through-zero: clamp, never mirror). */
export const MIN_RESIZE_LOCAL_PX = 1;

/** Local-frame unit corners (sign relative to the element center). */
const CORNER_SIGNS: Record<ResizeHandle, { x: -1 | 1; y: -1 | 1 }> = {
  nw: { x: -1, y: -1 },
  ne: { x: 1, y: -1 },
  se: { x: 1, y: 1 },
  sw: { x: -1, y: 1 },
};

/** The corner a handle keeps FIXED: opposite the grabbed corner. */
export function oppositeCorner(handle: ResizeHandle): ResizeHandle {
  switch (handle) {
    case "nw":
      return "se";
    case "ne":
      return "sw";
    case "sw":
      return "ne";
    case "se":
      return "nw";
  }
}

/**
 * Decompose a 2D transform matrix into rotation (radians) and per-axis scale.
 * `atan2(b, a)` recovers the rotation; `hypot` recovers the scales. Skew is
 * ignored (treated as 0) but the guards below keep the result finite. Matches the
 * CSS `matrix(a, b, c, d, e, f)` element order.
 */
export function decomposeMatrix2D(m: { a: number; b: number; c: number; d: number }): {
  rotation: number;
  scaleX: number;
  scaleY: number;
} {
  const a = Number.isFinite(m.a) ? m.a : 1;
  const b = Number.isFinite(m.b) ? m.b : 0;
  const c = Number.isFinite(m.c) ? m.c : 0;
  const d = Number.isFinite(m.d) ? m.d : 1;
  const scaleX = Math.hypot(a, b) || 1;
  // Signed Y scale: the determinant sign catches a vertical flip.
  const det = a * d - b * c;
  const rawScaleY = Math.hypot(c, d) || 1;
  const scaleY = det < 0 ? -rawScaleY : rawScaleY;
  const rotation = Math.atan2(b, a);
  return { rotation, scaleX, scaleY };
}

/** Rotate a vector by `theta` radians (screen/CSS convention: +y down, CW positive). */
function rotateVector(v: { x: number; y: number }, theta: number): { x: number; y: number } {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return { x: cos * v.x - sin * v.y, y: sin * v.x + cos * v.y };
}

/**
 * The element's new LOCAL size (element-local px) for a corner resize.
 *
 * `dxScreen/dyScreen` is the pointer's screen-space movement since gesture start
 * (the grabbed corner tracks the pointer). It is inverse-rotated by the element's
 * live rotation and divided by the display scale to get the LOCAL-axis size deltas
 * toward the dragged corner, then added to the base local size.
 *
 * `uniform` preserves the exact Shift aspect-lock semantics of the old
 * `resolveDomEditResizeGesture` uniform branch (dominant axis wins, the other is
 * derived from the CURRENT ratio baseHeight/baseWidth).
 *
 * At rotation 0 with equal display scale this returns the same width/height as the
 * old screen-space path, so unrotated behavior is unchanged.
 */
export function resolveLocalResizeSize(input: {
  baseWidth: number;
  baseHeight: number;
  rotation: number;
  displayScaleX: number;
  displayScaleY: number;
  handle: ResizeHandle;
  dxScreen: number;
  dyScreen: number;
  uniform: boolean;
}): { width: number; height: number } {
  const sx = input.displayScaleX > 0 ? input.displayScaleX : 1;
  const sy = input.displayScaleY > 0 ? input.displayScaleY : 1;
  const sign = CORNER_SIGNS[input.handle];

  // Screen delta → local-axis delta: undo the display scale per screen axis, then
  // inverse-rotate into the element's local frame. Display scale is aspect-preserving
  // in the studio preview (editScaleX ≈ editScaleY); the per-axis divide keeps the
  // common equal-scale case exact and degrades gracefully otherwise.
  const localDelta = rotateVector(
    { x: input.dxScreen / sx, y: input.dyScreen / sy },
    -input.rotation,
  );
  const deltaW = sign.x * localDelta.x;
  const deltaH = sign.y * localDelta.y;

  if (input.uniform) {
    const baseWidth = Math.max(input.baseWidth, 1);
    const baseHeight = Math.max(input.baseHeight, 1);
    const ratio = baseHeight / baseWidth;
    let width: number;
    let height: number;
    if (Math.abs(deltaW) >= Math.abs(deltaH)) {
      width = Math.max(MIN_RESIZE_LOCAL_PX, baseWidth + deltaW);
      height = Math.max(MIN_RESIZE_LOCAL_PX, width * ratio);
    } else {
      height = Math.max(MIN_RESIZE_LOCAL_PX, baseHeight + deltaH);
      width = Math.max(MIN_RESIZE_LOCAL_PX, height / ratio);
    }
    return { width, height };
  }

  return {
    width: Math.max(MIN_RESIZE_LOCAL_PX, input.baseWidth + deltaW),
    height: Math.max(MIN_RESIZE_LOCAL_PX, input.baseHeight + deltaH),
  };
}

/**
 * The eight CSS resize cursors, rotated with the object. A corner's base pointing
 * direction (the diagonal it lives on) plus the element rotation, bucketed into
 * 45° slots. So a 90°-rotated NW corner reads as a NE-diagonal cursor, etc.
 */
const CURSORS_8 = [
  "ns-resize", // 0°   (up)
  "nesw-resize", // 45°
  "ew-resize", // 90°  (right)
  "nwse-resize", // 135°
  "ns-resize", // 180° (down)
  "nesw-resize", // 225°
  "ew-resize", // 270° (left)
  "nwse-resize", // 315°
] as const;

/** Base outward diagonal angle of each corner, in degrees, screen convention
 *  (0° = up, clockwise). NW points up-left = 315°, NE up-right = 45°, etc. */
const CORNER_BASE_ANGLE_DEG: Record<ResizeHandle, number> = {
  nw: 315,
  ne: 45,
  se: 135,
  sw: 225,
};

/** Resize cursor for a corner handle on an element rotated by `rotationDeg`. */
export function resolveRotatedResizeCursor(handle: ResizeHandle, rotationDeg: number): string {
  const angle = CORNER_BASE_ANGLE_DEG[handle] + rotationDeg;
  const normalized = ((angle % 360) + 360) % 360;
  const bucket = Math.round(normalized / 45) % 8;
  return CURSORS_8[bucket]!;
}

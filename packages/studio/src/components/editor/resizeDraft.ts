import type { GestureState } from "./domEditOverlayGestures";
import { resolveResizeCenterAnchorOffset } from "./domEditOverlayGestures";
import type { OverlayRect } from "./domEditOverlayGeometry";
import {
  cornerEdgeLength,
  elementCornerOverlayPoints,
  overlayCornersCentroid,
} from "./domEditOverlayGeometry";
import { computeNextResizeAnchor } from "./domEditResizeLocal";
import { applyManualOffsetDragDraft } from "./manualOffsetDrag";

/**
 * The overlay rect to paint for the current resize pointer-move frame.
 *
 * Keeps the element's CENTER visually planted by translating it through the
 * manual-offset channel (member created at gesture start, on every corner): pin
 * the center by measuring the centroid of its real transformed corners after the
 * size write and translating it back to its gesture-start center — rotation-safe
 * for any transform-origin. Memberless is a defensive fallback. Mutates
 * `g.lastResizeAnchor` and applies the offset draft as a side effect.
 */
// fallow-ignore-next-line complexity
export function resolveResizeDraftRect(
  g: GestureState,
  element: HTMLElement,
  overlayEl: HTMLDivElement | null,
  iframe: HTMLIFrameElement | null,
  measureOrientedRect: () => OverlayRect | null,
): OverlayRect {
  if (g.pathOffsetMember) {
    // Measure real corners ONCE — reused below, skipping a redundant measureOrientedRect call.
    const corners =
      overlayEl && iframe ? elementCornerOverlayPoints(overlayEl, iframe, element) : null;
    const fixedStart = g.resizeFixedCenterStart;
    let anchor: { dx: number; dy: number };
    if (corners && fixedStart) {
      // `centerNow` is measured on the LIVE element, which already carries the
      // offset applied on the PREVIOUS frame. `applyManualOffsetDragDraft` treats
      // its argument as the ABSOLUTE offset (from initialOffset 0), so
      // `fixedStart - centerNow` is only the RESIDUAL correction — it must be
      // ADDED to the offset already in flight, not used as the absolute value.
      // Using it absolutely makes the anchor oscillate between the correct value
      // and zero every frame (measure moves the center back to fixedStart →
      // residual 0 → offset dropped → center un-pins → repeat). Release then
      // commits whichever parity the last pointermove landed on, so the element
      // "shifts a bit" after release. Accumulate onto the previous anchor to
      // converge (fa4f39168).
      const centerNow = overlayCornersCentroid(corners);
      anchor = computeNextResizeAnchor(g.lastResizeAnchor, fixedStart, centerNow);
    } else {
      // Geometry unmeasurable — fall back to the AABB half-delta.
      const fallbackRect = measureOrientedRect();
      anchor = resolveResizeCenterAnchorOffset({
        originWidth: g.originWidth,
        originHeight: g.originHeight,
        overlayWidth: fallbackRect ? fallbackRect.width : g.originWidth,
        overlayHeight: fallbackRect ? fallbackRect.height : g.originHeight,
      });
    }
    g.lastResizeAnchor = anchor;
    applyManualOffsetDragDraft(g.pathOffsetMember, anchor.dx, anchor.dy);
    // Re-measure the oriented box AFTER the anchor translate so it hugs the
    // element's true rendered bounds every frame.
    const anchoredRect = measureOrientedRect();
    return (
      anchoredRect ?? {
        left: g.originLeft + anchor.dx,
        top: g.originTop + anchor.dy,
        width: corners ? cornerEdgeLength(corners.nw, corners.ne) : g.originWidth,
        height: corners ? cornerEdgeLength(corners.nw, corners.sw) : g.originHeight,
        editScaleX: g.editScaleX,
        editScaleY: g.editScaleY,
        angle: g.actualRotation,
      }
    );
  }
  // Re-measure the element's oriented box AFTER the size write. The size draft
  // rounds/clamps and (with a centered transform-origin + GSAP scale) the real
  // rendered size diverges from the CSS size, so measure rather than trust math.
  const sizedRect = measureOrientedRect();
  return (
    sizedRect ?? {
      left: g.originLeft,
      top: g.originTop,
      width: g.originWidth,
      height: g.originHeight,
      editScaleX: g.editScaleX,
      editScaleY: g.editScaleY,
      angle: g.actualRotation,
    }
  );
}

import {
  ROTATED_SNAP_BYPASS_DEGREES,
  lockDragToDominantAxis,
  type GestureState,
  type UseDomEditOverlayGesturesOptions,
} from "./domEditOverlayGestures";
import { hugRectForElement } from "./domEditOverlayCrop";
import {
  resolveEquidistanceGuides,
  resolveSnapAdjustment,
  snapEngagedForTravel,
  SNAP_THRESHOLD_PX,
} from "./snapEngine";

type PointerLike = Pick<PointerEvent, "clientX" | "clientY" | "shiftKey" | "altKey">;

/** A single drag's step for this pointer: axis lock, then edge snapping; sets the snap guides. */
export function snappedDragDelta(
  g: GestureState,
  e: PointerLike,
  snapGuidesRef: UseDomEditOverlayGesturesOptions["snapGuidesRef"],
): { dx: number; dy: number } {
  let dx = e.clientX - g.startX;
  let dy = e.clientY - g.startY;
  const lock = lockDragToDominantAxis(dx, dy, e.shiftKey);
  dx = lock.dx;
  dy = lock.dy;
  const sc = g.snapContext;
  // Bypass edge-snapping for rotated elements — the snap targets and the
  // snapped rect are axis-aligned, so snapping a rotated box's AABB shifts it
  // unpredictably. Rotation ~0 keeps snapping exactly as before.
  const dragRotated = Math.abs(g.actualRotation) >= ROTATED_SNAP_BYPASS_DEGREES;
  if (!dragRotated && sc?.snapEnabled && sc.targets.length > 0) {
    // Snap the element's VISIBLE (crop-hugged) edges, not the full bounds.
    const movingRect = hugRectForElement(
      {
        left: g.originLeft,
        top: g.originTop,
        width: g.originWidth,
        height: g.originHeight,
        editScaleX: g.editScaleX,
        editScaleY: g.editScaleY,
      },
      g.selection.element,
    );
    const allTargets = sc.compositionTarget ? [...sc.targets, sc.compositionTarget] : sc.targets;
    const snap = resolveSnapAdjustment({
      movingRect,
      proposedDx: dx,
      proposedDy: dy,
      // Same reason as the group path: a snap on a drag that has not travelled
      // yet moves the element while the pointer is still.
      disabledForTravel: !snapEngagedForTravel(dx, dy),
      targets: allTargets,
      gridEdges: sc.gridEdges ?? undefined,
      threshold: SNAP_THRESHOLD_PX,
      disabled: e.altKey,
      lockedAxis: lock.lockedAxis,
    });
    dx = snap.dx;
    dy = snap.dy;
    const movedRect = {
      left: movingRect.left + dx,
      top: movingRect.top + dy,
      width: movingRect.width,
      height: movingRect.height,
    };
    const spacingGuides = e.altKey
      ? []
      : resolveEquidistanceGuides({
          movingRect: movedRect,
          targets: allTargets,
          threshold: SNAP_THRESHOLD_PX,
        });
    snapGuidesRef.current = { guides: snap.guides, spacingGuides };
  }
  g.lastSnappedDx = dx;
  g.lastSnappedDy = dy;
  return { dx, dy };
}

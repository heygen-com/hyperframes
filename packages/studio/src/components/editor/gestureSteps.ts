import {
  isDomEditGestureTap,
  movesGesture,
  resolveDomEditRotationGesture,
  type GestureState,
  type UseDomEditOverlayGesturesOptions,
} from "./domEditOverlayGestures";
import { resolveCenterResizeSize } from "./domEditResizeLocal";
import { groupDragDelta } from "./groupDragMove";
import { applyManualOffsetDragDraft } from "./manualOffsetDrag";
import { applyStudioBoxSizeDraft } from "./manualEdits";
import { resolveResizeDraftRect } from "./resizeDraft";
import { applyRotationDraft } from "./rotationDraft";
import { snappedDragDelta } from "./snappedDragDelta";
import { armRawPointerSteps } from "./rawPointerSteps";
import { previewFrameOpaque } from "../../player/lib/previewChannel";

type PointerLike = Pick<PointerEvent, "clientX" | "clientY" | "shiftKey" | "altKey">;

export const rotationAt = (g: GestureState, e: PointerLike) =>
  resolveDomEditRotationGesture({
    centerX: g.centerX,
    centerY: g.centerY,
    startX: g.startX,
    startY: g.startY,
    currentX: e.clientX,
    currentY: e.clientY,
    actualAngle: g.actualRotation,
    snap: e.shiftKey,
  }).angle;

/** Corner resize scales proportionally about the center, without edge snapping. */
export function resizeSizeAt(g: GestureState, e: PointerLike) {
  const grab = g.resizePressFromCorner ?? { x: 0, y: 0 };
  return resolveCenterResizeSize({
    baseWidth: g.actualWidth,
    baseHeight: g.actualHeight,
    pointer: { x: e.clientX - grab.x, y: e.clientY - grab.y },
    pointerStart: { x: g.startX - grab.x, y: g.startY - grab.y },
    centerStart: { x: g.centerX, y: g.centerY },
  });
}

function drawGestureStep(
  g: GestureState,
  element: HTMLElement,
  e: PointerEvent,
  opts: UseDomEditOverlayGesturesOptions,
) {
  if (g.kind === "rotate") return applyRotationDraft(element, rotationAt(g, e), g.plainRotation);
  if (g.kind === "drag") {
    const { dx, dy } = snappedDragDelta(g, e, opts.snapGuidesRef);
    if (g.pathOffsetMember) applyManualOffsetDragDraft(g.pathOffsetMember, dx, dy);
    return;
  }
  const wanted = resizeSizeAt(g, e);
  const written = applyStudioBoxSizeDraft(element, wanted);
  resolveResizeDraftRect(g, element, null, opts.iframeRef.current, () => null, { wanted, written });
}

/** The sealed frame's drafts for this pointer, whatever gesture is held; false once none is. */
// fallow-ignore-next-line complexity
function drawSealedRawStep(opts: UseDomEditOverlayGesturesOptions, e: PointerEvent) {
  const g = opts.gestureRef.current;
  const groupG = opts.groupGestureRef.current;
  const held = groupG ?? g;
  if (!held) return false;
  if (opts.waitingPressRef.current || !movesGesture(held, e)) return true;
  if (!isDomEditGestureTap(held, e)) held.travelled = true;
  if (groupG) {
    const { dx, dy } = groupDragDelta(groupG, e, opts.snapGuidesRef);
    for (const member of groupG.members) applyManualOffsetDragDraft(member, dx, dy);
    return true;
  }
  const element = (g?.selection ?? opts.selectionRef.current)?.element;
  if (g && element) drawGestureStep(g, element, e, opts);
  return true;
}

/** Armed at press, so a sealed gesture's first draft already goes out on the first raw update. */
export function armSealedRawSteps(opts: UseDomEditOverlayGesturesOptions) {
  const iframe = opts.iframeRef.current;
  if (iframe && previewFrameOpaque(iframe))
    armRawPointerSteps(opts.gestureRef, (e) => drawSealedRawStep(opts, e));
}

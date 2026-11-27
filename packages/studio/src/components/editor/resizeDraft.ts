import type { GestureState } from "./domEditOverlayGestures";
import type { OverlayRect } from "./domEditOverlayGeometry";
import { cornerEdgeLength, elementCornerOverlayPoints } from "./domEditOverlayGeometry";
import { resizeRemainderShift } from "./domEditResizeLocal";
import type { ResizeDraftSizes } from "./domEditResizeLocal";
import { applyManualOffsetDragDraft } from "./manualOffsetDrag";
import { endStudioManualEditGesture, isStudioManualEditGestureCurrent } from "./manualEdits";
import { drawPreviewDraft, endPreviewDraft } from "./previewDrafts";
import { previewFrameOpaque } from "../../player/lib/previewChannel";

type Corners = ReturnType<typeof elementCornerOverlayPoints>;

/**
 * Center-pinned draft rect: translate the element through the manual-offset
 * channel to keep its gesture-start center planted (rotation-safe for any
 * transform-origin), then hug its true rendered bounds. Mutates
 * `g.lastResizeAnchor` and applies the offset draft as a side effect.
 */
function resolveAnchoredResizeDraft(
  g: GestureState,
  member: NonNullable<GestureState["pathOffsetMember"]>,
  element: HTMLElement,
  overlayEl: HTMLDivElement | null,
  iframe: HTMLIFrameElement | null,
  measureOrientedRect: () => OverlayRect | null,
  sizes: ResizeDraftSizes,
): OverlayRect {
  const anchor = resizeAnchor(g, sizes.written, sizes.wanted);
  g.lastResizeAnchor = anchor;
  applyManualOffsetDragDraft(member, anchor.dx, anchor.dy);
  // Measured after the anchor translate so it hugs the element every frame.
  const corners =
    overlayEl && iframe ? elementCornerOverlayPoints(overlayEl, iframe, element) : null;
  return (
    measureOrientedRect() ?? {
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

function grabOf(g: GestureState): { x: number; y: number } {
  const press = g.resizePressFromCorner ?? { x: 0, y: 0 };
  return { x: g.startX - press.x - g.centerX, y: g.startY - press.y - g.centerY };
}

/** The box's corners at the written size from the gesture's own geometry, for a frame Studio cannot measure. */
function gestureCorners(
  g: GestureState,
  written: { width: number; height: number },
): NonNullable<Corners> {
  const rad = (g.actualRotation * Math.PI) / 180;
  const [sx, sy] = [g.editScaleX * g.contentScaleX, g.editScaleY * g.contentScaleY];
  const [w, h] = [(written.width * sx) / 2, (written.height * sy) / 2];
  const at = (u: number, v: number) => ({
    x: g.centerX + u * Math.cos(rad) - v * Math.sin(rad),
    y: g.centerY + u * Math.sin(rad) + v * Math.cos(rad),
  });
  return { nw: at(-w, -h), ne: at(w, -h), sw: at(-w, h), se: at(w, h) };
}

/** The pin that keeps a resize's centre still: back by what the frame measured the drawn size moving it. */
export function resizeAnchor(
  g: GestureState,
  written: { width: number; height: number },
  wanted = written,
): { dx: number; dy: number } {
  const [w, h] = [g.actualWidth - written.width, g.actualHeight - written.height];
  const grow = g.resizeGrow;
  const shift = resizeRemainderShift(gestureCorners(g, written), grabOf(g), { wanted, written });
  if (!grow) return { dx: (w / 2) * g.editScaleX + shift.x, dy: (h / 2) * g.editScaleY + shift.y };
  return { dx: grow.a * w + grow.c * h + shift.x, dy: grow.b * w + grow.d * h + shift.y };
}

function resolveUnmeasuredResizeDraft(
  g: GestureState,
  element: HTMLElement,
  sizes: ResizeDraftSizes,
): OverlayRect {
  const { written } = sizes;
  const width = (g.originWidth * written.width) / g.actualWidth;
  const height = (g.originHeight * written.height) / g.actualHeight;
  let shift = { x: 0, y: 0 };
  if (g.pathOffsetMember) {
    const anchor = resizeAnchor(g, written, sizes.wanted);
    shift = resizeRemainderShift(gestureCorners(g, written), grabOf(g), sizes);
    g.lastResizeAnchor = anchor;
    applyManualOffsetDragDraft(g.pathOffsetMember, anchor.dx, anchor.dy);
  }
  drawPreviewDraft(element, { size: written });
  return {
    left: g.originLeft + (g.originWidth - width) / 2 + shift.x,
    top: g.originTop + (g.originHeight - height) / 2 + shift.y,
    width,
    height,
    editScaleX: g.editScaleX,
    editScaleY: g.editScaleY,
    angle: g.actualRotation,
  };
}

/** Ends a settled resize that has no offset member; a frame it drew on keeps the new size. */
export function endResizeWithoutMember(element: HTMLElement, token: string | undefined): void {
  if (!token || isStudioManualEditGestureCurrent(element, token)) endPreviewDraft(element, "keep");
  endStudioManualEditGesture(element, token);
}

/** The overlay rect to paint for the current resize pointer-move frame. */
export function resolveResizeDraftRect(
  g: GestureState,
  element: HTMLElement,
  overlayEl: HTMLDivElement | null,
  iframe: HTMLIFrameElement | null,
  measureOrientedRect: () => OverlayRect | null,
  sizes: ResizeDraftSizes,
): OverlayRect {
  if (iframe && previewFrameOpaque(iframe)) return resolveUnmeasuredResizeDraft(g, element, sizes);
  if (g.pathOffsetMember) {
    return resolveAnchoredResizeDraft(
      g,
      g.pathOffsetMember,
      element,
      overlayEl,
      iframe,
      measureOrientedRect,
      sizes,
    );
  }
  // Re-measure the element's oriented box AFTER the size write. The size draft
  // rounds/clamps and (with a centered transform-origin + GSAP scale) the real
  // rendered size diverges from the CSS size, so measure rather than trust math.
  return (
    measureOrientedRect() ?? {
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

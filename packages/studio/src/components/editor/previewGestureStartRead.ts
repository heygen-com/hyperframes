/** A gesture on a frame Studio cannot script starts from one `gesture-start` read (core `editingGestureStart.ts`). */
import { previewGestureStart } from "../../player/lib/previewElements";
import { computeOverlayRootScale } from "./domEditOverlayBasis";
import type { OverlayRect } from "./domEditOverlayGeometry";
import { invertManualOffsetDragMatrix, type ManualOffsetDragMatrix } from "./manualOffsetDrag";
import { flatVisibleRect, groupAwareRect } from "./previewOverlayRects";
import { snapContextFromRects, type SnapContext } from "./snapTargetCollection";

export interface PreviewGestureStart {
  /** The transform-free border box a resize grows from; 0 for an element with none. */
  layout: { width: number; height: number };
  /** Pointer px to translate px, as `measureManualOffsetDragScreenToOffsetMatrix`; null when unmeasured. */
  screenToOffset: ManualOffsetDragMatrix | null;
  /** GSAP's x/y when it owns the element's position, and whether a tween with a duration moves it. */
  gsap: { x: number; y: number; moving: boolean } | null;
}

export interface PreviewGestureStarts {
  elements: Array<{ rect: OverlayRect; start: PreviewGestureStart } | null>;
  snap: SnapContext;
}

/** Everything a gesture on `handles` reads from the frame, in one request; null when it cannot answer. */
export async function measurePreviewGestureStart(
  iframe: HTMLIFrameElement,
  overlayEl: HTMLDivElement,
  handles: string[],
): Promise<PreviewGestureStarts | null> {
  const reply = await previewGestureStart(iframe, handles);
  const scale = reply && computeOverlayRootScale(overlayEl, iframe, null);
  if (!reply || !scale) return null;
  const { iframeRect, overlayRect, rootScaleX: sx, rootScaleY: sy } = scale;
  // The frame measures its own px; a frame px is `rootScaleX` by `rootScaleY` pointer px on the page.
  const screenToOffset = (move: { a: number; b: number; c: number; d: number } | null) =>
    move &&
    invertManualOffsetDragMatrix({
      a: move.a * sx,
      b: move.b * sy,
      c: move.c * sx,
      d: move.d * sy,
    });
  const composition: OverlayRect = {
    left: iframeRect.left - overlayRect.left,
    top: iframeRect.top - overlayRect.top,
    width: iframeRect.width,
    height: iframeRect.height,
    editScaleX: sx,
    editScaleY: sy,
  };
  return {
    elements: reply.elements.map(
      (start) =>
        start && {
          rect: groupAwareRect(scale, start, true),
          start: {
            layout: start.layout,
            screenToOffset: screenToOffset(start.move),
            gsap: start.gsap,
          },
        },
    ),
    snap: snapContextFromRects(
      composition,
      reply.snap.map((box) => flatVisibleRect(scale, box)),
    ),
  };
}

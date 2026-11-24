/** A gesture on a frame Studio cannot script starts from one `gesture-start` read (core `editingGestureStart.ts`). */
import type { EditingGestureStart } from "@hyperframes/core/runtime/editing-port";
import { previewGestureStart } from "../../player/lib/previewElements";
import { previewRootHasNoSize, whenPreviewStageSized } from "../../player/lib/bridgePlayback";
import { computeOverlayRootScale } from "./domEditOverlayBasis";
import type { DomEditSelection } from "./domEditing";
import type { CropFrameStart } from "./domEditOverlayCrop";
import type { OverlayRect } from "./domEditOverlayGeometry";
import { invertManualOffsetDragMatrix, type ManualOffsetDragMatrix } from "./manualOffsetDrag";
import { flatVisibleRect, groupAwareRect } from "./previewOverlayRects";
import { findPreviewElementForSelection, standInFor } from "./previewSelection";
import { snapContextFromRects, type SnapContext } from "./snapTargetCollection";

export interface PreviewGestureStart {
  /** The transform-free border box a resize grows from; 0 for an element with none. */
  layout: { width: number; height: number };
  /** Pointer px to translate px, as `measureManualOffsetDragScreenToOffsetMatrix`; null when unmeasured. */
  screenToOffset: ManualOffsetDragMatrix | null;
  /** GSAP's x/y when it owns the element's position, and whether a tween with a duration moves it. */
  gsap: { x: number; y: number; moving: boolean; drawsTranslate?: true } | null;
  gsapRotation?: number | null;
  grow?: { a: number; b: number; c: number; d: number };
  cssRotation?: EditingGestureStart["cssRotation"];
}

export interface PreviewGestureStarts {
  elements: Array<{ rect: OverlayRect; start: PreviewGestureStart } | null>;
  snap: SnapContext;
}

const startLayouts = new Map<string, PreviewGestureStart["layout"]>();

export const gestureStartLayout = (handle: string) => startLayouts.get(handle) ?? null;

/** Everything a gesture on `handles` reads from the frame, in one request; null when it cannot answer. */
export async function measurePreviewGestureStart(
  iframe: HTMLIFrameElement,
  overlayEl: HTMLDivElement,
  handles: string[],
): Promise<PreviewGestureStarts | null> {
  const reply = await previewGestureStart(iframe, handles);
  startLayouts.clear();
  reply?.elements.forEach((start, i) => {
    const { width = 0, height = 0 } = start?.layout ?? {};
    if (width >= 1 && height >= 1) startLayouts.set(handles[i]!, { width, height });
  });
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
            gsapRotation: start.gsapRotation,
            grow: start.grow
              ? {
                  a: start.grow.a * sx,
                  b: start.grow.b * sy,
                  c: start.grow.c * sx,
                  d: start.grow.d * sy,
                }
              : undefined,
            cssRotation: start.cssRotation,
          },
        },
    ),
    snap: snapContextFromRects(
      composition,
      reply.snap.map((box) => flatVisibleRect(scale, box)),
    ),
  };
}

export type Shown = { selection: DomEditSelection; rect: OverlayRect; start?: PreviewGestureStart };
export type OverChannel = { shown: Shown[]; snap?: SnapContext };

export const UNANSWERED = "unanswered";
export const PRESS_WAIT_MAX_MS = 10_000;

export const unansweredMoveReason = (iframe: HTMLIFrameElement) =>
  previewRootHasNoSize(iframe)
    ? "This composition has no size, so Studio can't move its layers. Give its root a width and height."
    : "The preview didn't answer, so Studio can't move this layer. Try again.";

export async function askShownGestureStarts(
  iframe: HTMLIFrameElement,
  overlay: HTMLDivElement | null,
  path: string | null,
  selections: DomEditSelection[],
): Promise<OverChannel | null | typeof UNANSWERED> {
  const found = await Promise.all(
    selections.map((selection) => findPreviewElementForSelection(iframe, selection, path)),
  );
  if (found.includes(undefined)) return UNANSWERED;
  const handles = found.map((element) => element?.handle);
  if (!overlay || !handles.length || !handles.every(Boolean)) return null;
  await whenPreviewStageSized(iframe, PRESS_WAIT_MAX_MS);
  const read = await measurePreviewGestureStart(iframe, overlay, handles as string[]);
  if (!read) return UNANSWERED;
  const shown = selections.flatMap((selection, i) => {
    const start = read.elements[i];
    const onFrame = found[i];
    if (!start || !onFrame) return [];
    const element = standInFor(iframe, onFrame);
    return [{ selection: { ...selection, handle: onFrame.handle, element }, ...start }];
  });
  return shown.length === selections.length ? { shown, snap: read.snap } : null;
}

export async function readCropFrameStart(
  iframe: HTMLIFrameElement,
  handle: string,
): Promise<CropFrameStart | null> {
  const start = (await previewGestureStart(iframe, [handle]))?.elements[0];
  return start ? { layout: start.layout } : null;
}

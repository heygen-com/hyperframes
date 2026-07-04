import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { DomEditSelection } from "./domEditing";
import type { OverlayRect } from "./domEditOverlayGeometry";
import {
  type CropEdge,
  cropRectFromInsets,
  readElementCropInsets,
  resolveCropInsetFromEdgeDrag,
  resolveCropInsetFromMoveDrag,
} from "./domEditOverlayCrop";
import { buildInsetClipPathSides, type ClipPathInsetSides } from "./clipPathHelpers";

interface CropGestureState {
  edge: CropEdge | "move";
  pointerId: number;
  startX: number;
  startY: number;
  startInsets: ClipPathInsetSides;
  didMove: boolean;
}

interface DomEditCropHandlesProps {
  selection: DomEditSelection;
  overlayRect: OverlayRect;
  onStyleCommit?: (property: string, value: string) => Promise<void> | void;
}

function handleCenter(
  edge: CropEdge,
  rect: { left: number; top: number; width: number; height: number },
) {
  if (edge === "top") return { left: rect.left + rect.width / 2, top: rect.top };
  if (edge === "right") return { left: rect.left + rect.width, top: rect.top + rect.height / 2 };
  if (edge === "bottom") return { left: rect.left + rect.width / 2, top: rect.top + rect.height };
  return { left: rect.left, top: rect.top + rect.height / 2 };
}

const EDGES: CropEdge[] = ["top", "right", "bottom", "left"];

/**
 * Pro-editor crop: while crop mode is active the element's clip is lifted so
 * the FULL content stays visible; the cropped-out region is dimmed and the
 * edge handles sit on the crop lines. Dragging updates the crop live; release
 * commits `clip-path: inset(...)` through the normal style-commit path (one
 * undo step per drag). Leaving crop mode re-applies the committed crop.
 */
export function DomEditCropHandles({
  selection,
  overlayRect,
  onStyleCommit,
}: DomEditCropHandlesProps) {
  const gestureRef = useRef<CropGestureState | null>(null);
  const [state, setState] = useState(() => {
    const parsed = readElementCropInsets(selection.element);
    return {
      element: selection.element,
      insets: {
        top: parsed.top,
        right: parsed.right,
        bottom: parsed.bottom,
        left: parsed.left,
      } as ClipPathInsetSides,
      radius: parsed.radius,
    };
  });

  // Re-sync when the selection element changes (reselect, undo/redo reload).
  if (state.element !== selection.element) {
    const parsed = readElementCropInsets(selection.element);
    setState({
      element: selection.element,
      insets: { top: parsed.top, right: parsed.right, bottom: parsed.bottom, left: parsed.left },
      radius: parsed.radius,
    });
  }

  // The value to re-apply when crop mode ends (latest committed crop).
  const committedRef = useRef<string | null>(null);
  {
    const hasCrop =
      state.insets.top > 0 ||
      state.insets.right > 0 ||
      state.insets.bottom > 0 ||
      state.insets.left > 0;
    committedRef.current = hasCrop ? buildInsetClipPathSides(state.insets, state.radius) : null;
  }

  // Lift the clip while crop mode is active so the full content shows through
  // the dim; restore the committed crop on exit/unmount.
  const liftedRef = useRef(false);
  useEffect(() => {
    const el = selection.element;
    el.style.setProperty("clip-path", "none");
    liftedRef.current = true;
    return () => {
      liftedRef.current = false;
      if (committedRef.current) el.style.setProperty("clip-path", committedRef.current);
      else el.style.removeProperty("clip-path");
    };
  }, [selection.element]);

  const scaleX = overlayRect.editScaleX > 0 ? overlayRect.editScaleX : 1;
  const scaleY = overlayRect.editScaleY > 0 ? overlayRect.editScaleY : 1;
  const width = overlayRect.width / scaleX;
  const height = overlayRect.height / scaleY;
  const cropRect = cropRectFromInsets(overlayRect, state.insets, scaleX, scaleY);

  const startCropGesture = (edge: CropEdge | "move", event: ReactPointerEvent<HTMLElement>) => {
    if (!onStyleCommit) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      edge,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startInsets: state.insets,
      didMove: false,
    };
  };

  const updateCropGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const drag = {
      startInsets: gesture.startInsets,
      deltaX: event.clientX - gesture.startX,
      deltaY: event.clientY - gesture.startY,
      scaleX,
      scaleY,
    };
    const nextInsets =
      gesture.edge === "move"
        ? resolveCropInsetFromMoveDrag(drag)
        : resolveCropInsetFromEdgeDrag({ ...drag, edge: gesture.edge, width, height });
    gesture.didMove = true;
    setState((prev) => ({ ...prev, insets: nextInsets }));
  };

  const finishCropGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    gestureRef.current = null;
    if (!gesture.didMove) return;
    // Commit to the file; the commit path re-applies the value to the live
    // element, so lift it back to "none" afterwards — full content + dim is
    // the crop-mode presentation.
    const el = selection.element;
    void Promise.resolve(
      onStyleCommit?.("clip-path", buildInsetClipPathSides(state.insets, state.radius)),
    ).then(() => {
      if (liftedRef.current) el.style.setProperty("clip-path", "none");
    });
  };

  const cancelCropGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setState((prev) => ({ ...prev, insets: gesture.startInsets }));
    gestureRef.current = null;
  };

  return (
    <>
      {/* Dim everything of the element outside the crop region. */}
      <div
        className="pointer-events-none absolute overflow-hidden"
        style={{
          left: overlayRect.left,
          top: overlayRect.top,
          width: overlayRect.width,
          height: overlayRect.height,
        }}
      >
        <div
          className="absolute"
          style={{
            left: cropRect.left - overlayRect.left,
            top: cropRect.top - overlayRect.top,
            width: cropRect.width,
            height: cropRect.height,
            boxShadow: "0 0 0 100000px rgba(8, 8, 12, 0.6)",
          }}
        />
      </div>
      {/* Crop frame — drag it to move the whole crop window. */}
      <div
        data-dom-edit-crop-frame="true"
        className="pointer-events-auto absolute border-2 border-studio-accent shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
        style={{
          left: cropRect.left,
          top: cropRect.top,
          width: cropRect.width,
          height: cropRect.height,
          cursor: "move",
          touchAction: "none",
        }}
        onPointerDown={(event) => startCropGesture("move", event)}
        onPointerMove={updateCropGesture}
        onPointerUp={finishCropGesture}
        onPointerCancel={cancelCropGesture}
      />
      {EDGES.map((edge) => {
        const center = handleCenter(edge, cropRect);
        const vertical = edge === "left" || edge === "right";
        return (
          <button
            key={edge}
            type="button"
            aria-label={`Crop ${edge}`}
            data-dom-edit-crop-handle="true"
            className="pointer-events-auto absolute rounded-sm border border-studio-accent bg-studio-accent shadow-[0_0_0_2px_rgba(60,230,172,0.18)]"
            style={{
              left: center.left,
              top: center.top,
              width: vertical ? 10 : 28,
              height: vertical ? 28 : 10,
              transform: "translate(-50%, -50%)",
              cursor: vertical ? "ew-resize" : "ns-resize",
              touchAction: "none",
            }}
            onPointerDown={(event) => startCropGesture(edge, event)}
            onPointerMove={updateCropGesture}
            onPointerUp={finishCropGesture}
            onPointerCancel={cancelCropGesture}
          />
        );
      })}
    </>
  );
}

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

// Gap (px) between an edge handle and the element edge, so the handle sits
// clear of the element body and can't intercept a move-drag.
const EDGE_HANDLE_GAP = 8;

/** Place an edge handle just OUTSIDE the given crop edge (translate pushes it
 *  fully past the boundary). Keeps the element body free for moving. */
function edgeHandlePlacement(
  edge: CropEdge,
  rect: { left: number; top: number; width: number; height: number },
) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  if (edge === "top") {
    return { left: cx, top: rect.top - EDGE_HANDLE_GAP, transform: "translate(-50%, -100%)" };
  }
  if (edge === "bottom") {
    return {
      left: cx,
      top: rect.top + rect.height + EDGE_HANDLE_GAP,
      transform: "translate(-50%, 0)",
    };
  }
  if (edge === "left") {
    return { left: rect.left - EDGE_HANDLE_GAP, top: cy, transform: "translate(-100%, -50%)" };
  }
  return {
    left: rect.left + rect.width + EDGE_HANDLE_GAP,
    top: cy,
    transform: "translate(0, -50%)",
  };
}

const EDGES: CropEdge[] = ["top", "right", "bottom", "left"];

/**
 * Always-on crop, integrated with the selection (no crop "mode"): while a
 * croppable element is selected its clip is lifted so the FULL content shows and
 * the cropped-away area is dimmed, with a dashed outline + an edge handle per
 * side on the crop boundary. Dragging an edge crops that side (a rule-of-thirds
 * grid guides framing); release commits `clip-path: inset(...)` through the
 * normal style-commit path (one undo step per drag). When cropped, a center
 * handle pans the crop window. Corners stay free for the selection's own resize
 * handle. Leaving the selection restores the committed crop. The clip-path model
 * is the source of truth — nothing here mutates layout.
 */
export function DomEditCropHandles({
  selection,
  overlayRect,
  onStyleCommit,
}: DomEditCropHandlesProps) {
  const gestureRef = useRef<CropGestureState | null>(null);
  const [dragging, setDragging] = useState(false);
  // readElementCropInsets returns null for a clip this tool can't represent
  // (circle/polygon/non-px inset): the crop UI must fully stand down for that
  // element — no lift, no handles — or select+deselect replaces the authored
  // clip with an inset (or deletes it).
  const cropStateFor = (element: HTMLElement) => {
    const parsed = readElementCropInsets(element);
    const { radius, ...insets } = parsed ?? { top: 0, right: 0, bottom: 0, left: 0, radius: 0 };
    return { element, croppable: parsed !== null, insets: insets as ClipPathInsetSides, radius };
  };
  const [state, setState] = useState(() => cropStateFor(selection.element));

  // Re-sync when the selection targets a different element (reselect, or an
  // undo/redo that re-keys the node): read its committed crop before the lift
  // effect runs. Read inside the guard so a drag's per-frame setState doesn't
  // re-run getComputedStyle every frame.
  if (state.element !== selection.element) {
    setState(cropStateFor(selection.element));
  }

  const hasCrop =
    state.insets.top > 0 ||
    state.insets.right > 0 ||
    state.insets.bottom > 0 ||
    state.insets.left > 0;

  // Latest committed crop — re-applied to the element when the selection drops.
  const committedRef = useRef<string | null>(null);
  committedRef.current = hasCrop ? buildInsetClipPathSides(state.insets, state.radius) : null;

  // Lift the clip while the element is selected so the full content shows and the
  // cropped-away area can be dimmed; restore on deselect. Keyed on the element so
  // switching selections restores the previous one. Runs after render, so the
  // state re-sync above still reads the element's real committed clip. Restore
  // prefers the pre-lift inline value VERBATIM — the rebuilt inset only replaces
  // it after a crop gesture actually commits, so a mere select+deselect can
  // never reformat (or drop) what the author wrote.
  const liftedRef = useRef(false);
  const preLiftInlineClipRef = useRef("");
  const cropCommittedRef = useRef(false);
  useEffect(() => {
    const el = selection.element;
    if (readElementCropInsets(el) === null) return;
    preLiftInlineClipRef.current = el.style.getPropertyValue("clip-path");
    cropCommittedRef.current = false;
    el.style.setProperty("clip-path", "none");
    liftedRef.current = true;
    return () => {
      liftedRef.current = false;
      const restore = cropCommittedRef.current
        ? committedRef.current
        : preLiftInlineClipRef.current || null;
      if (restore) el.style.setProperty("clip-path", restore);
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
    // Clip is already lifted by the selection effect; just flag the drag so the
    // rule-of-thirds grid shows.
    setDragging(true);
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
    setDragging(false);
    if (!gesture.didMove) return;
    // Commit to the file. The commit path re-applies the value to the live
    // element, so re-lift afterwards to keep showing the full content + dim while
    // the element stays selected. Re-lift on both fulfilment and rejection so a
    // failed commit still restores the crop-mode presentation (and the rejection
    // is handled rather than left unhandled).
    const el = selection.element;
    const reLift = () => {
      if (liftedRef.current) el.style.setProperty("clip-path", "none");
    };
    void Promise.resolve(
      onStyleCommit?.("clip-path", buildInsetClipPathSides(state.insets, state.radius)),
    ).then(() => {
      // Only a landed commit makes the rebuilt inset the restore value; a
      // failed one keeps restoring the pre-lift clip.
      cropCommittedRef.current = true;
      reLift();
    }, reLift);
  };

  const cancelCropGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    gestureRef.current = null;
    setDragging(false);
    // Clip stays lifted; the dim follows the reset insets.
    setState((prev) => ({ ...prev, insets: gesture.startInsets }));
  };

  // Uneditable clip (circle/polygon/non-px inset): the element renders exactly
  // as authored and the crop tool shows nothing. All hooks above stay mounted.
  if (!state.croppable) return null;

  return (
    <>
      {/* Dim the cropped-away area whenever the element is cropped and selected,
          so the hidden content is visible (ghosted) without dragging. */}
      {hasCrop && (
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
      )}
      {/* Dashed clip outline on the crop boundary, with a rule-of-thirds grid
          shown while dragging. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute border border-dashed border-studio-accent"
        style={{
          left: cropRect.left,
          top: cropRect.top,
          width: cropRect.width,
          height: cropRect.height,
        }}
      >
        {dragging && (
          <>
            <div className="absolute inset-y-0 left-1/3 w-px bg-studio-accent/40" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-studio-accent/40" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-studio-accent/40" />
            <div className="absolute inset-x-0 top-2/3 h-px bg-studio-accent/40" />
          </>
        )}
      </div>
      {/* Reposition handle — a center circle shown only once cropped. Drag it to
          pan the crop window (which part of the element shows) without resizing
          the crop. It's a small, discrete target, so a body drag still MOVES. */}
      {hasCrop && (
        <button
          type="button"
          aria-label="Reposition crop"
          data-dom-edit-crop-handle="true"
          className="pointer-events-auto absolute rounded-full border-2 border-studio-accent bg-studio-accent/30 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
          style={{
            left: cropRect.left + cropRect.width / 2,
            top: cropRect.top + cropRect.height / 2,
            width: 22,
            height: 22,
            transform: "translate(-50%, -50%)",
            cursor: "move",
            touchAction: "none",
          }}
          onPointerDown={(event) => startCropGesture("move", event)}
          onPointerMove={updateCropGesture}
          onPointerUp={finishCropGesture}
          onPointerCancel={cancelCropGesture}
        />
      )}
      {/* Edge handles — drag a side to crop it. Positioned just OUTSIDE the crop
          edge (via edgeHandlePlacement) so they never overlap the element body:
          dragging the body always MOVES, only a handle crops. */}
      {EDGES.map((edge) => {
        const vertical = edge === "left" || edge === "right";
        const place = edgeHandlePlacement(edge, cropRect);
        return (
          <button
            key={edge}
            type="button"
            aria-label={`Crop ${edge}`}
            data-dom-edit-crop-handle="true"
            className="pointer-events-auto absolute rounded-full bg-studio-accent shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
            style={{
              left: place.left,
              top: place.top,
              width: vertical ? 5 : 26,
              height: vertical ? 26 : 5,
              transform: place.transform,
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

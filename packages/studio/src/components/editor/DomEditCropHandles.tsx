import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { DomEditSelection } from "./domEditing";
import type { OverlayRect } from "./domEditOverlayGeometry";
import {
  type CropEdge,
  cropRectFromInsets,
  readElementCropFrame,
  readElementCropInsets,
  resolveCropInsetFromEdgeDrag,
  resolveCropInsetFromMoveDrag,
  rotateDeltaIntoFrame,
} from "./domEditOverlayCrop";
import { buildInsetClipPathSides, type ClipPathInsetSides } from "./clipPathHelpers";

interface CropGestureState {
  edge: CropEdge | "move";
  pointerId: number;
  startX: number;
  startY: number;
  startInsets: ClipPathInsetSides;
  didMove: boolean;
  /** Element frame captured at gesture start: pointer deltas rotate into it. */
  angleDeg: number;
  scaleX: number;
  scaleY: number;
}

interface DomEditCropHandlesProps {
  selection: DomEditSelection;
  overlayRect: OverlayRect;
  onStyleCommit?: (property: string, value: string) => Promise<void> | void;
}

// Hit-strip size (px) for an edge crop handle: THICKNESS extends outward from
// the crop edge (flush against it, never over the element body, so a body
// drag always MOVES), LENGTH runs along the edge. The visible pill is smaller
// and centered inside the strip.
const EDGE_HIT_THICKNESS = 12;
const EDGE_HIT_LENGTH = 32;

/** Place an edge handle's hit strip just OUTSIDE the given crop edge
 *  (translate pushes it fully past the boundary). Keeps the element body free
 *  for moving. Corners stay free for the selection's own resize handles. */
function edgeHandlePlacement(
  edge: CropEdge,
  rect: { left: number; top: number; width: number; height: number },
) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  if (edge === "top") {
    return { left: cx, top: rect.top, transform: "translate(-50%, -100%)" };
  }
  if (edge === "bottom") {
    return { left: cx, top: rect.top + rect.height, transform: "translate(-50%, 0)" };
  }
  if (edge === "left") {
    return { left: rect.left, top: cy, transform: "translate(-100%, -50%)" };
  }
  return { left: rect.left + rect.width, top: cy, transform: "translate(0, -50%)" };
}

const EDGES: CropEdge[] = ["top", "right", "bottom", "left"];

/** Hit-strip + pill dimensions for an edge handle, keyed on its orientation. */
function edgeHandleMetrics(vertical: boolean): {
  hitWidth: number;
  hitHeight: number;
  cursor: string;
  pillWidth: number;
  pillHeight: number;
} {
  return {
    hitWidth: vertical ? EDGE_HIT_THICKNESS : EDGE_HIT_LENGTH,
    hitHeight: vertical ? EDGE_HIT_LENGTH : EDGE_HIT_THICKNESS,
    cursor: vertical ? "ew-resize" : "ns-resize",
    pillWidth: vertical ? 4 : 24,
    pillHeight: vertical ? 24 : 4,
  };
}

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
  const [hotEdge, setHotEdge] = useState<CropEdge | null>(null);
  // readElementCropInsets returns null for a clip this tool can't represent
  // (circle/polygon/non-px inset): the crop UI must fully stand down for that
  // element — no lift, no handles — or select+deselect replaces the authored
  // clip with an inset (or deletes it).
  const cropStateFor = (element: HTMLElement) => {
    const parsed = readElementCropInsets(element);
    const { radius, ...insets } = parsed ?? { top: 0, right: 0, bottom: 0, left: 0, radius: 0 };
    return { element, croppable: parsed !== null, insets, radius };
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

  // Lift the clip while the element is selected so the full content shows and the
  // cropped-away area can be dimmed; restore on deselect. Keyed on the element so
  // switching selections restores the previous one. Runs after render, so the
  // state re-sync above still reads the element's real committed clip. Restore
  // prefers the pre-lift inline value VERBATIM — the rebuilt inset only replaces
  // it after a crop gesture actually commits, so a mere select+deselect can
  // never reformat (or drop) what the author wrote. Both refs are written only
  // by THIS element's lift effect and crop gestures — never derived from render
  // state, which by cleanup time already describes the NEXT selection (a direct
  // A→B switch re-syncs state to B before A's cleanup runs).
  const liftedRef = useRef(false);
  const preLiftInlineClipRef = useRef("");
  // null = no crop gesture committed this selection; "" = committed a crop
  // removal; anything else = the exact committed clip-path value.
  const committedClipRef = useRef<string | null>(null);
  useEffect(() => {
    const el = selection.element;
    if (readElementCropInsets(el) === null) return;
    preLiftInlineClipRef.current = el.style.getPropertyValue("clip-path");
    committedClipRef.current = null;
    el.style.setProperty("clip-path", "none");
    liftedRef.current = true;
    return () => {
      liftedRef.current = false;
      const committed = committedClipRef.current;
      const restore = committed !== null ? committed || null : preLiftInlineClipRef.current || null;
      if (restore) el.style.setProperty("clip-path", restore);
      else el.style.removeProperty("clip-path");
    };
  }, [selection.element]);

  // The crop applies in the element's LOCAL frame (clip-path precedes the
  // transform), so all crop UI is drawn inside a container rotated with the
  // element — on a rotated element an axis-aligned dim visually "straightens"
  // it by masking the rotated corners.
  const frame = readElementCropFrame(selection.element, overlayRect);
  const width = frame.width / frame.scaleX; // element CSS px
  const height = frame.height / frame.scaleY;
  // Crop rect in FRAME-LOCAL coordinates (origin = frame top-left).
  const cropRect = cropRectFromInsets(
    { left: 0, top: 0, width: frame.width, height: frame.height },
    state.insets,
    frame.scaleX,
    frame.scaleY,
  );

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
      angleDeg: frame.angleDeg,
      scaleX: frame.scaleX,
      scaleY: frame.scaleY,
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
    const local = rotateDeltaIntoFrame(
      event.clientX - gesture.startX,
      event.clientY - gesture.startY,
      gesture.angleDeg,
    );
    const drag = {
      startInsets: gesture.startInsets,
      deltaX: local.deltaX,
      deltaY: local.deltaY,
      scaleX: gesture.scaleX,
      scaleY: gesture.scaleY,
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
    // element synchronously, so re-lift in the same turn to keep showing the full
    // content + dim while selected. Re-lift again on rejection so a failed commit
    // still restores crop-mode presentation without an unhandled rejection.
    const el = selection.element;
    const reLift = () => {
      if (liftedRef.current) el.style.setProperty("clip-path", "none");
    };
    const committedValue = buildInsetClipPathSides(state.insets, state.radius);
    const cropped =
      state.insets.top > 0 ||
      state.insets.right > 0 ||
      state.insets.bottom > 0 ||
      state.insets.left > 0;
    const commit = onStyleCommit?.("clip-path", committedValue);
    // handleDomStyleCommit applies the persisted value to the live element
    // synchronously before its first await. Restore the crop-mode lift in this
    // same turn so the browser never paints that intermediate cropped state.
    reLift();
    void Promise.resolve(commit).then(() => {
      // Only a landed commit makes the rebuilt inset the restore value; a
      // failed one keeps restoring the pre-lift clip. Store the value itself —
      // by deselect time, render state describes the next selection.
      committedClipRef.current = cropped ? committedValue : "";
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
    <div
      data-dom-edit-crop-frame="true"
      className="pointer-events-none absolute"
      style={{
        left: frame.left,
        top: frame.top,
        width: frame.width,
        height: frame.height,
        transform: frame.angleDeg !== 0 ? `rotate(${frame.angleDeg}deg)` : undefined,
      }}
    >
      {/* Dim the cropped-away area whenever the element is cropped and selected,
          so the hidden content is visible (ghosted) without dragging. Clipped to
          the element's own (rotated) box. */}
      {hasCrop && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute"
            style={{
              left: cropRect.left,
              top: cropRect.top,
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
          title="Reposition crop"
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
          dragging the body always MOVES, only a handle crops. The pill is
          hover-revealed (or shown while dragging / once a crop exists) so the
          resting selection chrome stays uncluttered; the hit strip is always
          live, and the title names the affordance. */}
      {EDGES.map((edge) => {
        const vertical = edge === "left" || edge === "right";
        const place = edgeHandlePlacement(edge, cropRect);
        const revealed = dragging || hasCrop || hotEdge === edge;
        const m = edgeHandleMetrics(vertical);
        return (
          <button
            key={edge}
            type="button"
            aria-label={`Crop ${edge}`}
            title="Crop"
            data-dom-edit-crop-handle="true"
            className="pointer-events-auto absolute flex items-center justify-center border-0 bg-transparent p-0"
            style={{
              left: place.left,
              top: place.top,
              width: m.hitWidth,
              height: m.hitHeight,
              transform: place.transform,
              cursor: m.cursor,
              touchAction: "none",
            }}
            onPointerEnter={() => setHotEdge(edge)}
            onPointerLeave={() => setHotEdge((prev) => (prev === edge ? null : prev))}
            onPointerDown={(event) => startCropGesture(edge, event)}
            onPointerMove={updateCropGesture}
            onPointerUp={finishCropGesture}
            onPointerCancel={cancelCropGesture}
          >
            <span
              className="pointer-events-none rounded-full bg-studio-accent/90 shadow-[0_0_0_1px_rgba(0,0,0,0.4)] transition-opacity duration-100"
              style={{
                width: m.pillWidth,
                height: m.pillHeight,
                opacity: revealed ? 1 : 0,
              }}
            />
          </button>
        );
      })}
    </div>
  );
}

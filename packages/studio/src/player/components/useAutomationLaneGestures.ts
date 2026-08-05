/**
 * The pointer gestures over an automation lane.
 *
 * Its own hook because the lane component sits at the studio's file ceiling and
 * because these are the parts worth testing on their own: which of a press,
 * a drag and a modifier resolves to moving a point, bending a segment,
 * stretching a selection's edge, or nothing at all.
 *
 * Modifiers follow Ableton's, since that is the muscle memory an automation lane
 * inherits: Shift locks a drag to one axis and fines the value down, Alt over a
 * segment curves it, and Alt during a point drag ignores the grid.
 */

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AutomationRange, HfAutomationLane } from "@hyperframes/core/audio-automation";
import {
  applyShiftConstraint,
  curveForDrag,
  formatValue,
  GRAB_PX,
  POINT_MERGE_SEC,
  snapLaneTime,
} from "./automationLaneGeometry";
import { retimeRange } from "./automationLaneSelection";

/** Snap radius in clip seconds. Tight on purpose: a lane is often a few seconds
 *  wide, where a generous radius makes a point unplaceable between two beats. */
const SNAP_SEC = 0.04;

/** Hit radius for grabbing a selection's edge, in screen px — independent of
 *  a point's own grab radius so the two zones can be reasoned about on their
 *  own, even though a point sitting on an edge still wins (see `gestureAt`). */
const EDGE_GRAB_PX = 8;

/** A point's position, or the origin when the index no longer resolves. */
function originOf(point: HfAutomationLane["points"][number] | undefined): { t: number; v: number } {
  return point ? { t: point.t, v: point.v } : { t: 0, v: 0 };
}

/**
 * Keep the rest of the gesture even if the pointer leaves the lane. Without it a
 * drag that strays outside the svg stops sending moves and the point sticks.
 */
function capturePointer(e: ReactPointerEvent<SVGSVGElement>): void {
  const target = e.target;
  if (target instanceof Element) target.setPointerCapture?.(e.pointerId);
}

export interface UseAutomationLaneGesturesInput {
  /** The lane's box on screen. A getter, not the ref: the hook only ever needs
   *  the rectangle, and a ref read inside a callback is a lint the rule is right
   *  about — the value is not a dependency it can track. */
  getBox(): DOMRect | null;
  lane: HfAutomationLane;
  range: AutomationRange;
  /** Pointer position as a clip-local time and a parameter value. */
  pointAt(clientX: number, clientY: number): { t: number; v: number };
  xOf(t: number): number;
  yOf(v: number): number;
  commitPoints(points: HfAutomationLane["points"], persist: boolean): void;
  /** Clip-local times a dragged point snaps to, on top of its own neighbours. */
  snapTimes?: readonly number[] | undefined;
  readOnly?: boolean | undefined;
  onSelect?: (() => void) | undefined;
  /** Live range-select callbacks; absent = background drags do nothing (read-only lanes). */
  onRangeSelect?: ((t0: number, t1: number) => void) | undefined;
  onRangeClear?: (() => void) | undefined;
  duration: number; // clamp bound for range endpoints
  /** Active selection on this lane, so its edges have something to grab. */
  rangeSelection?: { t0: number; t1: number } | null | undefined;
}

export interface UseAutomationLaneGesturesResult {
  /** Point being dragged, for the cursor and the grab circle's size. */
  dragIndex: number | null;
  /** Segment being bent, identified by the point that owns its curve. */
  curveIndex: number | null;
  /** Edge being stretched, for the cursor. */
  edgeDrag: "t0" | "t1" | null;
  /** Whether the pointer sits over a stretch handle with no gesture live —
   *  the col-resize cursor hint before a press commits to the drag. */
  edgeHover: boolean;
  /** Value readout to show while a gesture is live. */
  hint: string | null;
  hitIndex(clientX: number, clientY: number): number | null;
  segmentIndex(clientX: number, clientY: number): number | null;
  onPointerDown(e: ReactPointerEvent<SVGSVGElement>): void;
  onPointerMove(e: ReactPointerEvent<SVGSVGElement>): void;
  endDrag(e: ReactPointerEvent<SVGSVGElement>): void;
  /** Adds a point, opens the value field on one, or straightens a segment. */
  onDoubleClick(e: ReactPointerEvent<SVGSVGElement>): void;
  /** The point whose value is being typed, and the text so far. */
  editing: { index: number; text: string } | null;
  setEditingText(text: string): void;
  commitEdit(): void;
  cancelEdit(): void;
}

export function useAutomationLaneGestures({
  getBox,
  lane,
  range,
  pointAt,
  xOf,
  yOf,
  commitPoints,
  snapTimes,
  readOnly,
  onSelect,
  onRangeSelect,
  onRangeClear,
  duration,
  rangeSelection,
}: UseAutomationLaneGesturesInput): UseAutomationLaneGesturesResult {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [curveIndex, setCurveIndex] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  /** Where a point drag began, so Shift can lock an axis and fine the value. */
  const dragOrigin = useRef<{ t: number; v: number } | null>(null);
  /** Point whose value is being typed, and the text so far. */
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  /** A background drag in progress: its start and live end, in clip seconds. */
  const [rangeDrag, setRangeDrag] = useState<{ from: number; to: number } | null>(null);
  /** Whether the live drag has crossed the pixel threshold that turns a press
   *  into an actual range, rather than a click that should just clear one. */
  const rangeCrossed = useRef(false);
  /** An edge-stretch drag in progress: which edge, the selection it started
   *  from (kept fixed as the retime's untouched anchor), and the edge's own
   *  live position. */
  const [edgeDrag, setEdgeDrag] = useState<{
    edge: "t0" | "t1";
    origin: { t0: number; t1: number };
    current: number;
  } | null>(null);
  /** Cursor hint: hovering a stretch handle with nothing else live. */
  const [edgeHover, setEdgeHover] = useState(false);

  /** Which edge of the active selection, if any, sits within grab range of the
   *  pointer's screen x — full lane height, since the handle spans the rect. */
  const edgeAt = useCallback(
    (clientX: number): "t0" | "t1" | null => {
      if (!rangeSelection) return null;
      const box = getBox();
      if (!box) return null;
      const px = clientX - box.left;
      const d0 = Math.abs(xOf(rangeSelection.t0) - px);
      const d1 = Math.abs(xOf(rangeSelection.t1) - px);
      if (d0 <= EDGE_GRAB_PX && d0 <= d1) return "t0";
      return d1 <= EDGE_GRAB_PX ? "t1" : null;
    },
    [rangeSelection, getBox, xOf],
  );

  /** Index of a point under the pointer, or null. */
  const hitIndex = useCallback(
    (clientX: number, clientY: number): number | null => {
      const box = getBox();
      if (!box) return null;
      const px = clientX - box.left;
      const py = clientY - box.top;
      for (let i = 0; i < lane.points.length; i += 1) {
        const p = lane.points[i];
        if (p && Math.hypot(xOf(p.t) - px, yOf(p.v) - py) <= GRAB_PX * 1.6) return i;
      }
      return null;
    },
    [getBox, lane, xOf, yOf],
  );

  /** Index of the point owning the segment under the pointer, or null. */
  const segmentIndex = useCallback(
    (clientX: number, clientY: number): number | null => {
      const { t } = pointAt(clientX, clientY);
      for (let i = 0; i + 1 < lane.points.length; i += 1) {
        const a = lane.points[i];
        const b = lane.points[i + 1];
        if (a && b && t > a.t && t < b.t) return i;
      }
      return null;
    },
    [lane, pointAt],
  );

  /** What a press starts: moving a point, or — with Alt on the line — bending it. */
  const gestureAt = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>): { curve: boolean; index: number } | null => {
      const index = hitIndex(e.clientX, e.clientY);
      if (index !== null) return { curve: false, index };
      if (!e.altKey) return null;
      const segment = segmentIndex(e.clientX, e.clientY);
      return segment === null ? null : { curve: true, index: segment };
    },
    [hitIndex, segmentIndex],
  );

  /**
   * What a press on the lane's empty background arms: an edge grab when it
   * landed within range of an existing selection's edge, else a new range
   * selection — only when a caller wants to hear about one; a read-only lane
   * never reaches here at all.
   */
  const armBackgroundGesture = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>): void => {
      const edge = edgeAt(e.clientX);
      if (edge && rangeSelection) {
        e.preventDefault();
        capturePointer(e);
        setEdgeHover(false);
        setEdgeDrag({
          edge,
          origin: rangeSelection,
          current: edge === "t0" ? rangeSelection.t0 : rangeSelection.t1,
        });
        return;
      }
      if (!onRangeSelect) return;
      e.preventDefault();
      capturePointer(e);
      const raw = pointAt(e.clientX, e.clientY).t;
      const clamped = Math.min(duration, Math.max(0, raw));
      const t = e.altKey ? clamped : snapLaneTime(clamped, snapTimes ?? [], SNAP_SEC);
      rangeCrossed.current = false;
      setRangeDrag({ from: t, to: t });
    },
    [edgeAt, rangeSelection, onRangeSelect, pointAt, duration, snapTimes],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>): void => {
      if (e.button !== 0) return;
      // The lane owns this region either way. Letting a press through starts the
      // timeline's own gesture (scrub / marquee / clip drag), which then eats the
      // rest of the sequence — including the second half of a double-click.
      e.stopPropagation();
      if (readOnly) {
        // The lane sits below the clip bar, so the timeline's selection handler
        // never sees this press; selecting here is the only way in.
        onSelect?.();
        return;
      }
      const gesture = gestureAt(e);
      if (!gesture) {
        armBackgroundGesture(e);
        return;
      }
      e.preventDefault();
      capturePointer(e);
      // A point can sit close enough to an edge to have set the hover hint
      // moments ago; winning the press should not leave that stale cursor
      // showing through the drag that follows.
      setEdgeHover(false);
      if (gesture.curve) {
        setCurveIndex(gesture.index);
        return;
      }
      dragOrigin.current = originOf(lane.points[gesture.index]);
      setDragIndex(gesture.index);
    },
    [gestureAt, lane, readOnly, onSelect, armBackgroundGesture],
  );

  /** Bend the segment under the pointer, which is what Alt-dragging the line does. */
  const bendSegment = useCallback(
    (clientX: number, clientY: number): void => {
      if (curveIndex === null) return;
      const a = lane.points[curveIndex];
      const b = lane.points[curveIndex + 1];
      if (!a || !b) return;
      const { t, v } = pointAt(clientX, clientY);
      const curve = curveForDrag({ range, a, b, t, v });
      if (curve === null) return;
      setHint(`curve ${curve.toFixed(2)}`);
      commitPoints(
        lane.points.map((p, i) => (i === curveIndex ? { ...p, curve } : p)),
        false,
      );
    },
    [curveIndex, lane, pointAt, range, commitPoints],
  );

  /** Move the point being dragged, honouring the modifiers held with it. */
  const movePoint = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>): void => {
      if (dragIndex === null) return;
      const raw = pointAt(e.clientX, e.clientY);
      const origin = dragOrigin.current;
      let { t, v } =
        e.shiftKey && origin ? applyShiftConstraint({ range, origin, raw, xOf, yOf }) : raw;
      // Shift is a deliberate free-hand move as much as Alt is, so neither snaps.
      if (!e.altKey && !e.shiftKey) {
        const neighbours = lane.points.filter((_, i) => i !== dragIndex).map((p) => p.t);
        t = snapLaneTime(t, [...(snapTimes ?? []), ...neighbours], SNAP_SEC);
      }
      const next = lane.points.map((p, i) => (i === dragIndex ? { ...p, t, v } : p));
      // Re-sort so dragging a point past a neighbour behaves, and keep the
      // dragged one addressable by following where it landed.
      const moved = next[dragIndex];
      next.sort((a, b) => a.t - b.t);
      if (moved) setDragIndex(next.indexOf(moved));
      setHint(`${formatValue(range, v)} @ ${t.toFixed(2)}s`);
      commitPoints(next, false);
    },
    [dragIndex, lane, pointAt, range, commitPoints, snapTimes, xOf, yOf],
  );

  /** Preview the selection's new bounds as the grabbed edge moves: the other
   *  edge stays put as the retime's anchor, and the dragged one is clamped so
   *  it cannot cross its partner (leaving at least a merge-radius of room) nor
   *  leave the clip's own duration. */
  const moveEdge = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>): void => {
      if (edgeDrag === null) return;
      const { edge, origin } = edgeDrag;
      const raw = pointAt(e.clientX, e.clientY).t;
      const clamped = Math.min(duration, Math.max(0, raw));
      const current =
        edge === "t0"
          ? Math.min(clamped, origin.t1 - POINT_MERGE_SEC)
          : Math.max(clamped, origin.t0 + POINT_MERGE_SEC);
      setEdgeDrag({ edge, origin, current });
      const newT0 = edge === "t0" ? current : origin.t0;
      const newT1 = edge === "t1" ? current : origin.t1;
      setHint(`${newT0.toFixed(2)}s → ${newT1.toFixed(2)}s`);
      commitPoints(retimeRange({ lane, range, t0: origin.t0, t1: origin.t1, newT0, newT1 }), false);
    },
    [edgeDrag, pointAt, duration, lane, range, commitPoints],
  );

  /** Update the live range-drag as the pointer moves, firing `onRangeSelect`
   *  once it has covered enough pixels to count as an actual range rather
   *  than a click that should just clear one. */
  const moveRangeDrag = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>): void => {
      if (rangeDrag === null) return;
      const raw = pointAt(e.clientX, e.clientY).t;
      const clamped = Math.min(duration, Math.max(0, raw));
      const t = e.altKey ? clamped : snapLaneTime(clamped, snapTimes ?? [], SNAP_SEC);
      setRangeDrag({ from: rangeDrag.from, to: t });
      if (Math.abs(xOf(t) - xOf(rangeDrag.from)) <= 3) return;
      rangeCrossed.current = true;
      onRangeSelect?.(Math.min(rangeDrag.from, t), Math.max(rangeDrag.from, t));
    },
    [rangeDrag, pointAt, duration, snapTimes, xOf, onRangeSelect],
  );

  /** Cursor hint only: whether the pointer sits over a stretch handle with
   *  nothing else live. Skipped read-only, which never arms a stretch. */
  const updateEdgeHover = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>): void => {
      if (!readOnly) setEdgeHover(edgeAt(e.clientX) !== null);
    },
    [readOnly, edgeAt],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>): void => {
      if (edgeDrag !== null) {
        e.stopPropagation();
        moveEdge(e);
        return;
      }
      if (rangeDrag !== null) {
        e.stopPropagation();
        moveRangeDrag(e);
        return;
      }
      if (curveIndex === null && dragIndex === null) {
        updateEdgeHover(e);
        return;
      }
      e.stopPropagation();
      if (curveIndex !== null) bendSegment(e.clientX, e.clientY);
      else movePoint(e);
    },
    [
      edgeDrag,
      moveEdge,
      rangeDrag,
      moveRangeDrag,
      curveIndex,
      dragIndex,
      updateEdgeHover,
      bendSegment,
      movePoint,
    ],
  );

  /** Persist the stretch and hand the selection's new bounds back to the
   *  caller — the one point in the gesture that both commits and moves the
   *  selection it grabbed. */
  const finishEdgeDrag = useCallback((): void => {
    if (edgeDrag === null) return;
    const { edge, origin, current } = edgeDrag;
    const newT0 = edge === "t0" ? current : origin.t0;
    const newT1 = edge === "t1" ? current : origin.t1;
    setEdgeDrag(null);
    setHint(null);
    commitPoints(lane.points, true);
    onRangeSelect?.(newT0, newT1);
  }, [edgeDrag, lane, commitPoints, onRangeSelect]);

  /** A sub-threshold press clears the selection rather than leaving a
   *  zero-width one behind. */
  const finishRangeDrag = useCallback((): void => {
    if (!rangeCrossed.current) onRangeClear?.();
    rangeCrossed.current = false;
    setRangeDrag(null);
  }, [onRangeClear]);

  const endDrag = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>): void => {
      if (edgeDrag !== null) {
        e.stopPropagation();
        finishEdgeDrag();
        return;
      }
      if (rangeDrag !== null) {
        e.stopPropagation();
        finishRangeDrag();
        return;
      }
      if (dragIndex === null && curveIndex === null) return;
      e.stopPropagation();
      setDragIndex(null);
      setCurveIndex(null);
      dragOrigin.current = null;
      setHint(null);
      commitPoints(lane.points, true);
    },
    [
      edgeDrag,
      finishEdgeDrag,
      rangeDrag,
      finishRangeDrag,
      curveIndex,
      dragIndex,
      lane,
      commitPoints,
    ],
  );

  const onDoubleClick = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>): void => {
      if (readOnly) return;
      e.stopPropagation();
      e.preventDefault();
      const onPoint = hitIndex(e.clientX, e.clientY);
      if (e.altKey) {
        // Straighten the segment back out — the counterpart to Alt-dragging it.
        const segment = onPoint ?? segmentIndex(e.clientX, e.clientY);
        if (segment === null) return;
        commitPoints(
          lane.points.map((p, i) => (i === segment ? { t: p.t, v: p.v } : p)),
          true,
        );
        return;
      }
      if (onPoint !== null) {
        // Typing beats dragging when the value has to be exact — -6.0 dB is not
        // a pixel you can find.
        const p = lane.points[onPoint];
        if (p) setEditing({ index: onPoint, text: String(Number(p.v.toFixed(3))) });
        return;
      }
      const { t, v } = pointAt(e.clientX, e.clientY);
      const kept = lane.points.filter((p) => Math.abs(p.t - t) > POINT_MERGE_SEC);
      // A lane's first point alone would be a constant, which is not what
      // clicking an empty lane means: seed the far end at the same value so the
      // envelope has somewhere to go.
      const seeded = lane.points.length === 0 && t > POINT_MERGE_SEC ? [{ t: 0, v }] : [];
      commitPoints(
        [...seeded, ...kept, { t, v }].sort((a, b) => a.t - b.t),
        true,
      );
    },
    [lane, pointAt, commitPoints, readOnly, hitIndex, segmentIndex],
  );

  const setEditingText = useCallback((text: string): void => {
    setEditing((current) => (current ? { index: current.index, text } : null));
  }, []);

  const cancelEdit = useCallback((): void => setEditing(null), []);

  /** Apply a typed value, or drop the edit when it is not a number. */
  const commitEdit = useCallback((): void => {
    const active = editing;
    setEditing(null);
    if (!active) return;
    const typed = Number(active.text);
    if (!Number.isFinite(typed)) return;
    const clamped = Math.min(range.max, Math.max(range.min, typed));
    commitPoints(
      lane.points.map((p, i) => (i === active.index ? { ...p, v: clamped } : p)),
      true,
    );
  }, [editing, lane, range, commitPoints]);

  return {
    dragIndex,
    curveIndex,
    edgeDrag: edgeDrag?.edge ?? null,
    edgeHover,
    hint,
    hitIndex,
    segmentIndex,
    onPointerDown,
    onPointerMove,
    endDrag,
    onDoubleClick,
    editing,
    setEditingText,
    commitEdit,
    cancelEdit,
  };
}

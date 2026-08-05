/**
 * The pointer gestures over an automation lane.
 *
 * Its own hook because the lane component sits at the studio's file ceiling and
 * because these are the parts worth testing on their own: which of a press,
 * a drag and a modifier resolves to moving a point, bending a segment, or
 * nothing at all.
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

/** Snap radius in clip seconds. Tight on purpose: a lane is often a few seconds
 *  wide, where a generous radius makes a point unplaceable between two beats. */
const SNAP_SEC = 0.04;

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
}

export interface UseAutomationLaneGesturesResult {
  /** Point being dragged, for the cursor and the grab circle's size. */
  dragIndex: number | null;
  /** Segment being bent, identified by the point that owns its curve. */
  curveIndex: number | null;
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
        // Neither a point nor an Alt-held segment: the press landed on the
        // lane's empty background. That is a range selection's gesture, not
        // nothing — but only when a caller wants to hear about one; a
        // read-only lane already returned above, so this is a live one with no
        // range feature wired up.
        if (!onRangeSelect) return;
        e.preventDefault();
        capturePointer(e);
        const raw = pointAt(e.clientX, e.clientY).t;
        const clamped = Math.min(duration, Math.max(0, raw));
        const t = e.altKey ? clamped : snapLaneTime(clamped, snapTimes ?? [], SNAP_SEC);
        rangeCrossed.current = false;
        setRangeDrag({ from: t, to: t });
        return;
      }
      e.preventDefault();
      capturePointer(e);
      if (gesture.curve) {
        setCurveIndex(gesture.index);
        return;
      }
      dragOrigin.current = originOf(lane.points[gesture.index]);
      setDragIndex(gesture.index);
    },
    [gestureAt, lane, readOnly, onSelect, onRangeSelect, pointAt, duration, snapTimes],
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

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>): void => {
      if (rangeDrag !== null) {
        e.stopPropagation();
        const raw = pointAt(e.clientX, e.clientY).t;
        const clamped = Math.min(duration, Math.max(0, raw));
        const t = e.altKey ? clamped : snapLaneTime(clamped, snapTimes ?? [], SNAP_SEC);
        setRangeDrag({ from: rangeDrag.from, to: t });
        if (Math.abs(xOf(t) - xOf(rangeDrag.from)) > 3) {
          rangeCrossed.current = true;
          onRangeSelect?.(Math.min(rangeDrag.from, t), Math.max(rangeDrag.from, t));
        }
        return;
      }
      if (curveIndex === null && dragIndex === null) return;
      e.stopPropagation();
      if (curveIndex !== null) bendSegment(e.clientX, e.clientY);
      else movePoint(e);
    },
    [
      rangeDrag,
      pointAt,
      duration,
      snapTimes,
      xOf,
      onRangeSelect,
      bendSegment,
      curveIndex,
      dragIndex,
      movePoint,
    ],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>): void => {
      if (rangeDrag !== null) {
        e.stopPropagation();
        if (!rangeCrossed.current) onRangeClear?.();
        rangeCrossed.current = false;
        setRangeDrag(null);
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
    [rangeDrag, onRangeClear, curveIndex, dragIndex, lane, commitPoints],
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

/**
 * Breakpoint automation over an audio clip, edited the way a DAW edits it:
 * double-click the line to add a point, drag one to shape it, right-click or
 * Shift+click a point to remove it, Alt-drag the line between two points to bend
 * it, and double-click a point to type an exact value.
 *
 * Modifiers follow Ableton's, because that is the muscle memory an automation
 * lane inherits: Shift locks a drag to one axis and fines the value down, Alt
 * over a segment curves it, and Alt during a point drag ignores the grid.
 *
 * Drag the background to draw a selection box around a set of breakpoints, then
 * Delete to remove them, drag any one of them to move the whole set, or
 * right-click inside the box for shapes over its span.
 *
 * The lane knows nothing about any particular effect. Which parameters it can
 * offer, their ranges, units and whether they read logarithmically all come
 * from the FX registry, so an effect gained upstream needs no change here — the
 * same principle the property panel's controls follow.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  resolveAutomationRange,
  sampleAutomationLane,
  type AutomationRange,
  type HfAutomation,
  type HfAutomationLane,
  type HfAutomationPoint,
} from "@hyperframes/core/audio-automation";
import { envelopePath, fromUnit, laneFor, PAD_X, toUnit, withLane } from "./automationLaneGeometry";
import { useAutomationLaneGestures } from "./useAutomationLaneGestures";
import { AutomationValueInput } from "./AutomationValueInput";
import { AutomationSelectionMenu } from "./AutomationSelectionMenu";
import { AUTOMATION_LANE_H } from "./automationLaneHeight";
import { generateShape, type AutomationShapeId } from "./automationShapes";
import { simplifyPoints } from "./automationSimplify";
import { pointInSelection, pointsIn, replaceRange } from "./automationLaneSelection";
import { getTimelineLaneTop } from "./timelineLayout";
import { defaultTimelineTheme } from "./timelineTheme";
import { groupAutomationLanes } from "./automationLaneData";
import { isAudioTimelineElement } from "../../utils/timelineInspector";
import { getTimelineElementIdentity } from "../lib/timelineElementHelpers";
import type { TimelineElement } from "../store/playerStore";
import type { UseAutomationLanesResult } from "./useAutomationLanes";

/**
 * Drawn radius of a breakpoint.
 *
 * Independent of the grab radius, which is how close a pointer has to be to catch
 * one: the two were the same number scaled, and tying them meant a dot could not be
 * made easier to see without also changing what it caught. A touch over half the
 * grab radius reads clearly at lane height without swallowing a dense run.
 */
const POINT_R = 4.9;

/** Separator between stacked lanes — the same token a track row divides with. Read
 *  off the default theme rather than threaded as a prop: nothing overrides the
 *  timeline theme for lanes today, and a prop for one colour is plumbing to nowhere. */
const LANE_BORDER = defaultTimelineTheme.rowBorder;

/** Selection box on one lane. Value bounds included: a point at the right time
 *  but the wrong value is not in it. */
type SelectionBox = { t0: number; t1: number; v0: number; v1: number };

/** Is this breakpoint inside the selection box? The rule itself is shared with
 *  Delete and with the group drag, so what is drawn as caught is exactly what
 *  those act on; this only adds tolerance for there being no selection at all. */
function pointInBox(point: HfAutomationPoint, box: SelectionBox | null | undefined): boolean {
  return !!box && pointInSelection(point, box);
}

/** A breakpoint's drawn radius and stroke, pulled out of the render loop so the
 *  map callback stays a single JSX return — the ternaries below are what pushed
 *  it over the complexity budget when they lived inline. */
function pointCircleStyle(
  inRange: boolean,
  dragging: boolean,
): { radius: number; stroke: string; strokeWidth: number } {
  return {
    radius: POINT_R * (dragging ? 1.3 : inRange ? 1.15 : 1),
    // A white ring rather than a different fill: the fill is the parameter's
    // own colour, and a lane with two envelopes on it is read by colour first.
    stroke: inRange ? "#fff" : "rgba(0,0,0,0.5)",
    strokeWidth: inRange ? 1.5 : 1,
  };
}

/** Pointer shape: a read-only lane can only be selected, a live one edited. */
function laneCursor(readOnly: boolean | undefined, dragging: boolean, stretching: boolean): string {
  // A stretch handle wins over everything it might also sit above: the handle is
  // a few px wide and always overlaps whatever is under the selection edge, so
  // any other cursor there would advertise a gesture the press will not start.
  if (stretching) return "col-resize";
  if (readOnly) return "pointer";
  return dragging ? "grabbing" : "crosshair";
}

export interface TimelineAutomationLaneProps {
  /** Clip-local duration the lane spans. */
  duration: number;
  widthPx: number;
  leftPx: number;
  topPx: number;
  automation: HfAutomation;
  /** Which lane of that automation this row draws. */
  target: string;
  /** Axis, unit and label for the target, resolved against the chain. */
  range: AutomationRange;
  accentColor: string;
  /** Clip-local seconds of the playhead, or null when it is outside the clip. */
  playheadSec: number | null;
  /** Continuous write while dragging; does not persist. */
  onPreview(automation: HfAutomation): void;
  /** Gesture-end write; this is the one that persists and lands in undo. */
  onCommit(automation: HfAutomation): void;
  /**
   * Clip-local times a dragged point snaps to — the beat grid, shifted into this
   * clip's frame. Its own neighbouring points are added on top.
   */
  snapTimes?: readonly number[];
  /** Editing writes to the selected element, so an unselected clip is read-only. */
  readOnly?: boolean;
  /** Called when a read-only lane is pressed: selects the clip so it goes live. */
  onSelect?(): void;
  /** Active selection box on THIS lane, or null. */
  rangeSelection?: SelectionBox | null | undefined;
  onRangeSelect?: ((t0: number, t1: number, v0: number, v1: number) => void) | undefined;
  onRangeClear?: (() => void) | undefined;
}

export function TimelineAutomationLane({
  duration,
  widthPx,
  leftPx,
  topPx,
  automation,
  target,
  range,
  accentColor,
  playheadSec,
  onPreview,
  onCommit,
  snapTimes,
  readOnly,
  onSelect,
  rangeSelection,
  onRangeSelect,
  onRangeClear,
}: TimelineAutomationLaneProps) {
  const stored = laneFor(automation, target);

  const svgRef = useRef<SVGSVGElement | null>(null);

  /**
   * Points as the user is shaping them, before the edit has come back around.
   *
   * A live write sets the preview attribute but deliberately skips the refresh —
   * that is what keeps dragging from reloading the composition and restarting
   * playback. So the automation prop does not move under the pointer, and
   * without a local draft the point would not either.
   */
  const [draft, setDraft] = useState<{ points: HfAutomationPoint[]; basedOn: HfAutomation } | null>(
    null,
  );
  const lane: HfAutomationLane = useMemo(
    () => (draft ? { target, points: draft.points } : stored),
    [draft, target, stored],
  );

  // The draft is released when the automation it was drawn over actually
  // changes — the persisted edit landing, or an edit from elsewhere. Releasing
  // it merely because the drag ended would snap the point back to where it
  // started for as long as the write takes to come around.
  useEffect(() => {
    if (draft && draft.basedOn !== automation) setDraft(null);
  }, [automation, draft]);

  // A different parameter is a different envelope; the draft does not carry over.
  useEffect(() => {
    setDraft(null);
  }, [target]);

  const h = AUTOMATION_LANE_H;
  const pad = 6;
  const inner = h - pad * 2;
  // Drawing is inset by PAD_X and the svg is widened to match, so screen
  // position still lines up with clip time — the lane just has margins.
  const xOf = useCallback(
    (t: number): number => PAD_X + (duration > 0 ? (t / duration) * widthPx : 0),
    [duration, widthPx],
  );
  const yOf = useCallback(
    (v: number): number => pad + (1 - toUnit(range, v)) * inner,
    [range, inner],
  );

  /** Pointer position as a clip-local time and a parameter value. */
  const pointAt = useCallback(
    (clientX: number, clientY: number): { t: number; v: number } => {
      const box = svgRef.current?.getBoundingClientRect();
      if (!box || box.width <= 0) return { t: 0, v: range.default ?? range.min };
      const t = Math.min(
        duration,
        Math.max(0, ((clientX - box.left - PAD_X) / widthPx) * duration),
      );
      const unit = 1 - (clientY - box.top - pad) / inner;
      return { t, v: fromUnit(range, unit) };
    },
    [duration, inner, range, widthPx],
  );

  const path = useMemo(
    () => envelopePath({ lane, range, widthPx, xOf, yOf }),
    [lane, range, widthPx, xOf, yOf],
  );

  const commitPoints = useCallback(
    (points: HfAutomationLane["points"], persist: boolean): void => {
      // Draw from the draft immediately; the write is what eventually agrees.
      setDraft({ points, basedOn: automation });
      const next = withLane(automation, { target, points });
      if (persist) onCommit(next);
      else onPreview(next);
    },
    [automation, target, onCommit, onPreview],
  );

  const getBox = useCallback(
    (): DOMRect | null => svgRef.current?.getBoundingClientRect() ?? null,
    [],
  );
  const gestures = useAutomationLaneGestures({
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
  });
  const { dragIndex, curveIndex, edgeDrag, edgeHover, hint, editing } = gestures;

  const removeAt = useCallback(
    (index: number): void => {
      if (readOnly) return;
      commitPoints(
        lane.points.filter((_, i) => i !== index),
        true,
      );
    },
    [lane, commitPoints, readOnly],
  );

  /** Client-coordinate position of an open selection menu, or null when closed. */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  /**
   * Whether the pointer is over this lane, which is what decides if the
   * breakpoints are drawn.
   *
   * A stack of envelopes across a long clip is hundreds of discs, and at rest the
   * shape of each is the thing worth reading — the handles matter only to someone
   * about to grab one. The line stays visible either way; this hides just the
   * points.
   */
  const [hovered, setHovered] = useState(false);

  const insertShape = useCallback(
    (shape: AutomationShapeId): void => {
      if (!rangeSelection) return;
      const inner = generateShape({
        shape,
        lane,
        range,
        t0: rangeSelection.t0,
        t1: rangeSelection.t1,
      });
      commitPoints(
        replaceRange({ lane, range, t0: rangeSelection.t0, t1: rangeSelection.t1, inner }),
        true,
      );
    },
    [rangeSelection, lane, range, commitPoints],
  );

  const simplifySelection = useCallback((): void => {
    if (!rangeSelection) return;
    const inner = simplifyPoints(pointsIn(lane, rangeSelection.t0, rangeSelection.t1), range);
    commitPoints(
      replaceRange({ lane, range, t0: rangeSelection.t0, t1: rangeSelection.t1, inner }),
      true,
    );
  }, [rangeSelection, lane, range, commitPoints]);

  // A point's own right-click already stops propagation and still deletes;
  // this only fires when the press lands on the background inside the
  // active selection.
  const onSvgContextMenu = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>): void => {
      if (readOnly || !rangeSelection) return;
      // Inside the drawn box, not merely inside its span: the menu's own actions
      // read the span, but a right-click well above or below the box is a press
      // on empty lane as far as the author can see.
      if (!pointInSelection(pointAt(e.clientX, e.clientY), rangeSelection)) return;
      e.preventDefault();
      setMenuAt({ x: e.clientX, y: e.clientY });
    },
    [readOnly, rangeSelection, pointAt],
  );

  const currentValue =
    lane.points.length > 0 && playheadSec !== null
      ? sampleAutomationLane(lane, playheadSec, range.scale)
      : null;

  return (
    <div
      // Spans the whole row so the separator below can, but takes no pointer
      // events itself: clips sharing a row each mount one of these over the
      // full width, so a band that accepted the pointer would let whichever
      // clip rendered last swallow every sibling's envelope — hover, drag and
      // all. Only the drawn parts opt back in.
      className="hf-automation-lane pointer-events-none absolute"
      style={{ top: topPx, left: 0, right: 0, height: h }}
      data-automation-lane={target}
    >
      {/* Separator above each lane, in the same colour a track row divides with, so
          a stack of envelopes reads as rows rather than as one tall field. Drawn as
          an overlay rather than a CSS border: the lane's height is fixed and its svg
          is positioned against the same box, so a border would shift the drawing a
          pixel off the geometry every hit test is computed from. */}
      <div
        data-automation-lane-border=""
        className="hf-automation-lane-border pointer-events-none absolute"
        style={{ top: 0, left: 0, right: 0, height: 1, background: LANE_BORDER, zIndex: 1 }}
      />
      {/* No name drawn here: the label column carries it, on the same tree
          connector as the keyframe rows. Painted in the lane it sat on top of the
          envelope it described and scrolled horizontally away from its own row. */}
      <svg
        ref={svgRef}
        className="hf-automation-svg pointer-events-auto absolute"
        style={{
          left: leftPx - PAD_X,
          top: 0,
          width: widthPx + PAD_X * 2,
          height: h,
          cursor: laneCursor(
            readOnly,
            dragIndex !== null || curveIndex !== null,
            edgeDrag !== null || edgeHover,
          ),
          opacity: readOnly ? 0.55 : 1,
          touchAction: "none",
        }}
        width={widthPx + PAD_X * 2}
        height={h}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={gestures.onPointerDown}
        onPointerMove={gestures.onPointerMove}
        onPointerUp={gestures.endDrag}
        onPointerCancel={gestures.cancelDrag}
        onDoubleClick={gestures.onDoubleClick}
        onContextMenu={onSvgContextMenu}
        role="group"
        aria-label={`${range.label} automation`}
      >
        <title>
          {readOnly
            ? "Drag a box to select points, which also selects this clip; then double-click to add a point"
            : "Double-click to add a point, drag to shape, double-click a point to type a value, right-click or Shift+click to remove it. Drag the background to draw a box around points, then Delete to remove them or drag one to move them all. Alt-drag the line to curve it. Shift locks an axis mid-drag; Alt ignores the grid."}
        </title>
        {/* No plate behind the envelope: the lane used to darken its clip's width,
            which drew a box inside the row and made a stack of lanes read as tiles
            rather than as rows of one timeline. The row background shows through, and
            the separator above each lane is what divides them now. */}
        {/* Mid rail, so a value reads against something. */}
        <line
          x1={PAD_X}
          x2={PAD_X + widthPx}
          y1={pad + inner / 2}
          y2={pad + inner / 2}
          stroke="rgba(255,255,255,0.08)"
          strokeDasharray="3 4"
        />
        {rangeSelection ? (
          <rect
            data-automation-selection=""
            x={xOf(rangeSelection.t0)}
            // v1 is the upper bound, which is the SMALLER y: the value axis runs
            // up the lane and the screen axis runs down it.
            y={yOf(rangeSelection.v1)}
            width={Math.max(0, xOf(rangeSelection.t1) - xOf(rangeSelection.t0))}
            height={Math.max(0, yOf(rangeSelection.v0) - yOf(rangeSelection.v1))}
            fill={accentColor}
            opacity={0.15}
            // Outlined as well as tinted. A box dragged thin along either axis is
            // nearly invisible as a fill, and the author still has to be able to
            // see what they drew before pressing Delete.
            stroke={accentColor}
            strokeOpacity={0.6}
            pointerEvents="none"
          />
        ) : null}
        <path
          d={path}
          fill="none"
          stroke={accentColor}
          strokeWidth={1.5}
          opacity={lane.points.length === 0 ? 0.35 : 0.95}
        />
        {lane.points.map((p, i) => {
          // Endpoint-inclusive, the same rule Delete uses, so what looks caught by
          // the range is exactly what the range will remove. The tinted rectangle
          // says where the selection is; this says which points it has.
          const inRange = pointInBox(p, rangeSelection);
          const { radius, stroke, strokeWidth } = pointCircleStyle(inRange, i === dragIndex);
          return (
            <circle
              key={`${i}-${p.t}`}
              data-automation-point={i}
              {...(inRange ? { "data-automation-point-in-range": "" } : {})}
              cx={xOf(p.t)}
              cy={yOf(p.v)}
              r={radius}
              fill={accentColor}
              stroke={stroke}
              strokeWidth={strokeWidth}
              // Hidden rather than unmounted, so the hit area survives: a point
              // dragged past the lane's edge fires pointerleave mid-gesture, and a
              // handle that vanishes then would drop the drag. A drag in progress
              // and a selected range both keep them up for the same reason — the
              // range is the subject of a pending Delete, and which points it
              // caught cannot depend on where the mouse is.
              style={{
                cursor: readOnly ? "default" : "grab",
                opacity: hovered || dragIndex !== null || rangeSelection ? 1 : 0,
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                removeAt(i);
              }}
            />
          );
        })}
        {playheadSec !== null && currentValue !== null ? (
          <circle
            data-automation-playhead=""
            cx={xOf(playheadSec)}
            cy={yOf(currentValue)}
            r={2.5}
            fill="#fff"
            opacity={0.8}
            pointerEvents="none"
          />
        ) : null}
      </svg>

      {editing ? (
        <AutomationValueInput
          text={editing.text}
          leftPx={leftPx + xOf(lane.points[editing.index]?.t ?? 0) - PAD_X - 18}
          label={range.label}
          onChange={gestures.setEditingText}
          onCommit={gestures.commitEdit}
          onCancel={gestures.cancelEdit}
        />
      ) : null}

      {hint ? (
        <div
          className="hf-automation-hint pointer-events-none absolute rounded-[3px] bg-black/80 px-1 py-0.5 font-mono text-[9px] text-white"
          style={{ left: leftPx + 6, top: 2, zIndex: 3 }}
        >
          {hint}
        </div>
      ) : null}

      {menuAt && rangeSelection ? (
        <AutomationSelectionMenu
          x={menuAt.x}
          y={menuAt.y}
          onClose={() => setMenuAt(null)}
          onInsertShape={insertShape}
          onSimplify={simplifySelection}
          canSimplify={pointsIn(lane, rangeSelection.t0, rangeSelection.t1).length >= 3}
        />
      ) : null}
    </div>
  );
}

/** Which shared rows one clip draws into, and with which of its lanes. */
interface ClipLaneRow {
  lane: HfAutomationLane;
  rowIndex: number;
}

/**
 * One clip's envelopes, each in the shared row its property owns.
 *
 * Its own component because every clip on the row needs its own binding, its own
 * gestures and its own selection box — a shared row is a shared lane track, not a
 * shared envelope, and two clips' curves must never drag as one thing. Hooks
 * cannot run in a loop, so the loop is over components.
 */
function ClipAutomationLanes({
  element,
  rows,
  isSelected,
  lanes,
  pps,
  top,
  accentColor,
  currentTime,
  beatTimes,
}: {
  element: TimelineElement;
  rows: readonly ClipLaneRow[];
  isSelected: boolean;
  lanes: UseAutomationLanesResult;
  pps: number;
  /** y of the first automation row on this track. */
  top: number;
  accentColor: string;
  currentTime: number;
  beatTimes?: readonly number[];
}) {
  // Beats inside this clip, in the clip's own frame — the lane's times are
  // clip-local, and a beat outside the clip can never be snapped to anyway.
  const snapTimes = useMemo(
    () =>
      (beatTimes ?? [])
        .filter((t) => t >= element.start && t <= element.start + element.duration)
        .map((t) => t - element.start),
    [beatTimes, element.start, element.duration],
  );
  const bound = lanes.bind(element, isSelected);
  // Stale-selection guard: the selected lane's target can vanish out from under
  // it (e.g. its effect got deleted from the chain, dropping the lane), leaving
  // a rectangle selecting nothing. Clear it rather than let it point at a
  // target that no longer draws. Above the empty-rows return, because a clip
  // that draws nothing is exactly when a selection goes stale.
  useEffect(() => {
    const target = bound.selection?.target;
    if (target !== undefined && !bound.lanes.some((lane) => lane.target === target)) {
      bound.onRangeClear();
    }
  }, [bound]);
  if (rows.length === 0) return null;
  const inClip = currentTime >= element.start && currentTime <= element.start + element.duration;
  return (
    <>
      {rows.map(({ lane, rowIndex }) => {
        const range = resolveAutomationRange(lane.target, bound.chain ?? undefined);
        // A lane whose target no longer resolves was already dropped upstream;
        // this is belt and braces so a row can never draw on the wrong axis.
        if (!range) return null;
        return (
          <TimelineAutomationLane
            key={lane.target}
            duration={element.duration}
            widthPx={Math.max(element.duration * pps, 4)}
            leftPx={element.start * pps}
            topPx={top + rowIndex * AUTOMATION_LANE_H}
            automation={bound.automation}
            target={lane.target}
            range={range}
            accentColor={accentColor}
            playheadSec={inClip ? currentTime - element.start : null}
            onPreview={bound.onPreview}
            onCommit={bound.onCommit}
            onSelect={bound.onSelect}
            snapTimes={snapTimes}
            readOnly={bound.readOnly}
            rangeSelection={
              bound.selection?.target === lane.target
                ? {
                    t0: bound.selection.t0,
                    t1: bound.selection.t1,
                    v0: bound.selection.v0,
                    v1: bound.selection.v1,
                  }
                : null
            }
            onRangeSelect={(t0, t1, v0, v1) => bound.onRangeSelect(lane.target, t0, t1, v0, v1)}
            onRangeClear={bound.onRangeClear}
          />
        );
      })}
    </>
  );
}

export interface TimelineAutomationLaneSlotProps {
  /** Every clip on the track, in row order — not just the selected one. */
  elements: readonly TimelineElement[];
  isSelected: (element: TimelineElement) => boolean;
  lanes: UseAutomationLanesResult;
  pps: number;
  /** Keyframe lanes already stacked above, which automation sits under. */
  laneCount: number;
  accentColor: string;
  /** Composition-time playhead; the slot converts it to clip-local. */
  currentTime: number;
  /** Composition-time beat grid; the slot converts it to clip-local too. */
  beatTimes?: readonly number[];
}

/**
 * Every automated parameter on this TRACK, one lane per row — the way a DAW
 * stacks them, so two envelopes can be read and edited without swapping a
 * control to see either.
 *
 * Rows belong to the track, not to a clip: clips sharing a row share a row per
 * property (see `groupAutomationLanes`), each drawing over its own span, and a
 * clip that does not automate that property leaves its stretch empty. Binding one
 * clip at a time is what made the visible envelopes change with the selection.
 */
export function TimelineAutomationLaneSlot({
  elements,
  isSelected,
  lanes,
  pps,
  laneCount,
  accentColor,
  currentTime,
  beatTimes,
}: TimelineAutomationLaneSlotProps) {
  const clips = elements.filter(isAudioTimelineElement);
  const rowsByClip = new Map<string, ClipLaneRow[]>();
  groupAutomationLanes(clips).forEach((group, rowIndex) => {
    for (const entry of group.entries) {
      const key = getTimelineElementIdentity(entry.element);
      const rows = rowsByClip.get(key);
      if (rows) rows.push({ lane: entry.lane, rowIndex });
      else rowsByClip.set(key, [{ lane: entry.lane, rowIndex }]);
    }
  });
  const top = getTimelineLaneTop(laneCount);
  return (
    <>
      {clips.map((element) => (
        <ClipAutomationLanes
          key={getTimelineElementIdentity(element)}
          element={element}
          rows={rowsByClip.get(getTimelineElementIdentity(element)) ?? []}
          isSelected={isSelected(element)}
          lanes={lanes}
          pps={pps}
          top={top}
          accentColor={accentColor}
          currentTime={currentTime}
          beatTimes={beatTimes}
        />
      ))}
    </>
  );
}

/**
 * Breakpoint automation over an audio clip, edited the way a DAW edits it:
 * double-click the line to add a point, drag one to shape it, right-click a
 * point to remove it, Alt-drag the line between two points to bend it, and
 * double-click a point to type an exact value.
 *
 * Modifiers follow Ableton's, because that is the muscle memory an automation
 * lane inherits: Shift locks a drag to one axis and fines the value down, Alt
 * over a segment curves it, and Alt during a point drag ignores the grid.
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
import {
  envelopePath,
  fromUnit,
  GRAB_PX,
  laneFor,
  PAD_X,
  toUnit,
  withLane,
} from "./automationLaneGeometry";
import { useAutomationLaneGestures } from "./useAutomationLaneGestures";
import { AutomationValueInput } from "./AutomationValueInput";
import { AutomationSelectionMenu } from "./AutomationSelectionMenu";
import { AUTOMATION_LANE_H } from "./automationLaneHeight";
import { generateShape, type AutomationShapeId } from "./automationShapes";
import { simplifyPoints } from "./automationSimplify";
import { pointsIn, replaceRange } from "./automationLaneSelection";
import { getTimelineLaneTop } from "./timelineLayout";
import type { TimelineElement } from "../store/playerStore";
import type { UseAutomationLanesResult } from "./useAutomationLanes";

/** Pointer shape: a read-only lane can only be selected, a live one edited. */
function laneCursor(readOnly: boolean | undefined, dragging: boolean): string {
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
  /** Active selection on THIS lane, or null. */
  rangeSelection?: { t0: number; t1: number } | null | undefined;
  onRangeSelect?: ((t0: number, t1: number) => void) | undefined;
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
  });
  const { dragIndex, curveIndex, hint, editing } = gestures;

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
      commitPoints(replaceRange({ lane, range, ...rangeSelection, inner }), true);
    },
    [rangeSelection, lane, range, commitPoints],
  );

  const simplifySelection = useCallback((): void => {
    if (!rangeSelection) return;
    const inner = simplifyPoints(pointsIn(lane, rangeSelection.t0, rangeSelection.t1), range);
    commitPoints(replaceRange({ lane, range, ...rangeSelection, inner }), true);
  }, [rangeSelection, lane, range, commitPoints]);

  // A point's own right-click already stops propagation and still deletes;
  // this only fires when the press lands on the background inside the
  // active selection.
  const onSvgContextMenu = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>): void => {
      if (readOnly || !rangeSelection) return;
      const { t } = pointAt(e.clientX, e.clientY);
      if (t < rangeSelection.t0 || t > rangeSelection.t1) return;
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
      className="hf-automation-lane absolute"
      style={{ top: topPx, left: 0, right: 0, height: h }}
      data-automation-lane={target}
    >
      {/* Name at the lane's top-left, like a DAW's lane header. Shown in full —
          a clip starting at zero leaves no gutter to clamp it into — and
          click-through, so it can sit over the envelope without blocking it. */}
      <div
        className="hf-automation-name pointer-events-none absolute whitespace-nowrap font-mono text-[9px] text-panel-text-4"
        style={{ left: 4, top: 2, zIndex: 2 }}
      >
        {range.label}
      </div>

      <svg
        ref={svgRef}
        className="hf-automation-svg absolute"
        style={{
          left: leftPx - PAD_X,
          top: 0,
          width: widthPx + PAD_X * 2,
          height: h,
          cursor: laneCursor(readOnly, dragIndex !== null || curveIndex !== null),
          opacity: readOnly ? 0.55 : 1,
          touchAction: "none",
        }}
        width={widthPx + PAD_X * 2}
        height={h}
        onPointerDown={gestures.onPointerDown}
        onPointerMove={gestures.onPointerMove}
        onPointerUp={gestures.endDrag}
        onPointerCancel={gestures.endDrag}
        onDoubleClick={gestures.onDoubleClick}
        onContextMenu={onSvgContextMenu}
        role="group"
        aria-label={`${range.label} automation`}
      >
        <title>
          {readOnly
            ? "Click to select this clip, then double-click to add a point"
            : "Double-click to add a point, drag to shape, double-click a point to type a value, right-click to remove. Alt-drag the line to curve it. Shift locks an axis; Alt ignores the grid."}
        </title>
        <rect x={PAD_X} y={0} width={widthPx} height={h} fill="rgba(0,0,0,0.18)" rx={3} />
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
          <>
            <rect
              data-automation-selection=""
              x={xOf(rangeSelection.t0)}
              y={0}
              width={Math.max(0, xOf(rangeSelection.t1) - xOf(rangeSelection.t0))}
              height={h}
              fill={accentColor}
              opacity={0.15}
              pointerEvents="none"
            />
            {[rangeSelection.t0, rangeSelection.t1].map((t) => (
              <line
                key={t}
                x1={xOf(t)}
                x2={xOf(t)}
                y1={0}
                y2={h}
                stroke={accentColor}
                opacity={0.5}
              />
            ))}
          </>
        ) : null}
        <path
          d={path}
          fill="none"
          stroke={accentColor}
          strokeWidth={1.5}
          opacity={lane.points.length === 0 ? 0.35 : 0.95}
        />
        {lane.points.map((p, i) => (
          <circle
            key={`${i}-${p.t}`}
            data-automation-point={i}
            cx={xOf(p.t)}
            cy={yOf(p.v)}
            r={i === dragIndex ? GRAB_PX * 0.8 : GRAB_PX * 0.55}
            fill={accentColor}
            stroke="rgba(0,0,0,0.5)"
            strokeWidth={1}
            style={{ cursor: readOnly ? "default" : "grab" }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              removeAt(i);
            }}
          />
        ))}
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

export interface TimelineAutomationLaneSlotProps {
  element: TimelineElement;
  isSelected: boolean;
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
 * Every automated parameter on this clip, one lane per row — the way a DAW
 * stacks them, so two envelopes can be read and edited without swapping a
 * control to see either.
 */
export function TimelineAutomationLaneSlot({
  element,
  isSelected,
  lanes,
  pps,
  laneCount,
  accentColor,
  currentTime,
  beatTimes,
}: TimelineAutomationLaneSlotProps) {
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
  // target that no longer draws.
  useEffect(() => {
    const target = bound.selection?.target;
    if (target !== undefined && !bound.lanes.some((lane) => lane.target === target)) {
      bound.onRangeClear();
    }
  }, [bound]);
  if (bound.lanes.length === 0) return null;
  const inClip = currentTime >= element.start && currentTime <= element.start + element.duration;
  const top = getTimelineLaneTop(laneCount);
  return (
    <>
      {bound.lanes.map((lane, index) => {
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
            topPx={top + index * AUTOMATION_LANE_H}
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
                ? { t0: bound.selection.t0, t1: bound.selection.t1 }
                : null
            }
            onRangeSelect={(t0, t1) => bound.onRangeSelect(lane.target, t0, t1)}
            onRangeClear={bound.onRangeClear}
          />
        );
      })}
    </>
  );
}

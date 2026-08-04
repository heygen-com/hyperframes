/**
 * Breakpoint automation over an audio clip, edited the way a DAW edits it:
 * double-click the line to add a point, drag one to shape it, right-click a
 * point to remove it.
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
  type PointerEvent as ReactPointerEvent,
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
  DRAW_SAMPLES,
  formatValue,
  fromUnit,
  GRAB_PX,
  laneFor,
  PAD_X,
  POINT_MERGE_SEC,
  toUnit,
  withLane,
} from "./automationLaneGeometry";
import { AUTOMATION_LANE_H } from "./automationLaneHeight";
import { getTimelineLaneTop } from "./timelineLayout";
import type { TimelineElement } from "../store/playerStore";
import type { UseAutomationLanesResult } from "./useAutomationLanes";

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
  /** Editing writes to the selected element, so an unselected clip is read-only. */
  readOnly?: boolean;
  /** Called when a read-only lane is pressed: selects the clip so it goes live. */
  onSelect?(): void;
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
  readOnly,
  onSelect,
}: TimelineAutomationLaneProps) {
  const stored = laneFor(automation, target);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);

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

  /**
   * The line the lane draws. A flat line at the current value stands in for a
   * lane with no points, so the first click has something to land on.
   */
  const path = useMemo(() => {
    if (lane.points.length === 0) {
      const y = yOf(range.default ?? (range.min + range.max) / 2);
      return `M ${PAD_X} ${y} L ${PAD_X + widthPx} ${y}`;
    }
    const pts: string[] = [];
    const first = lane.points[0]!;
    pts.push(`M ${PAD_X} ${yOf(first.v)}`);
    pts.push(`L ${xOf(first.t)} ${yOf(first.v)}`);
    for (let i = 0; i + 1 < lane.points.length; i += 1) {
      const a = lane.points[i]!;
      const b = lane.points[i + 1]!;
      if (!a.curve && range.scale === "linear") {
        pts.push(`L ${xOf(b.t)} ${yOf(b.v)}`);
        continue;
      }
      // Curved or log-read: sample it, or the drawing would lie about the
      // envelope the audio thread is going to play.
      for (let k = 1; k <= DRAW_SAMPLES; k += 1) {
        const t = a.t + ((b.t - a.t) * k) / DRAW_SAMPLES;
        pts.push(`L ${xOf(t)} ${yOf(sampleAutomationLane(lane, t, range.scale))}`);
      }
    }
    const last = lane.points[lane.points.length - 1]!;
    pts.push(`L ${PAD_X + widthPx} ${yOf(last.v)}`);
    return pts.join(" ");
  }, [lane, range, widthPx, xOf, yOf]);

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

  /** Index of a point under the pointer, or null. */
  const hitIndex = useCallback(
    (clientX: number, clientY: number): number | null => {
      const box = svgRef.current?.getBoundingClientRect();
      if (!box) return null;
      const px = clientX - box.left;
      const py = clientY - box.top;
      for (let i = 0; i < lane.points.length; i += 1) {
        const p = lane.points[i]!;
        if (Math.hypot(xOf(p.t) - px, yOf(p.v) - py) <= GRAB_PX * 1.6) return i;
      }
      return null;
    },
    [lane, xOf, yOf],
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
      const index = hitIndex(e.clientX, e.clientY);
      if (index === null) return;
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setDragIndex(index);
    },
    [hitIndex, readOnly, onSelect],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>): void => {
      if (dragIndex === null) return;
      e.stopPropagation();
      const { t, v } = pointAt(e.clientX, e.clientY);
      const next = lane.points.map((p, i) => (i === dragIndex ? { ...p, t, v } : p));
      // Re-sort so dragging a point past a neighbour behaves, and keep the
      // dragged one addressable by following where it landed.
      const moved = next[dragIndex]!;
      next.sort((a, b) => a.t - b.t);
      setDragIndex(next.indexOf(moved));
      setHint(`${formatValue(range, v)} @ ${t.toFixed(2)}s`);
      commitPoints(next, false);
    },
    [dragIndex, lane, pointAt, range, commitPoints],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>): void => {
      if (dragIndex === null) return;
      e.stopPropagation();
      setDragIndex(null);
      setHint(null);
      commitPoints(lane.points, true);
    },
    [dragIndex, lane, commitPoints],
  );

  const onDoubleClick = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>): void => {
      if (readOnly) return;
      e.stopPropagation();
      e.preventDefault();
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
    [lane, pointAt, commitPoints, readOnly],
  );

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
          cursor: readOnly ? "pointer" : dragIndex !== null ? "grabbing" : "crosshair",
          opacity: readOnly ? 0.55 : 1,
          touchAction: "none",
        }}
        width={widthPx + PAD_X * 2}
        height={h}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
        role="group"
        aria-label={`${range.label} automation`}
      >
        <title>
          {readOnly
            ? "Click to select this clip, then double-click to add a point"
            : "Double-click to add a point, drag to shape, right-click a point to remove"}
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

      {hint ? (
        <div
          className="hf-automation-hint pointer-events-none absolute rounded-[3px] bg-black/80 px-1 py-0.5 font-mono text-[9px] text-white"
          style={{ left: leftPx + 6, top: 2, zIndex: 3 }}
        >
          {hint}
        </div>
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
}: TimelineAutomationLaneSlotProps) {
  const bound = lanes.bind(element, isSelected);
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
            readOnly={bound.readOnly}
          />
        );
      })}
    </>
  );
}

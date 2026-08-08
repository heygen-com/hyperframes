/**
 * Plays automation envelopes through native AudioParam scheduling.
 *
 * Nothing here runs per frame. The envelope is handed to the audio thread once,
 * as ramps and curves, so it stays sample-accurate no matter what the main
 * thread is doing — and the offline render schedules it the same way, which is
 * why preview and render agree by construction rather than by tolerance.
 */

import {
  isConstantLane,
  resolveAutomationRange,
  sampleAutomationCurve,
  sampleAutomationLane,
  type HfAutomation,
  type HfAutomationLane,
} from "../audioAutomation.js";
import { parseAutomationTarget, VOLUME_TARGET } from "../audioAutomation.js";
import type { HfAudioFxChain } from "../audioFx.js";
import type { FxNodeHandle, FxParamTarget } from "./audioFxGraph.js";

/** Where the clip sits in context time when its source is scheduled. */
export interface AutomationTiming {
  /** Context time the source was scheduled at. */
  scheduledAt: number;
  /** Clip-local seconds already elapsed at that moment; negative before it starts. */
  elapsed: number;
  /** Playback rate, which compresses clip seconds into context seconds. */
  rate: number;
}

/**
 * Sampling density for segments that cannot be expressed as a ramp. Dense
 * enough that a curve is inaudible from a continuous one, capped so a long
 * segment cannot allocate without bound.
 */
const CURVE_POINTS_PER_SEC = 100;
const MIN_CURVE_POINTS = 8;
const MAX_CURVE_POINTS = 4096;

const identity = (v: number): number => v;

type Op =
  | { kind: "set"; time: number; value: number }
  | { kind: "ramp"; time: number; value: number }
  | { kind: "curve"; time: number; duration: number; values: Float32Array };

/**
 * A segment is a straight line only when nothing bends it: no curvature on the
 * point it leaves, a linear parameter scale, and no unit mapping that could be
 * non-linear. Everything else is sampled.
 */
function isStraight(
  curve: number | undefined,
  scale: "linear" | "log",
  map: FxParamTarget["map"],
): boolean {
  return !curve && scale === "linear" && !map;
}

function curvePointCount(duration: number): number {
  const wanted = Math.ceil(duration * CURVE_POINTS_PER_SEC);
  return Math.min(MAX_CURVE_POINTS, Math.max(MIN_CURVE_POINTS, wanted));
}

/**
 * One segment of the envelope, as the event that plays it. Returns null when
 * the segment is already behind the playhead.
 */
function segmentOp(
  lane: HfAutomationLane,
  index: number,
  scale: "linear" | "log",
  timing: AutomationTiming,
  map: FxParamTarget["map"],
): Op | null {
  const { scheduledAt, elapsed, rate } = timing;
  const apply = map ?? identity;
  const toCtx = (t: number): number => scheduledAt + (t - elapsed) / rate;
  const a = lane.points[index]!;
  const b = lane.points[index + 1]!;

  const toTime = toCtx(b.t);
  if (toTime <= scheduledAt) return null;
  const fromTime = Math.max(scheduledAt, toCtx(a.t));
  const duration = toTime - fromTime;
  if (duration <= 0) return null;

  if (isStraight(a.curve, scale, map)) {
    return { kind: "ramp", time: toTime, value: apply(b.v) };
  }
  // Sample from wherever the segment is entered, which is mid-segment when the
  // playhead landed inside it.
  const count = curvePointCount(duration);
  const raw = sampleAutomationCurve(lane, Math.max(a.t, elapsed), b.t, count, scale);
  const values = new Float32Array(count);
  for (let k = 0; k < count; k += 1) values[k] = apply(raw[k] ?? 0);
  return { kind: "curve", time: fromTime, duration, values };
}

/** Turn a lane into the events one AudioParam should receive. */
function planOps(
  lane: HfAutomationLane,
  scale: "linear" | "log",
  timing: AutomationTiming,
  map: FxParamTarget["map"],
): Op[] {
  const ops: Op[] = [];
  for (let i = 0; i + 1 < lane.points.length; i += 1) {
    const op = segmentOp(lane, i, scale, timing, map);
    if (op) ops.push(op);
  }

  // Hold the envelope's value at the moment playback starts. This is what makes
  // a lane correct before its first point and after its last, and it gives a
  // following ramp something to ramp from.
  //
  // A value curve may not overlap another event, so the seed is dropped when a
  // curve already begins at that instant — the curve sets the value itself.
  const first = ops[0];
  if (!(first?.kind === "curve" && first.time <= timing.scheduledAt)) {
    ops.unshift({
      kind: "set",
      time: timing.scheduledAt,
      value: (map ?? identity)(sampleAutomationLane(lane, timing.elapsed, scale)),
    });
  }
  return ops;
}

function emit(param: AudioParam, ops: readonly Op[]): void {
  for (const op of ops) {
    if (op.kind === "set") param.setValueAtTime(op.value, op.time);
    else if (op.kind === "ramp") param.linearRampToValueAtTime(op.value, op.time);
    else param.setValueCurveAtTime(op.values, op.time, op.duration);
  }
}

/**
 * Schedule one lane onto every AudioParam behind its knob.
 *
 * Existing automation from an earlier schedule is cancelled first, so calling
 * this again after an edit replaces the envelope rather than layering on it.
 */
export function scheduleParamLane(
  targets: readonly FxParamTarget[],
  lane: HfAutomationLane,
  scale: "linear" | "log",
  timing: AutomationTiming,
): void {
  if (lane.points.length === 0) return;
  for (const target of targets) {
    target.param.cancelScheduledValues(timing.scheduledAt);
    if (isConstantLane(lane)) {
      const value = (target.map ?? identity)(lane.points[0]!.v);
      target.param.setValueAtTime(value, timing.scheduledAt);
      continue;
    }
    emit(target.param, planOps(lane, scale, timing, target.map));
  }
}

/** Stop an envelope, leaving the parameter wherever it currently sits. */
export function cancelParamLane(targets: readonly FxParamTarget[], from: number): void {
  for (const target of targets) {
    // Keep the value the ramp had reached rather than snapping back to the
    // last explicitly-set one, which would click.
    if (typeof target.param.cancelAndHoldAtTime === "function") {
      target.param.cancelAndHoldAtTime(from);
    } else {
      target.param.cancelScheduledValues(from);
    }
  }
}

/** One built effect, paired with the chain node id lanes address it by. */
export interface AutomatableNode {
  id?: string;
  handle: FxNodeHandle;
}

/**
 * Schedule every FX lane in an automation set against a built chain.
 *
 * Lanes with nowhere to write are skipped rather than reported: a one-pole
 * filter exposes no frequency param, and a worklet effect exposes none at all.
 * Returns the targets that were scheduled, so they can be cancelled together.
 */
export function scheduleChainAutomation(
  automation: HfAutomation,
  chain: HfAudioFxChain,
  nodes: readonly AutomatableNode[],
  timing: AutomationTiming,
): FxParamTarget[] {
  const byId = new Map(nodes.filter((n) => n.id).map((n) => [n.id as string, n.handle]));
  const scheduled: FxParamTarget[] = [];
  for (const lane of automation.lanes) {
    const parsed = parseAutomationTarget(lane.target);
    if (!parsed || parsed.kind !== "fx") continue;
    const targets = byId.get(parsed.nodeId)?.automation?.[parsed.param];
    if (!targets || targets.length === 0) continue;
    const range = resolveAutomationRange(lane.target, chain);
    if (!range) continue;
    scheduleParamLane(targets, lane, range.scale, timing);
    scheduled.push(...targets);
  }
  return scheduled;
}

/** The track's volume lane, if it has one. */
export function volumeLane(automation: HfAutomation): HfAutomationLane | null {
  return automation.lanes.find((lane) => lane.target === VOLUME_TARGET) ?? null;
}

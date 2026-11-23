/**
 * Plays automation envelopes through native AudioParam scheduling.
 *
 * Nothing here runs per frame. The envelope is handed to the audio thread once,
 * as ramps, so it stays sample-accurate no matter what the main
 * thread is doing — and the offline render schedules it the same way, which is
 * why preview and render agree by construction rather than by tolerance.
 */

import {
  isConstantLane,
  isBentSegment,
  resolveAutomationRange,
  sampleAutomationCurve,
  sampleAutomationLane,
  type HfAutomation,
  type HfAutomationLane,
  type HfAutomationPoint,
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
 * Sampling density for bent segments, played as ramps through these points. Dense
 * enough to be inaudible from a continuous bend, capped so a long segment cannot
 * allocate without bound.
 */
const CURVE_POINTS_PER_SEC = 100;
const MIN_CURVE_POINTS = 8;
const MAX_CURVE_POINTS = 4096;

const identity = (v: number): number => v;

interface Op {
  kind: "set" | "ramp";
  time: number;
  value: number;
}

/**
 * A segment is a straight line only when nothing bends it: no curvature and no
 * via point on the point it leaves, a linear parameter scale, and no unit
 * mapping that could be non-linear. Everything else is sampled.
 *
 * Both bend forms have to be checked. `curve` is an exponent; a via point names
 * an interior point the segment passes through, and it is what the timeline
 * writes when a bend is dragged. Testing only the exponent read every dragged
 * bend as straight and played it as a linear ramp — the lane drew one shape and
 * the ear got another.
 */
function isStraight(
  point: Pick<HfAutomationPoint, "curve" | "viaX" | "viaY">,
  scale: "linear" | "log",
  map: FxParamTarget["map"],
): boolean {
  return !isBentSegment(point) && scale === "linear" && !map;
}

function curvePointCount(duration: number): number {
  const wanted = Math.ceil(duration * CURVE_POINTS_PER_SEC);
  return Math.min(MAX_CURVE_POINTS, Math.max(MIN_CURVE_POINTS, wanted));
}

/**
 * One segment of the envelope: a set at its start, then ramps. Bends are ramps
 * through sampled points, never `setValueCurveAtTime`: Chromium's audio thread can
 * move a curve's start without its end, and the next event then aborts the page.
 */
function segmentOps(
  lane: HfAutomationLane,
  index: number,
  scale: "linear" | "log",
  timing: AutomationTiming,
  map: FxParamTarget["map"],
): Op[] {
  const { scheduledAt, elapsed, rate } = timing;
  const apply = map ?? identity;
  const toCtx = (t: number): number => scheduledAt + (t - elapsed) / rate;
  const a = lane.points[index]!;
  const b = lane.points[index + 1]!;

  const toTime = toCtx(b.t);
  const fromTime = Math.max(scheduledAt, toCtx(a.t));
  if (toTime <= fromTime) return [];
  // Entered wherever the playhead is, which is mid-segment when it landed inside it.
  const enter = Math.max(a.t, elapsed);
  const values = isStraight(a, scale, map)
    ? [sampleAutomationLane(lane, enter, scale), b.v]
    : sampleAutomationCurve(lane, enter, b.t, curvePointCount(toTime - fromTime), scale);
  const last = values.length - 1;
  return Array.from(
    values,
    (v, k): Op => ({
      kind: k === 0 ? "set" : "ramp",
      time: k === last ? toTime : fromTime + ((toTime - fromTime) * k) / last,
      value: apply(v),
    }),
  );
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
    ops.push(...segmentOps(lane, i, scale, timing, map));
  }
  // Hold the envelope's value from the moment playback starts: before its first
  // point, and after its last.
  const first = ops[0];
  if (!first || first.time > timing.scheduledAt) {
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
    else param.linearRampToValueAtTime(op.value, op.time);
  }
}

/**
 * Drop every event booked on a parameter. Safe because this scheduler is the only
 * writer of these parameters and the caller re-seeds the value in the same breath.
 */
export function clearParamLane(targets: readonly FxParamTarget[]): void {
  for (const target of targets) target.param.cancelScheduledValues(0);
}

/** Stop an envelope, leaving the parameter wherever it currently sits. */
export function cancelParamLane(targets: readonly FxParamTarget[]): void {
  for (const target of targets) {
    // The value the envelope had reached, not the last one set, which would click.
    const reached = target.param.value;
    clearParamLane([target]);
    target.param.value = reached;
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
    clearParamLane([target]);
    if (isConstantLane(lane)) {
      const value = (target.map ?? identity)(lane.points[0]!.v);
      target.param.setValueAtTime(value, timing.scheduledAt);
      continue;
    }
    emit(target.param, planOps(lane, scale, timing, target.map));
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
  /** The wet/dry blend around each preset run, from `FxChainHandle.presets`. */
  presets?: Record<string, FxParamTarget[]>,
): FxParamTarget[] {
  const byId = new Map(nodes.filter((n) => n.id).map((n) => [n.id as string, n.handle]));
  const scheduled: FxParamTarget[] = [];
  for (const lane of automation.lanes) {
    const parsed = parseAutomationTarget(lane.target);
    if (!parsed) continue;
    // A whole-preset lane drives the wet/dry blend the graph wrapped its run in,
    // rather than any node's parameter — which is the point of it: a preset's
    // nodes share no automatable parameter, and its worklet effects expose none
    // at all.
    const targets =
      parsed.kind === "preset"
        ? presets?.[parsed.presetId]
        : parsed.kind === "fx"
          ? byId.get(parsed.nodeId)?.automation?.[parsed.param]
          : undefined;
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

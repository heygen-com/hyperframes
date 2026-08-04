/**
 * The maths behind an automation lane: which parameters it can offer, how a
 * value maps to a position in the lane, and how a lane is edited.
 *
 * Pure — no React, no DOM. Split from the lane component so the geometry can be
 * tested on its own, and so the component is left with the parts that genuinely
 * need a pointer and a render.
 */

import {
  fxAutomationTarget,
  resolveAutomationRange,
  sampleAutomationLane,
  VOLUME_RANGE,
  VOLUME_TARGET,
  type AutomationRange,
  type HfAutomation,
  type HfAutomationLane,
} from "@hyperframes/core/audio-automation";
import { getAudioFxDef, type HfAudioFxChain } from "@hyperframes/core/audio-fx";

/** Points nearer than this in clip seconds are the same point, not two. */
export const POINT_MERGE_SEC = 0.02;
/** Hit radius for grabbing a point, in px. */
export const GRAB_PX = 7;
/** Samples used to draw a segment the eye should see as curved. */
export const DRAW_SAMPLES = 64;
/**
 * Slack on each side of the envelope, so a point sitting exactly at the clip's
 * start or end is drawn whole instead of half outside the lane. Wide enough for
 * the grab circle plus its stroke.
 */
export const PAD_X = GRAB_PX + 2;

export interface AutomationTargetOption {
  target: string;
  label: string;
  range: AutomationRange;
}

/**
 * Everything this clip could automate: its fader, then each automatable knob of
 * each effect in its chain. Effects with no chain node id are skipped — a lane
 * has nothing stable to address them by (the panel mints ids as it adds nodes).
 */
export function automationTargets(chain: HfAudioFxChain | null): AutomationTargetOption[] {
  const out: AutomationTargetOption[] = [
    { target: VOLUME_TARGET, label: "Volume", range: VOLUME_RANGE },
  ];
  for (const node of chain?.nodes ?? []) {
    out.push(...nodeTargets(node, chain));
  }
  return out;
}

/** One effect's automatable knobs. Empty for a node no lane could address. */
function nodeTargets(
  node: HfAudioFxChain["nodes"][number],
  chain: HfAudioFxChain | null,
): AutomationTargetOption[] {
  const nodeId = node.id;
  const def = nodeId ? getAudioFxDef(node.type) : undefined;
  if (!nodeId || !def) return [];
  const out: AutomationTargetOption[] = [];
  for (const param of def.params) {
    if (param.kind !== "number" || !param.automatable) continue;
    const target = fxAutomationTarget(nodeId, param.key);
    const range = resolveAutomationRange(target, chain ?? undefined);
    if (range) out.push({ target, label: range.label, range });
  }
  return out;
}

/** Value → 0..1 up the lane, honouring a log-read knob's own scale. */
export function toUnit(range: AutomationRange, value: number): number {
  const { min, max } = range;
  if (max <= min) return 0;
  if (range.scale === "log" && min > 0 && value > 0) {
    return (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min));
  }
  return (value - min) / (max - min);
}

export function fromUnit(range: AutomationRange, unit: number): number {
  const t = Math.min(1, Math.max(0, unit));
  const { min, max } = range;
  if (range.scale === "log" && min > 0) {
    return Math.exp(Math.log(min) + t * (Math.log(max) - Math.log(min)));
  }
  return min + t * (max - min);
}

export function formatValue(range: AutomationRange, value: number): string {
  const decimals = range.step >= 1 ? 0 : range.step >= 0.1 ? 1 : 2;
  const shown =
    range.unit === "" && range.max === 1 ? `${Math.round(value * 100)}%` : value.toFixed(decimals);
  return range.unit ? `${shown} ${range.unit}` : shown;
}

/**
 * The `curve` that bends a segment through a dragged point.
 *
 * `applyCurve` raises normalised progress to `2^(2*curve)`, so a point the
 * pointer holds at progress `x` and unit height `f` fixes the exponent:
 * `x^e = f`, hence `e = ln f / ln x` and `curve = log2(e) / 2`. Solving rather
 * than accumulating a delta means the segment passes through the pointer
 * instead of drifting away from it over a long drag.
 *
 * Null when the segment cannot express the shape: a flat segment has no room to
 * bend, and progress or height at the very ends divides by zero.
 */
export function curveForDrag(input: {
  range: AutomationRange;
  a: { t: number; v: number };
  b: { t: number; v: number };
  t: number;
  v: number;
}): number | null {
  const { range, a, b, t, v } = input;
  const span = b.t - a.t;
  if (span <= 0) return null;
  const x = (t - a.t) / span;
  if (x <= 0.001 || x >= 0.999) return null;
  const ua = toUnit(range, a.v);
  const ub = toUnit(range, b.v);
  if (Math.abs(ub - ua) < 0.001) return null;
  const f = (toUnit(range, v) - ua) / (ub - ua);
  if (f <= 0.001 || f >= 0.999) return null;
  return Math.max(-1, Math.min(1, Math.log2(Math.log(f) / Math.log(x)) / 2));
}

/**
 * A point drag with Shift held: one axis at a time, whichever the gesture
 * committed to, and a quarter of the vertical travel for a value that has to
 * land on a number.
 *
 * Which axis "won" is decided in pixels, not in seconds and dB — those are
 * different units and comparing them would make the lock depend on the zoom.
 */
export function applyShiftConstraint(input: {
  range: AutomationRange;
  origin: { t: number; v: number };
  raw: { t: number; v: number };
  /** Same projections the lane draws with, so the comparison is on screen. */
  xOf(t: number): number;
  yOf(v: number): number;
}): { t: number; v: number } {
  const { range, origin, raw, xOf, yOf } = input;
  if (Math.abs(xOf(raw.t) - xOf(origin.t)) > Math.abs(yOf(raw.v) - yOf(origin.v))) {
    return { t: raw.t, v: origin.v };
  }
  const from = toUnit(range, origin.v);
  return { t: origin.t, v: fromUnit(range, from + (toUnit(range, raw.v) - from) * 0.25) };
}

/**
 * Nearest snap target within the threshold, else the time unchanged.
 *
 * A breakpoint is placed by eye, and by eye "on the beat" and "three
 * milliseconds off the beat" look identical — so the lane snaps to the beat grid
 * and to its own neighbouring points, the two things an envelope is usually
 * aligned against.
 */
export function snapLaneTime(t: number, targets: readonly number[], thresholdSec: number): number {
  let best = t;
  let bestDist = thresholdSec;
  for (const target of targets) {
    const d = Math.abs(target - t);
    if (d < bestDist) {
      bestDist = d;
      best = target;
    }
  }
  return best;
}

/**
 * The svg path for one lane's envelope.
 *
 * A flat line at the parameter's own default stands in for a lane with no
 * points, so the first double-click has something to land on. Straight segments
 * are drawn as one line each; a curved or log-read segment is sampled, because
 * drawing it straight would lie about the envelope the audio thread is going to
 * play.
 */
export function envelopePath(input: {
  lane: HfAutomationLane;
  range: AutomationRange;
  widthPx: number;
  xOf(t: number): number;
  yOf(v: number): number;
}): string {
  const { lane, range, widthPx, xOf, yOf } = input;
  const first = lane.points[0];
  const last = lane.points[lane.points.length - 1];
  if (!first || !last) {
    const y = yOf(range.default ?? (range.min + range.max) / 2);
    return `M ${PAD_X} ${y} L ${PAD_X + widthPx} ${y}`;
  }
  const pts = [`M ${PAD_X} ${yOf(first.v)}`, `L ${xOf(first.t)} ${yOf(first.v)}`];
  for (let i = 0; i + 1 < lane.points.length; i += 1) {
    const a = lane.points[i];
    const b = lane.points[i + 1];
    if (!a || !b) continue;
    if (!a.curve && range.scale === "linear") {
      pts.push(`L ${xOf(b.t)} ${yOf(b.v)}`);
      continue;
    }
    for (let k = 1; k <= DRAW_SAMPLES; k += 1) {
      const t = a.t + ((b.t - a.t) * k) / DRAW_SAMPLES;
      pts.push(`L ${xOf(t)} ${yOf(sampleAutomationLane(lane, t, range.scale))}`);
    }
  }
  pts.push(`L ${PAD_X + widthPx} ${yOf(last.v)}`);
  return pts.join(" ");
}

export function laneFor(automation: HfAutomation, target: string): HfAutomationLane {
  return automation.lanes.find((l) => l.target === target) ?? { target, points: [] };
}

/**
 * Replace one lane in place, dropping it when it has no points left.
 *
 * Order is preserved deliberately. A lane with no explicitly chosen parameter
 * shows whichever comes first, so moving the edited one to the end would switch
 * the lane out from under the pointer on the first edit.
 */
export function withLane(automation: HfAutomation, lane: HfAutomationLane): HfAutomation {
  const empty = lane.points.length === 0;
  const exists = automation.lanes.some((l) => l.target === lane.target);
  const lanes = automation.lanes
    .map((l) => (l.target === lane.target ? lane : l))
    .filter((l) => l.points.length > 0);
  if (!exists && !empty) lanes.push(lane);
  return { version: 1, lanes };
}

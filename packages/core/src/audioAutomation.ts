/**
 * Automation envelopes for audio tracks.
 *
 * A lane is a list of breakpoints over one parameter — track volume, or one
 * knob of one effect in the track's FX chain. Ableton's clip-envelope model:
 * times are clip-local, so an envelope travels with the clip when it moves.
 *
 * Nothing here touches Web Audio. This module owns the format and the
 * interpolation, and the same `sampleAutomationLane` is used to draw the lane
 * in the timeline, to schedule it in preview, and to bake it at render — one
 * curve, three consumers, or the picture and the sound disagree.
 */

import { getAudioFxDef, type HfAudioFxChain, type HfAudioFxNumberParam } from "./audioFx.js";

export const HF_AUDIO_AUTOMATION_ATTR = "data-automation";

/** Automation files are versioned; a reader must refuse a version it doesn't know. */
export const HF_AUDIO_AUTOMATION_VERSION = 1;

/**
 * A pathological document should not be able to hang the scheduler, which
 * expands every segment into scheduled ramps. Well past any hand-drawn
 * envelope; a lane is dense at 100 points.
 */
export const MAX_AUTOMATION_POINTS = 512;

export interface HfAutomationPoint {
  /** Seconds from the start of the clip, not the composition. */
  t: number;
  /** Value in the parameter's own unit — dB for a threshold, Hz for a cutoff. */
  v: number;
  /**
   * Curvature of the segment *leaving* this point, -1..1. Absent or 0 is a
   * straight line; positive holds low then rises late, negative rises early.
   */
  curve?: number;
}

export interface HfAutomationLane {
  /** `volume`, or `fx.<nodeId>.<paramKey>`. */
  target: string;
  points: HfAutomationPoint[];
}

export interface HfAutomation {
  version: number;
  lanes: HfAutomationLane[];
}

export class AudioAutomationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioAutomationError";
  }
}

export const VOLUME_TARGET = "volume";

export type HfAutomationTarget = { kind: "volume" } | { kind: "fx"; nodeId: string; param: string };

/** Split a target string. Returns null for anything unrecognised. */
export function parseAutomationTarget(target: string): HfAutomationTarget | null {
  if (target === VOLUME_TARGET) return { kind: "volume" };
  const parts = target.split(".");
  if (parts.length !== 3 || parts[0] !== "fx") return null;
  const [, nodeId, param] = parts;
  if (!nodeId || !param) return null;
  return { kind: "fx", nodeId, param };
}

export function fxAutomationTarget(nodeId: string, param: string): string {
  return `fx.${nodeId}.${param}`;
}

/**
 * The value range a lane is drawn and clamped against.
 *
 * Volume is linear 0..1, matching `data-volume` and the existing volume
 * envelope machinery — no dB conversion enters the volume path. Everything
 * else is read from the effect registry, so a lane can never offer a value the
 * renderer would reject, and the log-scaled knobs sweep the way a DAW's do.
 */
export interface AutomationRange {
  min: number;
  max: number;
  step: number;
  unit: string;
  label: string;
  scale: "linear" | "log";
  /** Where an empty lane draws its flat line, and what a new point starts at. */
  default: number;
}

export const VOLUME_RANGE: AutomationRange = {
  min: 0,
  max: 1,
  step: 0.01,
  unit: "",
  label: "Volume",
  scale: "linear",
  default: 1,
};

/**
 * Resolve a lane's target against a chain. Returns null when the target names
 * a node or parameter that is not there — the effect was deleted, or the
 * parameter is an enum, which has no envelope between its values.
 */
export function resolveAutomationRange(
  target: string,
  chain: HfAudioFxChain | undefined,
): AutomationRange | null {
  const parsed = parseAutomationTarget(target);
  if (!parsed) return null;
  if (parsed.kind === "volume") return VOLUME_RANGE;
  const node = chain?.nodes.find((n) => n.id === parsed.nodeId);
  if (!node) return null;
  const def = getAudioFxDef(node.type);
  const param = def?.params.find((p) => p.key === parsed.param);
  if (!param || param.kind !== "number") return null;
  const p = param as HfAudioFxNumberParam;
  return {
    min: p.min,
    max: p.max,
    step: p.step,
    unit: p.unit,
    label: `${def?.label ?? node.type} · ${p.label}`,
    scale: p.scale === "log" && p.min > 0 ? "log" : "linear",
    default: p.default,
  };
}

/**
 * Coerce a JSON field to a number, treating anything that is not already one —
 * or a string that plainly reads as one — as absent.
 *
 * Not `Number(raw)`: that turns `null`, `""` and `[]` into 0, which for an
 * envelope means a silent drop to zero rather than a point the reader rejects.
 */
function numberOrNull(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clampCurve(v: unknown): number {
  const n = numberOrNull(v);
  if (n === null || n === 0) return 0;
  return Math.min(1, Math.max(-1, n));
}

/**
 * Clean one point, or reject it.
 *
 * A missing or non-finite value reaching an AudioParam silences the node for
 * the rest of the render, so such a point is dropped rather than coerced.
 */
function cleanPoint(
  p: HfAutomationPoint | undefined,
  range: AutomationRange | null,
): HfAutomationPoint | null {
  const t = numberOrNull(p?.t);
  const v = numberOrNull(p?.v);
  if (t === null || v === null) return null;
  const clamped = range ? Math.min(range.max, Math.max(range.min, v)) : v;
  const curve = clampCurve(p?.curve);
  return { t: Math.max(0, t), v: clamped, ...(curve ? { curve } : {}) };
}

/**
 * Order points, drop unusable ones, and collapse duplicate times.
 *
 * Later wins on a tie so that dragging a point onto another replaces it rather
 * than leaving an invisible one underneath.
 */
function normalizePoints(
  points: readonly HfAutomationPoint[],
  range: AutomationRange | null,
): HfAutomationPoint[] {
  const clean = points
    .map((p) => cleanPoint(p, range))
    .filter((p): p is HfAutomationPoint => p !== null)
    .sort((a, b) => a.t - b.t);
  const out: HfAutomationPoint[] = [];
  for (const p of clean) {
    if (out.length > 0 && out[out.length - 1]!.t === p.t) out[out.length - 1] = p;
    else out.push(p);
  }
  return out.slice(0, MAX_AUTOMATION_POINTS);
}

/**
 * Structural normalisation, with no knowledge of the chain: sort and clean the
 * points of every lane and drop lanes that carry none. Range clamping and
 * orphan removal need the chain and happen in `resolveAutomation`.
 */
export function normalizeAutomation(automation: HfAutomation): HfAutomation {
  const lanes: HfAutomationLane[] = [];
  for (const lane of automation.lanes) {
    if (!parseAutomationTarget(lane.target)) continue;
    const range = lane.target === VOLUME_TARGET ? VOLUME_RANGE : null;
    const points = normalizePoints(lane.points ?? [], range);
    if (points.length > 0) lanes.push({ target: lane.target, points });
  }
  return { version: HF_AUDIO_AUTOMATION_VERSION, lanes };
}

/**
 * Bind automation to a chain: clamp each lane into its parameter's declared
 * range and drop lanes whose target no longer exists.
 *
 * Dropping is deliberate. An envelope on a deleted effect has nothing to
 * drive, and keeping it would silently reattach if an unrelated effect later
 * took the same node id.
 */
export function resolveAutomation(
  automation: HfAutomation,
  chain: HfAudioFxChain | undefined,
): HfAutomation {
  const lanes: HfAutomationLane[] = [];
  for (const lane of automation.lanes) {
    const range = resolveAutomationRange(lane.target, chain);
    if (!range) continue;
    const points = normalizePoints(lane.points, range);
    if (points.length > 0) lanes.push({ target: lane.target, points });
  }
  return { version: HF_AUDIO_AUTOMATION_VERSION, lanes };
}

/**
 * Parse an automation attribute.
 *
 * Malformed input throws rather than being skipped, matching the chain reader:
 * a track that quietly loses its envelope renders differently from the project
 * the author saved, which is worse than refusing.
 */
export function parseAutomation(json: string): HfAutomation {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new AudioAutomationError(`Automation is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof raw !== "object" || raw === null) {
    throw new AudioAutomationError("Automation must be a JSON object.");
  }
  const obj = raw as { version?: unknown; lanes?: unknown };
  if (obj.version !== HF_AUDIO_AUTOMATION_VERSION) {
    throw new AudioAutomationError(`Unsupported automation version: ${String(obj.version)}`);
  }
  if (!Array.isArray(obj.lanes)) {
    throw new AudioAutomationError("Automation is missing a `lanes` array.");
  }
  const lanes: HfAutomationLane[] = obj.lanes.map((l, i) => {
    if (typeof l !== "object" || l === null) {
      throw new AudioAutomationError(`Lane ${i} is not an object.`);
    }
    const lane = l as { target?: unknown; points?: unknown };
    if (typeof lane.target !== "string" || !parseAutomationTarget(lane.target)) {
      throw new AudioAutomationError(`Lane ${i} has an unreadable target: ${String(lane.target)}`);
    }
    if (!Array.isArray(lane.points)) {
      throw new AudioAutomationError(`Lane ${i} is missing a \`points\` array.`);
    }
    return { target: lane.target, points: lane.points as HfAutomationPoint[] };
  });
  return normalizeAutomation({ version: HF_AUDIO_AUTOMATION_VERSION, lanes });
}

/** Serialise for the `data-automation` attribute. */
export function serializeAutomation(automation: HfAutomation): string {
  return JSON.stringify({
    version: HF_AUDIO_AUTOMATION_VERSION,
    lanes: automation.lanes.map((lane) => ({
      target: lane.target,
      points: lane.points.map((p) => ({
        t: p.t,
        v: p.v,
        ...(p.curve ? { curve: p.curve } : {}),
      })),
    })),
  });
}

/**
 * Shape the 0..1 progress across a segment.
 *
 * `curve` is an exponent in disguise: 0 is linear, and the ends reach a
 * quarter-power and a fourth-power bend, which is about the range a DAW's
 * envelope handle covers before the segment stops reading as a curve.
 */
export function applyCurve(x: number, curve: number | undefined): number {
  if (!curve) return x;
  return Math.pow(x, Math.pow(2, 2 * curve));
}

function lerpValue(a: number, b: number, x: number, scale: "linear" | "log"): number {
  // A frequency sweep interpolated linearly spends almost all its time in the
  // top octave. Log-scaled parameters interpolate in log space so a 200 Hz to
  // 8 kHz move sounds like an even sweep, which is what the knob's own scale
  // already promises.
  if (scale === "log" && a > 0 && b > 0) {
    return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * x);
  }
  return a + (b - a) * x;
}

/**
 * Value of a lane at a clip-local time.
 *
 * Outside the points, the envelope holds — the first value before it starts
 * and the last value after it ends, so a lane never snaps to zero at the edges.
 */
export function sampleAutomationLane(
  lane: HfAutomationLane,
  t: number,
  scale: "linear" | "log" = "linear",
): number {
  const pts = lane.points;
  if (pts.length === 0) return 0;
  const first = pts[0]!;
  if (t <= first.t) return first.v;
  const last = pts[pts.length - 1]!;
  if (t >= last.t) return last.v;

  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = pts[lo]!;
  const b = pts[hi]!;
  const span = b.t - a.t;
  if (span <= 0) return b.v;
  return lerpValue(a.v, b.v, applyCurve((t - a.t) / span, a.curve), scale);
}

/** True when the lane is a single value, i.e. worth setting once and not scheduling. */
export function isConstantLane(lane: HfAutomationLane): boolean {
  return lane.points.length <= 1 || lane.points.every((p) => p.v === lane.points[0]!.v);
}

/**
 * Sample a lane onto evenly spaced times, for consumers that want a plain
 * curve rather than a breakpoint list: `setValueCurveAtTime`, the render-side
 * volume envelope, and the lane's own drawing code.
 */
export function sampleAutomationCurve(
  lane: HfAutomationLane,
  from: number,
  to: number,
  count: number,
  scale: "linear" | "log" = "linear",
): Float32Array {
  const n = Math.max(2, Math.floor(count));
  const out = new Float32Array(n);
  const span = to - from;
  for (let i = 0; i < n; i += 1) {
    out[i] = sampleAutomationLane(lane, from + (span * i) / (n - 1), scale);
  }
  return out;
}

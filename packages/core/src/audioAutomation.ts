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

import { getAudioFxDef, type HfAudioFxChain } from "./audioFx.js";

export const HF_AUDIO_AUTOMATION_ATTR = "data-automation";

/** The same attribute as a `dataset` / `dataAttributes` key. See `HF_AUDIO_FX_DATA_KEY`. */
export const HF_AUDIO_AUTOMATION_DATA_KEY = HF_AUDIO_AUTOMATION_ATTR.slice("data-".length);

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
  /**
   * An interior point the segment *leaving* this point passes through, in
   * normalised segment space: `viaX` is progress 0..1 between the two
   * breakpoints, `viaY` is how far the value has travelled by then. Both are
   * needed for either to mean anything; without them the segment falls back to
   * `curve` above, so everything authored before this existed reads unchanged.
   *
   * Two numbers rather than one because `curve` answers only "how hard", and an
   * exponent cannot say "and where". Every upward bend a single exponent can
   * draw has its deepest deviation in the first fifth of the segment, whatever
   * the author aimed at, and an exponent steep enough to reach a point near
   * either end runs past the ±1 the model accepts — so a bend dragged near the
   * right-hand breakpoint bulged on the left and then stopped following the
   * pointer at all. Naming the point the curve goes through makes both the
   * height and the position of the bend the author's to choose, and takes the
   * saturation with it: any interior point is reachable exactly.
   */
  viaX?: number;
  viaY?: number;
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

export type HfAutomationTarget =
  | { kind: "volume" }
  | { kind: "fx"; nodeId: string; param: string }
  | { kind: "preset"; presetId: string };

/** Split a target string. Returns null for anything unrecognised. */
export function parseAutomationTarget(target: string): HfAutomationTarget | null {
  if (target === VOLUME_TARGET) return { kind: "volume" };
  const parts = target.split(".");
  // `fx.preset.<id>` before the 3-part fx form, because it IS a 3-part fx form
  // with a reserved node id — an effect can never be called "preset", since ids
  // are minted `n1`, `n2`, ….
  if (parts.length === 3 && parts[0] === "fx" && parts[1] === PRESET_TARGET_KEY) {
    const presetId = parts[2];
    return presetId ? { kind: "preset", presetId } : null;
  }
  if (parts.length !== 3 || parts[0] !== "fx") return null;
  const [, nodeId, param] = parts;
  if (!nodeId || !param) return null;
  return { kind: "fx", nodeId, param };
}

export function fxAutomationTarget(nodeId: string, param: string): string {
  return `fx.${nodeId}.${param}`;
}

/** The reserved node-id slot that marks a whole-preset target. */
const PRESET_TARGET_KEY = "preset";

/**
 * How much of a preset is applied, 0..1.
 *
 * A preset's nodes share no automatable parameter — and its worklet effects
 * expose no AudioParams at all — so there is nothing to aim a lane at
 * node-by-node. The graph wraps a preset's run in a wet/dry pair instead, and
 * this drives the blend: 0 is the dry signal untouched, 1 is the preset fully
 * applied, and between them it crossfades.
 */
export function presetAutomationTarget(presetId: string): string {
  return `fx.${PRESET_TARGET_KEY}.${presetId}`;
}

/** 0..1 blend, the same shape as a wet/dry mix knob. */
export const PRESET_RANGE: AutomationRange = {
  min: 0,
  max: 1,
  step: 0.01,
  unit: "",
  label: "Amount",
  scale: "linear",
  default: 1,
};

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
  if (parsed.kind === "preset") {
    // Only for a preset the chain actually carries, so a lane left behind by a
    // removed preset resolves to nothing and is dropped at read time — the same
    // contract an orphaned node lane has.
    const present = chain?.nodes.some((n) => n.fromPreset === parsed.presetId);
    return present ? { ...PRESET_RANGE, label: `${parsed.presetId} · Amount` } : null;
  }
  const node = chain?.nodes.find((n) => n.id === parsed.nodeId);
  if (!node) return null;
  const def = getAudioFxDef(node.type);
  const param = def?.params.find((p) => p.key === parsed.param);
  if (!param || param.kind !== "number") return null;
  return {
    min: param.min,
    max: param.max,
    step: param.step,
    unit: param.unit,
    label: `${def?.label ?? node.type} · ${param.label}`,
    scale: param.scale === "log" && param.min > 0 ? "log" : "linear",
    default: param.default,
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
 * A via point, or null when there isn't a usable one.
 *
 * Only two things disqualify one: a coordinate outside the segment, which names a
 * point the curve does not travel through, and a point ON the straight line, which
 * is a straight line — storing that would claim a bend the segment does not have.
 *
 * Depth is deliberately NOT limited. An earlier version held bends to a maximum
 * slope so a segment could never leave a breakpoint steeply, and it was wrong twice
 * over: it capped how far a curve could be pulled, and clamping the two coordinates
 * separately could land a bend exactly on the straight line and flatten it mid-drag.
 * A steep departure is a smooth curve doing what it was asked; what must never
 * happen is a crease, and that is the sampler's job below, not a limit here.
 */
function clampVia(rawX: unknown, rawY: unknown): { x: number; y: number } | null {
  const x = numberOrNull(rawX);
  const y = numberOrNull(rawY);
  if (x === null || y === null) return null;
  const inside = (n: number): number => Math.min(0.999, Math.max(0.001, n));
  const cx = inside(x);
  const cy = inside(y);
  if (Math.abs(cx - cy) < 1e-6) return null;
  return { x: cx, y: cy };
}

/**
 * The via point a segment will actually be drawn with, given one that was asked
 * for — pulled into the steady region, or null when it describes no bend.
 *
 * Exported so an editor can write what the model will honour rather than what the
 * pointer happened to ask for. Without it a lane's attribute claims a shape the
 * renderer quietly declines to draw, and the two only agree once the file makes a
 * round trip.
 */
export function steadyViaPoint(
  viaX: number | undefined,
  viaY: number | undefined,
): { viaX: number; viaY: number } | null {
  const via = clampVia(viaX, viaY);
  return via ? { viaX: via.x, viaY: via.y } : null;
}

/**
 * The shape fields a point carries, cleaned: whichever of `curve` and the via
 * pair survive, each omitted when it describes nothing.
 *
 * The via pair is kept or dropped together. Half a via point says nothing, and
 * letting one coordinate through would leave the segment's shape depending on
 * which half survived a hand edit.
 */
function shapeFields(
  p: HfAutomationPoint | undefined,
): Pick<HfAutomationPoint, "curve" | "viaX" | "viaY"> {
  const curve = clampCurve(p?.curve);
  const via = clampVia(p?.viaX, p?.viaY);
  return {
    ...(curve ? { curve } : {}),
    ...(via ? { viaX: via.x, viaY: via.y } : {}),
  };
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
  return { t: Math.max(0, t), v: clamped, ...shapeFields(p) };
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
        ...(p.viaX !== undefined && p.viaY !== undefined ? { viaX: p.viaX, viaY: p.viaY } : {}),
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

/**
 * The conic that carries a segment through its via point: control point and weight
 * of a rational quadratic Bezier from (0,0) to (1,1).
 *
 * A rational quadratic at its own midparameter is `(P0 + 2wC + P1) / (2 + 2w)`, so
 * demanding that equal the via point `Q` fixes the control point for any weight:
 * `C = Q + (Q - M) / w`, with `M` the straight midpoint. The curve therefore passes
 * exactly through `Q` whatever the weight, and — because it does so at the
 * midparameter, with the two halves symmetric in parameter — its furthest departure
 * from the straight line is at `Q` too. The pointer is the apex, by construction.
 *
 * The weight is what buys reach. A plain quadratic (`w = 1`) needs its control point
 * at `2Q - M`, which leaves the segment as soon as `Q` is past the middle half — so
 * a plain quadratic simply cannot pass through a deep or off-centre point. Raising
 * the weight draws the control point back toward `Q`, so take the smallest weight
 * that keeps `C` inside the segment: inside is what makes progress monotone, and
 * smallest-that-fits is the broadest curve available through that point.
 *
 * Deep bends therefore come out tight and steep near the breakpoint they lean on.
 * That is the shape being asked for, and it stays a single smooth arc while doing
 * it — no join, no inflection, no crease.
 */
function viaConic(viaX: number, viaY: number): { cx: number; cy: number; w: number } {
  const dx = viaX - 0.5;
  const dy = viaY - 0.5;
  const edge = 0.999;
  // Per axis, `C` stays inside when the weight is at least the pull divided by the
  // room left in the pull's own direction. A via point clamped to `edge` itself
  // leaves zero room — `edge - viaX` is exactly 0 — which would divide out to
  // Infinity and carry NaN into every downstream sample. Capped rather than left
  // unbounded: past this weight the arc already reads as touching the via point,
  // so the cap costs no visible reach.
  const MAX_WEIGHT = 1e6;
  const needX = dx > 0 ? dx / (edge - viaX) : dx < 0 ? -dx / (viaX - (1 - edge)) : 0;
  const needY = dy > 0 ? dy / (edge - viaY) : dy < 0 ? -dy / (viaY - (1 - edge)) : 0;
  const w = Math.min(MAX_WEIGHT, Math.max(1, needX, needY));
  return { cx: viaX + dx / w, cy: viaY + dy / w, w };
}

/**
 * Progress through a segment that passes through its via point: one conic arc, from
 * breakpoint to breakpoint.
 *
 * One curve, not two joined at the via point, because anything joined there can only
 * be as smooth as the join — and keeping such a join monotone forces its tangent
 * down to a fraction of the slope the curve arrives with, creasing the segment
 * exactly where the pointer is. A conic has no join and no inflection: its slope
 * moves one way from end to end, which is what makes it read as one curve rather
 * than a shape with features in it.
 */
function shapeVia(x: number, viaX: number, viaY: number): number {
  const { cx, cy, w } = viaConic(viaX, viaY);
  // Both coordinates are quadratics over one shared denominator, so `x(t) = x`
  // rearranges into an ordinary quadratic in `t`: closed form, and the same answer on
  // every machine, which a render that has to match its own preview depends on.
  const spread = 2 - 2 * w;
  const a = x * spread - 1 + 2 * w * cx;
  const b = -x * spread - 2 * w * cx;
  const t = conicParam(a, b, x);
  const rest = 1 - t;
  const denominator = rest * rest + 2 * w * t * rest + t * t;
  if (!(denominator > 0)) return x;
  return (2 * w * cy * t * rest + t * t) / denominator;
}

/** The root of `a*t^2 + b*t + c` that lies on the arc the segment travels. */
function conicParam(a: number, b: number, c: number): number {
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? c : -c / b;
  const root = Math.sqrt(Math.max(0, b * b - 4 * a * c));
  const first = (-b + root) / (2 * a);
  const second = (-b - root) / (2 * a);
  const onArc = (t: number): boolean => t >= -1e-9 && t <= 1 + 1e-9;
  if (onArc(first)) return Math.min(1, Math.max(0, first));
  if (onArc(second)) return Math.min(1, Math.max(0, second));
  return c;
}

/**
 * The progress a segment leaving `point` has reached at normalised `x`.
 *
 * A via point wins when it is there, since it says strictly more than an
 * exponent can. Everything authored before via points existed carries only
 * `curve` and takes the exponent path unchanged.
 */
export function shapeProgress(
  x: number,
  point: { curve?: number | undefined; viaX?: number | undefined; viaY?: number | undefined },
): number {
  const via = clampVia(point.viaX, point.viaY);
  if (via) return shapeVia(Math.min(1, Math.max(0, x)), via.x, via.y);
  return applyCurve(x, point.curve);
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
  return lerpValue(a.v, b.v, shapeProgress((t - a.t) / span, a), scale);
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

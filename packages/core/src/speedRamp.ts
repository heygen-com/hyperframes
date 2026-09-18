/** A ramp is a `rate` lane in `data-automation`; `sourceTimeAt` is the one rate-to-time mapping consumers share. */

import { RATE_TARGET, sampleAutomationLane, type HfAutomationLane } from "./audioAutomation.js";
import { laneFromAttr } from "./runtime/audioAutomationVolume.js";
import { MAX_PLAYBACK_RATE, MIN_PLAYBACK_RATE } from "./playbackRateBounds.js";

/** A constant multiplier, or a lane whose `v` is the multiplier over clip-local time. */
export type RateSpec = number | HfAutomationLane;

const PRESERVE_PITCH_ATTR = "data-preserve-pitch";

const SHIFT_RESAMPLES = 16;

/**
 * The lane as seen from `dt` seconds into the clip: what a renderer sees after it trims the clip's start.
 * A shaped segment (`curve`, `viaX`) cut in the middle is resampled, since its shape belongs to its left point.
 */
export function shiftRateLane(spec: RateSpec, dt: number): RateSpec {
  if (typeof spec === "number" || dt === 0) return spec;
  const next = spec.points.findIndex((p) => p.t > dt);
  const later = next < 0 ? [] : spec.points.slice(next).map((p) => ({ ...p, t: p.t - dt }));
  const left = next > 0 ? spec.points[next - 1] : undefined;
  const shaped = left !== undefined && (left.curve || left.viaX !== undefined);
  const cut = shaped && next > 0 ? spec.points[next]!.t - dt : 0;
  const samples = Array.from({ length: shaped ? SHIFT_RESAMPLES - 1 : 0 }, (_, k) => {
    const t = ((k + 1) * cut) / SHIFT_RESAMPLES;
    return { t, v: rateAt(spec, dt + t) };
  });
  return { ...spec, points: [{ t: 0, v: rateAt(spec, dt) }, ...samples, ...later] };
}

const CELLS_PER_SEGMENT = 48;

interface RateTable {
  /** Ascending clip-local times and the source seconds consumed by each. */
  ts: Float64Array;
  ss: Float64Array;
  firstRate: number;
  lastRate: number;
}

const tables = new WeakMap<HfAutomationLane, RateTable>();

function buildTable(lane: HfAutomationLane): RateTable {
  const pts = lane.points;
  const firstRate = pts[0]!.v;
  const lastRate = pts[pts.length - 1]!.v;
  const ts: number[] = [0];
  const ss: number[] = [0];
  const push = (t: number) => {
    const prevT = ts[ts.length - 1]!;
    if (t <= prevT) return;
    const prevRate = sampleAutomationLane(lane, prevT, "log");
    ts.push(t);
    ss.push(
      ss[ss.length - 1]! + ((prevRate + sampleAutomationLane(lane, t, "log")) / 2) * (t - prevT),
    );
  };
  const first = Math.max(0, pts[0]!.t);
  push(first);
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!.t;
    const b = pts[i]!.t;
    if (b <= 0) continue;
    for (let k = 1; k <= CELLS_PER_SEGMENT; k += 1)
      push(Math.max(a, 0) + ((b - a) * k) / CELLS_PER_SEGMENT);
  }
  return { ts: Float64Array.from(ts), ss: Float64Array.from(ss), firstRate, lastRate };
}

function tableFor(lane: HfAutomationLane): RateTable {
  let table = tables.get(lane);
  if (!table) {
    table = buildTable(lane);
    tables.set(lane, table);
  }
  return table;
}

function usable(spec: RateSpec): spec is HfAutomationLane {
  return typeof spec !== "number" && spec.points.length > 0;
}

/** Speed multiplier at clip-local time `t`. */
export function rateAt(spec: RateSpec, t: number): number {
  if (typeof spec === "number") return spec;
  return usable(spec) ? sampleAutomationLane(spec, t, "log") : 1;
}

/** Piecewise-linear lookup of `x` in the ascending `xs`, read off `ys`; caller keeps `x` inside `xs`. */
function interpolate(xs: Float64Array, ys: Float64Array, x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) lo = mid;
    else hi = mid;
  }
  return ys[lo]! + ((ys[hi]! - ys[lo]!) * (x - xs[lo]!)) / (xs[hi]! - xs[lo]!);
}

/** Source seconds consumed by clip-local time `t` (the integral of the rate). */
export function sourceTimeAt(spec: RateSpec, t: number): number {
  if (typeof spec === "number") return t * spec;
  if (!usable(spec)) return t;
  const { ts, ss, firstRate, lastRate } = tableFor(spec);
  const last = ts.length - 1;
  if (t <= 0) return t * firstRate;
  if (t >= ts[last]!) return ss[last]! + (t - ts[last]!) * lastRate;
  return interpolate(ts, ss, t);
}

/** Inverse of `sourceTimeAt`: the clip-local time at which `source` seconds have been consumed. */
export function timeAtSourceTime(spec: RateSpec, source: number): number {
  if (typeof spec === "number") return source / spec;
  if (!usable(spec)) return source;
  const { ts, ss, firstRate, lastRate } = tableFor(spec);
  const last = ts.length - 1;
  if (source <= 0) return source / firstRate;
  if (source >= ss[last]!) return ts[last]! + (source - ss[last]!) / lastRate;
  return interpolate(ss, ts, source);
}

/** The `rate` lane inside a `data-automation` attribute value, or null when absent or unreadable. */
export function parseRateLane(raw: string | null | undefined): HfAutomationLane | null {
  return raw ? laneFromAttr(raw, RATE_TARGET) : null;
}

/** A clip's rate: its `rate` lane when it has one, otherwise the constant. */
export function resolveRateSpec(
  automationAttr: string | null | undefined,
  constant: number,
): RateSpec {
  return parseRateLane(automationAttr) ?? constant;
}

/** Pitch is preserved unless the clip opts out with `data-preserve-pitch="false"`. */
export function readPreservePitch(el: Pick<Element, "getAttribute">): boolean {
  return el.getAttribute(PRESERVE_PITCH_ATTR) !== "false";
}

interface RatePreset {
  id: string;
  label: string;
  /** Points as [progress 0..1 through the clip, speed]. */
  points: ReadonlyArray<readonly [number, number]>;
}

/** The CapCut-style presets; `speedPresetLane` stretches one over a clip's duration. */
export const SPEED_PRESETS = [
  {
    id: "montage",
    label: "Montage",
    points: [
      [0, 0.9],
      [0.15, 0.3],
      [0.5, 2.5],
      [0.85, 0.3],
      [1, 0.9],
    ],
  },
  {
    id: "hero",
    label: "Hero",
    points: [
      [0, 1],
      [0.25, 1.6],
      [0.5, 0.25],
      [0.75, 1.6],
      [1, 1],
    ],
  },
  {
    id: "bullet",
    label: "Bullet",
    points: [
      [0, 3],
      [0.4, 3],
      [0.5, 0.15],
      [0.6, 3],
      [1, 3],
    ],
  },
  {
    id: "jump-cut",
    label: "Jump cut",
    points: [
      [0, 0.5],
      [0.24, 0.5],
      [0.26, 3],
      [0.5, 3],
      [0.52, 0.5],
      [0.74, 0.5],
      [0.76, 3],
      [1, 3],
    ],
  },
  {
    id: "flash-in",
    label: "Flash in",
    points: [
      [0, 0.3],
      [0.6, 0.6],
      [1, 5],
    ],
  },
  {
    id: "flash-out",
    label: "Flash out",
    points: [
      [0, 5],
      [0.4, 0.6],
      [1, 0.3],
    ],
  },
] as const satisfies readonly RatePreset[];

export type SpeedPresetId = (typeof SPEED_PRESETS)[number]["id"];

export function speedPresetLane(id: SpeedPresetId, clipDuration: number): HfAutomationLane {
  const preset = SPEED_PRESETS.find((p) => p.id === id)!;
  return {
    target: RATE_TARGET,
    points: preset.points.map(([x, v]) => ({
      t: x * clipDuration,
      v: Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, v)),
    })),
  };
}

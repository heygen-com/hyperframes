/**
 * "Even Out Levels" — the first of the adaptive scripts.
 *
 * A preset cannot fix inconsistent loudness, because the right correction
 * depends on the recording. So this measures the track and writes an automation
 * lane that lifts the quiet passages toward the loud ones, exactly as the carve
 * measures a voice and writes its bands.
 *
 * It is NOT loudness normalisation. Platform targets (-14 LUFS and friends) are
 * ITU-R BS.1770 — K-weighted and gated — and this is plain windowed RMS, so
 * calling it LUFS would be a claim the measurement does not support. It is
 * named for what it does: evening out.
 *
 * ## Why the lane rides a `gain` node
 *
 * The obvious home is the track's volume lane, and the old reason not to use it
 * — "volume is 0..1, so a lane can only ever attenuate" — is being retired in
 * stages: `normaliseEnvelope` now clamps to 0..+12 dB, while `VOLUME_RANGE`,
 * which bounds the lane itself, still stops at unity until the dB fader lands.
 *
 * The reason that survives either way is ownership: the volume lane is the
 * fader the author draws, and a leveller that wrote into it would silently
 * redraw their envelope. A `gain` node is a separate stage the leveller owns
 * outright, which is what the audio skill means when it calls `gain` "what an
 * automation lane rides when a track has to move".
 */

import {
  fxAutomationTarget,
  type HfAutomation,
  type HfAutomationPoint,
} from "./audioAutomation.js";
import {
  HF_AUDIO_FX_CHAIN_VERSION,
  mintAudioFxNodeId,
  normalizeAudioFxParams,
  type HfAudioFxChain,
  type HfAudioFxNode,
} from "./audioFx.js";

/** One window per emitted point; the hop keeps the lane inside its budget. */
const FRAME = 4096;
const POINT_BUDGET = 400;
/** Below this, a window is silence rather than a quiet passage worth lifting. */
const FLOOR_BELOW_PEAK_DB = 42;
/** How far a correction may go. Beyond this, lifting a whisper only lifts the room. */
const MAX_LIFT_DB = 12;
const MAX_CUT_DB = 12;
/** Ignore differences smaller than this — they are not audible and they add points. */
const SNAP_DB = 0.4;
/** Attack/release in seconds, so a correction rides the phrase and not the syllable. */
const ATTACK_S = 0.35;
const RELEASE_S = 0.9;

export interface HfLevellerSettings {
  /** 0 = leave it alone, 1 = as even as this can make it. */
  strength: number;
}

export const DEFAULT_LEVELLER: HfLevellerSettings = { strength: 0.5 };

export interface HfLevellerProfile {
  /** How much of the measured difference to correct. */
  correction: number;
}

/**
 * One knob to a profile, the shape `carveProfile` established.
 *
 * At full strength this still corrects only most of the difference: driving a
 * track to a flat line removes the performance along with the inconsistency.
 */
export function levellerProfile(strength: number): HfLevellerProfile {
  const s = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0.5;
  return { correction: Number((0.25 + s * 0.6).toFixed(3)) };
}

/** Level in dB of one window, or -Infinity for silence. */
function windowDb(samples: Float32Array, from: number, count: number): number {
  let sum = 0;
  let n = 0;
  for (let i = from; i < from + count; i += 1) {
    const s = samples[i];
    if (s === undefined) break;
    sum += s * s;
    n += 1;
  }
  if (n === 0) return Number.NEGATIVE_INFINITY;
  const rms = Math.sqrt(sum / n);
  return rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY;
}

/**
 * Measure a track and return the gain moves that even it out, in dB against
 * clip-local seconds. Empty when there is nothing worth correcting.
 */
export function analyseLevelling(
  samples: Float32Array,
  sampleRate: number,
  strength = DEFAULT_LEVELLER.strength,
): HfAutomationPoint[] {
  if (samples.length === 0 || sampleRate <= 0) return [];
  const profile = levellerProfile(strength);
  const hop = Math.max(FRAME, Math.ceil(samples.length / POINT_BUDGET));

  const levels: number[] = [];
  const times: number[] = [];
  for (let start = 0; start < samples.length; start += hop) {
    levels.push(windowDb(samples, start, FRAME));
    times.push((start + FRAME / 2) / sampleRate);
  }
  const speaking = levels.filter((d) => Number.isFinite(d));
  if (speaking.length === 0) return [];

  const peak = Math.max(...speaking);
  const floor = peak - FLOOR_BELOW_PEAK_DB;
  /**
   * The target is a level the track ALREADY REACHES — the 80th percentile of
   * its speaking windows — not an absolute one.
   *
   * Anchoring it to an absolute figure means an already-even track gets pulled
   * bodily up or down to meet it, which is a volume change wearing a
   * levelling label. Against a level the track reaches, its loud passages
   * correct to roughly nothing and only the quiet ones move, which is what
   * evening out means. It is a percentile rather than the peak so one loud
   * word cannot set the target for the whole track.
   */
  const sorted = [...speaking].sort((a, b) => a - b);
  const target = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.8))] ?? peak;

  const attack = 1 - Math.exp(-(hop / sampleRate) / ATTACK_S);
  const release = 1 - Math.exp(-(hop / sampleRate) / RELEASE_S);

  let applied = 0;
  const raw: HfAutomationPoint[] = [];
  levels.forEach((db, i) => {
    // Silence is left alone. Lifting a pause only lifts the room with it.
    const wanted =
      Number.isFinite(db) && db > floor
        ? Math.max(-MAX_CUT_DB, Math.min(MAX_LIFT_DB, (target - db) * profile.correction))
        : 0;
    applied += (wanted > applied ? attack : release) * (wanted - applied);
    const v = Math.abs(applied) < SNAP_DB ? 0 : Number(applied.toFixed(1));
    raw.push({ t: Number((times[i] ?? 0).toFixed(3)), v });
  });

  // Keep only the moves. A run of equal values is held by keeping the last of
  // the run, or interpolation would slide across a passage that is steady.
  const points: HfAutomationPoint[] = [];
  let lastKept = 0;
  let keptIndex = -1;
  raw.forEach((pt, i) => {
    if (i !== raw.length - 1 && Math.abs(pt.v - lastKept) < SNAP_DB) return;
    if (i > 0 && keptIndex !== i - 1) {
      const prev = raw[i - 1];
      if (prev) points.push(prev);
    }
    points.push(pt);
    lastKept = pt.v;
    keptIndex = i;
  });

  // A lane of zeroes is not a correction, it is a lane that says nothing. An
  // author who runs this on an even track should be told there was nothing to
  // do, not handed an inert envelope to wonder about.
  if (points.length === 0 || points.every((p) => p.v === 0)) return [];
  // A lane's first point has to sit at the clip's start, or everything before
  // it is drawn from wherever the first move happens to be.
  if ((points[0]?.t ?? 0) > 0) points.unshift({ t: 0, v: points[0]?.v ?? 0 });
  return points;
}

/**
 * The chain and lane for "Even Out Levels".
 *
 * Returns nothing when the track needs no correcting — a script that always
 * writes something teaches an author that it is doing nothing.
 */
export function levellingResult(
  chain: HfAudioFxChain,
  samples: Float32Array,
  sampleRate: number,
  strength = DEFAULT_LEVELLER.strength,
): { chain: HfAudioFxChain; automation: HfAutomation } | null {
  const points = analyseLevelling(samples, sampleRate, strength);
  if (points.length === 0) return null;

  const existing = chain.nodes.find((n) => n.fromLeveller);
  const id = existing?.id ?? mintAudioFxNodeId(chain);
  const node: HfAudioFxNode = {
    type: "gain",
    id,
    fromLeveller: true,
    label: "Even Out Levels",
    enabled: true,
    // Seeded at 0 dB: the lane is what moves it, and a non-zero seed would be
    // heard for the instant before the first ramp is scheduled.
    params: normalizeAudioFxParams("gain", { gain: 0 }),
  };

  /**
   * In FRONT of a trailing limiter, not after it.
   *
   * The likely sequence is "apply Clean Voice, then even out the levels", and
   * Clean Voice ends in a Peak Ceiling. Appending would put up to 12 dB of lift
   * AFTER the ceiling that exists to bound the chain — so every quiet-to-loud
   * transition leaves residual lift on loud material sitting at -1 dBFS, and
   * the render shears it flat. A ceiling that something is added after is not
   * a ceiling.
   */
  const insertAt =
    !existing && chain.nodes[chain.nodes.length - 1]?.type === "limiter"
      ? chain.nodes.length - 1
      : chain.nodes.length;

  return {
    chain: {
      version: HF_AUDIO_FX_CHAIN_VERSION,
      nodes: existing
        ? chain.nodes.map((n) => (n.fromLeveller ? node : n))
        : [...chain.nodes.slice(0, insertAt), node, ...chain.nodes.slice(insertAt)],
    },
    automation: {
      version: 1,
      lanes: [{ target: fxAutomationTarget(id, "gain"), points }],
    },
  };
}

/** Drop the leveller and say which lane went with it. */
export function removeLevelling(chain: HfAudioFxChain): {
  chain: HfAudioFxChain;
  removedTarget: string | null;
} {
  const node = chain.nodes.find((n) => n.fromLeveller);
  return {
    chain: { ...chain, nodes: chain.nodes.filter((n) => !n.fromLeveller) },
    removedTarget: node?.id ? fxAutomationTarget(node.id, "gain") : null,
  };
}

/** What the module says when it is closed. */
export function levellingSummary(points: readonly HfAutomationPoint[]): string {
  const moves = points.filter((p) => p.v !== 0);
  if (moves.length === 0) return "Already even — nothing to do";
  const lift = Math.max(...moves.map((p) => p.v));
  const cut = Math.min(...moves.map((p) => p.v));
  const parts: string[] = [];
  if (lift > 0) parts.push(`lifting quiet parts up to ${lift.toFixed(1)} dB`);
  if (cut < 0) parts.push(`holding loud parts down ${Math.abs(cut).toFixed(1)} dB`);
  return parts.join(", ");
}

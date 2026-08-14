/**
 * One knob over several, for the five effects that cannot honestly have one
 * real parameter nominated as the control that matters.
 *
 * A compressor has seven controls and an author wants one. The rest of the rack
 * opens on a single real parameter — a filter's frequency, a delay's mix — but
 * these five have no such parameter: threshold means nothing without ratio,
 * ratio means nothing without make-up gain, and picking any one of them as the
 * face of the module would be a knob that lies about what it sets.
 *
 * So they get a derived one, exactly as the carve already does: `carveProfile`
 * turns a single 0..1 into six numbers, and these do the same for the rest of
 * the rack. `EFFECT_COPY[id].primary` is `"strength"` for precisely these five,
 * which is what says a module wants this treatment.
 *
 * Continuous rather than the three-point tables the design proposed. A table
 * makes gentle/middle/strong three settings an author picks between, and the
 * thing being modelled is not three settings — it is one axis, and the carve's
 * knob has proved that reads. The proposal's figures survive as the anchors:
 * each curve passes through them at 0, 0.5 and 1.
 *
 * Every number below is expressed in the parameter's own registry unit and then
 * clamped by `normalizeAudioFxParams` on the way into the chain, so a profile
 * cannot ship a value the effect would refuse.
 */

import { normalizeAudioFxParams, type HfAudioFxParamValues } from "./audioFx.js";

/** 0..1, whatever arrives. NaN reads as the middle rather than as silence. */
function clamp01(strength: number): number {
  return Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0.5;
}

/** Two decimal places, so a derived value reads as a setting and not as float noise. */
function to2(value: number): number {
  return Number(value.toFixed(2));
}

export interface HfAudioFxProfile {
  /** What the one knob is called. Never the DSP name of anything it drives. */
  label: string;
  /** What the two ends sound like — the question an author actually has. */
  ends: { low: string; high: string };
  /** The parameters it sets. Everything else keeps the effect's own default. */
  derives: readonly string[];
  /** The mechanism values at a given strength. */
  at(strength: number): HfAudioFxParamValues;
}

export const HF_AUDIO_FX_PROFILES: Record<string, HfAudioFxProfile> = {
  compressor: {
    label: "Evenness",
    ends: { low: "Barely touched", high: "Very even, quite squashed" },
    derives: ["threshold", "ratio", "attack", "release", "makeup"],
    at(strength) {
      const s = clamp01(strength);
      return {
        // Lower threshold and higher ratio together: more of the signal is
        // caught, and what is caught is held harder. Moving one without the
        // other is the pair of knobs this exists to stop an author meeting.
        threshold: to2(-12 - s * 18),
        ratio: to2(2 + s * 4),
        // Faster as it gets firmer, because a firm compressor that lets peaks
        // through is doing the audible half of its job and not the useful half.
        attack: to2(25 - s * 20),
        release: to2(300 - s * 210),
        // Compression makes things quieter; this is the level put back, and it
        // has to rise with the amount taken off or the knob reads as a volume
        // control that goes the wrong way.
        //
        // Solved from measurement rather than proposed, and it is not linear:
        // gain reduction accelerates as the threshold drops and the ratio rises
        // together, so a straight line is too loud in the middle and too quiet
        // at the top. The design's 1/3/7 dB left the track +0.9 dB at rest,
        // +1.3 dB at the middle and −2.5 dB at full. Numbers in
        // `~/audio-fx-profiles-ab/README.md`.
        makeup: to2(s * s * 9.5),
      };
    },
  },

  gate: {
    label: "Tightness",
    ends: { low: "Only true silence", high: "Cuts quiet parts too" },
    derives: ["threshold", "range", "release"],
    at(strength) {
      const s = clamp01(strength);
      return {
        threshold: to2(-55 + s * 23),
        // How far the gaps are ducked, never to silence: a room that stops dead
        // between sentences sounds broken rather than clean.
        range: to2(-10 - s * 20),
        // Release has to come along, which the design did not have — and it
        // dominates: swept against a fixed threshold and range, the gaps move
        // 0.2 dB at 140 ms and 13.4 dB at 10 ms. Left at the effect's 100 ms
        // default the gate was very nearly inaudible whatever else it was told.
        //
        // Measured on narration, speech level is unmoved (−24.0 dB) at every
        // release down to 10 ms, so the usual reason to stay slow — clipping
        // word endings — does not bite on this material at these thresholds.
        release: to2(120 - s * 105),
      };
    },
  },

  saturate: {
    label: "Warmth",
    ends: { low: "Just a sheen", high: "Openly distorted" },
    derives: ["threshold", "output"],
    at(strength) {
      const s = clamp01(strength);
      return {
        // Drive: the lower the threshold, the more of the signal meets the
        // curve.
        threshold: to2(-3 - s * 15),
        // Up, not down — which reverses the design's figure, on the measurement
        // that motivated taking one. A soft clipper at -18 dB threshold IS a
        // limiter at -18 dB: peak fell to 0.089 from 0.496 and RMS almost
        // halved, so the proposed trim of −3 dB made "warmer" mean "much
        // quieter" and an author would have heard the level, not the warmth.
        // Accelerating for the same reason as the compressor's make-up.
        output: to2(s * s * 2.8),
      };
    },
  },

  reverb: {
    label: "Space",
    ends: { low: "A small tight room", high: "A big open hall" },
    derives: ["size", "wet", "dry"],
    at(strength) {
      const s = clamp01(strength);
      return {
        // Anchored at the design's three figures — 0.25 / 0.55 / 0.90 — which a
        // single linear run cannot hit, because 0.55 is not their midpoint.
        size: to2(s <= 0.5 ? 0.25 + s * 0.6 : 0.55 + (s - 0.5) * 0.7),
        wet: to2(0.15 + s * 0.3),
        // Dry comes down as wet goes up, but not by the same amount: the two
        // legs sum, and matching them exactly makes a big room quieter than a
        // small one instead of further away.
        dry: to2(0.92 - s * 0.2),
      };
    },
  },

  bitcrush: {
    label: "Crush",
    ends: { low: "Slightly gritty", high: "Destroyed" },
    derives: ["bits", "samples", "mix"],
    at(strength) {
      const s = clamp01(strength);
      return {
        // Fewer steps and longer holds. `bits` runs DOWN as the knob runs up,
        // which is why it cannot be the module's face on its own.
        bits: to2(14 - s * 8),
        samples: Math.max(1, Math.round(1 + s * 3)),
        mix: to2(0.25 + s * 0.75),
      };
    },
  },
};

export function getAudioFxProfile(type: string): HfAudioFxProfile | undefined {
  return HF_AUDIO_FX_PROFILES[type];
}

/**
 * The parameters a profile sets at this strength, merged over what is there.
 *
 * Merged rather than replacing: a profile names only the parameters it derives,
 * and the rest — a compressor's knee, a saturation's curve type — are the
 * author's to set under Details and must survive the knob moving.
 */
export function applyAudioFxProfile(
  type: string,
  strength: number,
  params: HfAudioFxParamValues,
): HfAudioFxParamValues {
  const profile = getAudioFxProfile(type);
  if (!profile) return params;
  return normalizeAudioFxParams(type, { ...params, ...profile.at(strength) });
}

/**
 * The strength a set of parameters reads as, by inverting the profile's own
 * curve on its most characteristic parameter.
 *
 * A chain stores mechanism values, not the knob — the same contract
 * `normalizeCarveSettings` has, and for the same reason: the mechanism is what
 * renders, so it is what must be authoritative. Reading the knob back means one
 * parameter has to be nominated as the one that says most about intent.
 *
 * A hand-edited chain therefore lands the knob at the nearest strength that
 * would have produced its most telling value, which is the honest answer — the
 * alternative is a knob parked at a default while the effect is set to
 * something else entirely.
 */
export function audioFxProfileStrength(type: string, params: HfAudioFxParamValues): number {
  const profile = getAudioFxProfile(type);
  if (!profile) return 0.5;
  const key = profile.derives[0];
  if (key === undefined) return 0.5;
  const value = params[key];
  if (typeof value !== "number") return 0.5;
  // Searched, not inverted algebraically: a curve is free to be piecewise — the
  // reverb's `size` is, because the design's three anchors are not evenly
  // spaced — and a straight line between the endpoints reads such a curve back
  // at the wrong place. Setting Space to 0.5 wrote size 0.55 and reopening the
  // project drew the knob at 0.46, so every reopen nudged the sound.
  //
  // The grid IS the knob's own resolution (0.01), not something finer: a finer
  // grid lands between two settable positions and rounds to a neighbour, which
  // is how a search can be off by a step even where the curve is exact.
  // Searching only reachable values makes the round trip exact.
  const STEPS = 100;
  let best = 0.5;
  let bestErr = Infinity;
  for (let i = 0; i <= STEPS; i += 1) {
    const s = to2(i / STEPS);
    const at = profile.at(s)[key];
    if (typeof at !== "number") continue;
    const err = Math.abs(at - value);
    if (err < bestErr) {
      bestErr = err;
      best = s;
    }
  }
  return bestErr === Infinity ? 0.5 : to2(best);
}

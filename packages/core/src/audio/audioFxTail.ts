/**
 * How long a chain keeps ringing after its input stops.
 *
 * The render used to end the offline context at the last input sample, so a
 * reverb or a delay was cut mid-tail — the one place the render did not match
 * preview. The length is not a guess: every tail-producing effect here has a
 * decay that follows from its own settings, so the render can ask for exactly
 * the room it needs.
 */

import { fxAutomationTarget, type HfAutomation } from "../audioAutomation.js";
import { normalizeAudioFxParams, type HfAudioFxChain, type HfAudioFxNode } from "../audioFx.js";

/**
 * Ceiling on the extension, in seconds.
 *
 * Delay is unbounded in principle: 5 s between repeats at 0.95 feedback decays
 * for eleven minutes, and the panel can dial exactly that. A tail that outruns
 * the composition costs render time and mixes into everything after it, so the
 * chain gets the room it asks for up to here and is cut beyond it.
 */
export const MAX_FX_TAIL_SECONDS = 5;

/**
 * Where a tail stops counting as audible: -60 dB below the signal that fed it,
 * the usual convention for a reverb time. Anything quieter is under the noise
 * floor of every codec this renders to.
 */
const TAIL_FLOOR = 0.001;

/**
 * The largest value a knob reaches, over the whole clip.
 *
 * A lane's `curve` is an exponent, so a segment is monotone between its two
 * points and cannot overshoot either — the maximum point value is the maximum
 * of the lane, no sampling needed. Room size has to be sized for the loudest
 * moment regardless of where in the clip it falls.
 */
function knobMax(node: HfAudioFxNode, key: string, automation?: HfAutomation): number {
  // Normalised, so a knob missing from the attribute reads as its default and
  // an out-of-range one is clamped the way the graph builder would clamp it.
  const fallback = Number(normalizeAudioFxParams(node.type, node.params)[key] ?? 0);
  if (!node.id || !automation) return Number.isFinite(fallback) ? fallback : 0;
  const lane = automation.lanes.find((l) => l.target === fxAutomationTarget(node.id ?? "", key));
  if (!lane || lane.points.length === 0) return Number.isFinite(fallback) ? fallback : 0;
  return lane.points.reduce((max, p) => Math.max(max, p.v), -Infinity);
}

/**
 * Repeats until a feedback loop falls under the floor, times the gap between
 * them. `feedback` is capped below 1 by the registry, so this terminates.
 */
function delayTail(time: number, feedback: number): number {
  const gap = Math.min(5, time / 1000);
  if (gap <= 0) return 0;
  const fb = Math.max(0, Math.min(0.999, feedback));
  if (fb <= 0) return gap;
  return Math.ceil(Math.log(TAIL_FLOOR) / Math.log(fb)) * gap;
}

/** One node's tail. Zero when it has none, or when it is mixed out entirely. */
function nodeTail(node: HfAudioFxNode, automation?: HfAutomation): number {
  if (node.enabled === false) return 0;
  switch (node.type) {
    case "reverb":
      // Exactly the generated impulse's length — see synthesizeReverbImpulse,
      // which is the same expression. A convolution is as long as its impulse.
      return knobMax(node, "wet", automation) > 0
        ? 0.6 + Math.max(0, Math.min(1, knobMax(node, "size", automation))) * 2.6
        : 0;
    case "delay":
      return knobMax(node, "mix", automation) > 0
        ? delayTail(knobMax(node, "time", automation), knobMax(node, "feedback", automation))
        : 0;
    case "chorus":
      // A single delay line, no feedback: it rings for one delay (≤100 ms).
      return knobMax(node, "mix", automation) > 0 ? knobMax(node, "delay", automation) / 1000 : 0;
    default:
      // Everything else settles with its input. The phaser is an all-pass chain
      // with no recirculation (group delay, not a tail); the dynamics nodes have
      // long releases but no signal to release — silence in, silence out; a
      // biquad rings for ~Q/f, which is microseconds.
      return 0;
  }
}

/**
 * The whole chain's tail, in seconds.
 *
 * Summed, not maxed: the chain is serial, so a delay in front of a reverb hands
 * each of its repeats to the room and the last one still gets a full tail.
 */
export function chainTailSeconds(chain: HfAudioFxChain, automation?: HfAutomation): number {
  const total = chain.nodes.reduce((sum, node) => sum + nodeTail(node, automation), 0);
  return Math.min(MAX_FX_TAIL_SECONDS, total);
}

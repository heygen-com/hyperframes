/**
 * The volume lane's gain for an element at a moment in its clip.
 *
 * Volume is not scheduled onto the gain AudioParam the way FX parameters are.
 * The runtime rewrites that gain every tick from `data-volume` and the GSAP
 * seeked value, which would erase a scheduled envelope within a frame — so the
 * lane feeds the same per-tick path the probed `volumeKeyframes` already use,
 * and the render still bakes it into the samples.
 */

import {
  HF_AUDIO_AUTOMATION_ATTR,
  parseAutomation,
  sampleAutomationLane,
  VOLUME_TARGET,
  type HfAutomationLane,
} from "../audioAutomation.js";

/**
 * Parsed lanes by the attribute text they came from. Reparsing on every tick
 * would run the JSON parser 60 times a second per track for a value that only
 * changes when the author edits it.
 */
const cache = new Map<string, HfAutomationLane | null>();
const CACHE_LIMIT = 64;

function laneFromAttr(raw: string): HfAutomationLane | null {
  const hit = cache.get(raw);
  if (hit !== undefined) return hit;
  let lane: HfAutomationLane | null = null;
  try {
    lane = parseAutomation(raw).lanes.find((l) => l.target === VOLUME_TARGET) ?? null;
  } catch {
    // Unreadable automation plays the track flat rather than silencing it.
    lane = null;
  }
  if (cache.size > CACHE_LIMIT) cache.clear();
  cache.set(raw, lane);
  return lane;
}

/**
 * Gain the lane asks for at `relTime` clip-local seconds, or null when the
 * element has no volume lane and the caller should fall back to its own rules.
 */
export function elementVolumeLaneGain(
  el: { getAttribute?(name: string): string | null },
  relTime: number,
): number | null {
  const raw =
    (typeof el.getAttribute === "function" ? el.getAttribute(HF_AUDIO_AUTOMATION_ATTR) : null) ??
    "";
  if (!raw) return null;
  const lane = laneFromAttr(raw);
  if (!lane || lane.points.length === 0) return null;
  return sampleAutomationLane(lane, relTime);
}

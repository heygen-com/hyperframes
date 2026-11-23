/**
 * The volume lane's gain for an element at a moment in its clip.
 *
 * Read per tick for a clip that sounds through `el.volume`. A clip the Web Audio
 * transport routes plays its lane scheduled on a gain of its own
 * (`attachClipStages`), out of reach of the per-tick gain write.
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

/** The lane for `target` inside a `data-automation` value, or null when absent or unreadable. */
export function laneFromAttr(raw: string, target: string = VOLUME_TARGET): HfAutomationLane | null {
  const key = `${target}\0${raw}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let lane: HfAutomationLane | null = null;
  try {
    lane = parseAutomation(raw).lanes.find((l) => l.target === target) ?? null;
  } catch {
    // Unreadable automation plays the track flat rather than silencing it.
    lane = null;
  }
  if (cache.size > CACHE_LIMIT) cache.clear();
  cache.set(key, lane);
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

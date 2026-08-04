/**
 * Reading an element's automation, shared by the lane UI and the row layout.
 *
 * The attributes are carried on TimelineElement verbatim rather than parsed at
 * the manifest boundary: the lane reads and writes them, and round-tripping
 * through the attribute is what keeps the lane, the property panel and the
 * running audio graph on one source of truth.
 *
 * Both parse the same two attributes: the layout needs the lane count to
 * reserve height, the lanes need the lanes themselves. Parsing is cached by the
 * attribute text so the identity only changes when the text does — the lane's
 * drag draft compares against that identity, and a fresh object on every
 * playhead tick would throw away the drag in progress.
 */

import {
  parseAutomation,
  resolveAutomation,
  type HfAutomation,
  type HfAutomationLane,
} from "@hyperframes/core/audio-automation";
import { parseAudioFxChain, type HfAudioFxChain } from "@hyperframes/core/audio-fx";
import type { TimelineElement } from "../store/playerStore";

const EMPTY: HfAutomation = { version: 1, lanes: [] };

const chainCache = new Map<string, HfAudioFxChain | null>();
const automationCache = new Map<string, HfAutomation>();
const CACHE_LIMIT = 64;

/**
 * Parse once per distinct attribute text, keeping the same object until the text
 * changes — the lane compares its drag draft against that identity.
 *
 * Eviction drops the oldest entry rather than clearing the map: clearing would
 * change the identity of every lane's automation at once, and any lane mid-drag
 * would release its draft and jump back to the stored value.
 */
function cached<T>(store: Map<string, T>, key: string, build: () => T): T {
  const hit = store.get(key);
  if (hit !== undefined) {
    // Re-insert so the entry counts as recently used.
    store.delete(key);
    store.set(key, hit);
    return hit;
  }
  const value = build();
  if (store.size >= CACHE_LIMIT) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
  store.set(key, value);
  return value;
}

/** The element's FX chain, or null when it has none or it is unreadable. */
export function elementFxChain(element: TimelineElement): HfAudioFxChain | null {
  const raw = element.fxChain;
  if (!raw) return null;
  return cached(chainCache, raw, () => {
    try {
      return parseAudioFxChain(raw);
    } catch {
      return null;
    }
  });
}

/**
 * The element's automation, bound to its chain the same way preview and the
 * render bind it: a lane whose effect has been deleted is dropped rather than
 * drawn on the wrong axis.
 */
export function elementAutomation(element: TimelineElement): HfAutomation {
  const raw = element.automation;
  if (!raw) return EMPTY;
  const chain = elementFxChain(element);
  // Both texts key the entry: the resolved lanes depend on the chain too. Joined
  // through a separator no attribute can contain.
  return cached(automationCache, `${raw}\u0000${element.fxChain ?? ""}`, () => {
    try {
      return resolveAutomation(parseAutomation(raw), chain ?? undefined);
    } catch {
      // Unreadable automation draws no lanes rather than breaking the row.
      return EMPTY;
    }
  });
}

/** Lanes in the order they are drawn, one row each. */
export function elementAutomationLanes(element: TimelineElement): HfAutomationLane[] {
  return elementAutomation(element).lanes;
}

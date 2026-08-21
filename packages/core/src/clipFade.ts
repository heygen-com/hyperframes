/**
 * Clip fades: the picture's level over a clip's life.
 *
 * A fade is not an animation, it is a value that moves, so it lives where every
 * other moving value on a clip lives: `data-automation`, in a lane targeting
 * `opacity`. That is the whole storage. There is no `data-fade-in` and there
 * never should be, because a fade is a two-point envelope and the framework
 * already has envelopes.
 *
 * What this buys, beyond one fewer attribute to learn:
 *
 * - **A fade survives editing.** The points are data, not a tween, so a trim or
 *   a move cannot leave a fade addressed to a moment that no longer exists.
 * - **A fade is not a special case.** Drag a third point into the middle and it
 *   stops being a fade and becomes an envelope, in the same lane, with no
 *   migration and nothing to reconcile.
 * - **One editor.** The automation lane already draws and edits breakpoints for
 *   sound; picture gets it for free.
 *
 * Levels are applied as a `filter`, never as `opacity` — see `clipFadeFilter`.
 */

import {
  OPACITY_TARGET,
  parseAutomation,
  sampleAutomationLane,
  type HfAutomation,
  type HfAutomationLane,
} from "./audioAutomation";

export const HF_AUTOMATION_ATTR = "data-automation";

/** The opacity lane of a clip's automation, or null when it carries none. */
export function opacityLane(automation: HfAutomation | null): HfAutomationLane | null {
  if (!automation) return null;
  const lane = automation.lanes.find((l) => l.target === OPACITY_TARGET);
  return lane && lane.points.length > 0 ? lane : null;
}

/**
 * Whether the element declares a picture level at all, without parsing one.
 *
 * The runtime asks this of every timed element on every frame and almost none
 * of them answer yes, so the common path stays a single attribute lookup.
 */
export function hasClipFadeAttributes(hasAttribute: (name: string) => boolean): boolean {
  return hasAttribute(HF_AUTOMATION_ATTR);
}

/**
 * Read a clip's opacity lane out of its automation attribute, or null when it
 * has none. Takes a reader rather than an element so the same parse runs
 * against a DOM node in the runtime, a parsed node in the linter, and a plain
 * record in a test.
 */
export function parseClipFade(
  getAttribute: (name: string) => string | null,
): HfAutomationLane | null {
  const raw = getAttribute(HF_AUTOMATION_ATTR);
  if (!raw) return null;
  try {
    return opacityLane(parseAutomation(raw));
  } catch {
    // A malformed envelope is the audio path's problem to report; the picture
    // just stays at full level rather than disappearing.
    return null;
  }
}

/**
 * The clip's level at `elapsed` seconds into its own window: 1 fully visible,
 * 0 gone.
 *
 * Times are clip-local, so the envelope is addressed to the clip and not to the
 * timeline. That is what lets a fade survive a move: nothing in here knows
 * where on the timeline the clip currently sits.
 */
export function clipFadeLevelAt(lane: HfAutomationLane, elapsed: number): number {
  const level = sampleAutomationLane(lane, Math.max(0, elapsed), "linear");
  return level <= 0 ? 0 : level >= 1 ? 1 : level;
}

/**
 * The CSS `filter` a faded clip should carry, composed onto whatever filter the
 * author wrote. `filter`, not `opacity`: opacity is the property animation
 * engines drive, and a runtime that writes it every frame fights them for it.
 * `filter: opacity()` multiplies with whatever they set instead.
 *
 * Returns the authored filter unchanged at full level, so a clip outside its
 * fades carries exactly what its author gave it and nothing else.
 */
export function clipFadeFilter(authoredFilter: string, level: number): string {
  const authored = authoredFilter.trim();
  if (level >= 1) return authored;
  const opacity = `opacity(${Math.max(0, level).toFixed(4)})`;
  return authored ? `${authored} ${opacity}` : opacity;
}

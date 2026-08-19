/**
 * Clip fades: `data-fade-in` / `data-fade-out` on any timed element.
 *
 * A fade is declared, not animated. The author writes how long it lasts and the
 * runtime attenuates the clip over that stretch of its own window — so a fade
 * survives a trim, a move, and a re-render, and there is no tween to keep in
 * sync with the clip's timing.
 *
 * Visual clips fade on opacity. Audio is deliberately NOT covered here: a fade
 * on a sound is volume automation, it already has `data-automation` to live in,
 * and putting it there keeps it editable as breakpoints rather than as one
 * number.
 */

export const HF_FADE_IN_ATTR = "data-fade-in";
export const HF_FADE_OUT_ATTR = "data-fade-out";
export const HF_FADE_CURVE_ATTR = "data-fade-curve";

/**
 * The shape a fade takes across its length.
 *
 * - `linear` — a straight ramp. Predictable, and what a cut-to-black wants.
 * - `smooth` — eases out of and into the extreme; the least noticeable fade.
 * - `sharp` — holds near the extreme, then moves late. Reads as a "snap" fade.
 */
export type HfFadeCurve = "linear" | "smooth" | "sharp";

const FADE_CURVES: readonly HfFadeCurve[] = ["linear", "smooth", "sharp"];

export interface HfClipFade {
  /** Seconds of fade at the clip's head. */
  fadeIn: number;
  /** Seconds of fade at the clip's tail. */
  fadeOut: number;
  curve: HfFadeCurve;
}

/** Ease a 0..1 progress through the named curve. */
export function fadeEase(progress: number, curve: HfFadeCurve): number {
  const p = progress <= 0 ? 0 : progress >= 1 ? 1 : progress;
  switch (curve) {
    case "smooth":
      return p * p * (3 - 2 * p);
    case "sharp":
      return p * p;
    case "linear":
      return p;
  }
}

function parseSeconds(raw: string | null | undefined): number {
  if (raw == null) return 0;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function parseCurve(raw: string | null | undefined): HfFadeCurve {
  const value = raw?.trim().toLowerCase();
  return FADE_CURVES.find((curve) => curve === value) ?? "linear";
}

/**
 * Whether the element declares a fade at all, without parsing one.
 *
 * The runtime asks this of every timed element on every frame and almost none
 * of them answer yes, so the common path stays two attribute lookups.
 */
export function hasClipFadeAttributes(hasAttribute: (name: string) => boolean): boolean {
  return hasAttribute(HF_FADE_IN_ATTR) || hasAttribute(HF_FADE_OUT_ATTR);
}

/**
 * Read a clip's fade from its attributes, or null when it declares none.
 *
 * Takes an attribute reader rather than an element so the same parse runs
 * against a DOM node in the runtime, a parsed node in the linter, and a plain
 * record in a test.
 */
export function parseClipFade(getAttribute: (name: string) => string | null): HfClipFade | null {
  const fadeIn = parseSeconds(getAttribute(HF_FADE_IN_ATTR));
  const fadeOut = parseSeconds(getAttribute(HF_FADE_OUT_ATTR));
  if (fadeIn <= 0 && fadeOut <= 0) return null;
  return { fadeIn, fadeOut, curve: parseCurve(getAttribute(HF_FADE_CURVE_ATTR)) };
}

/**
 * The clip's level at `elapsed` seconds into a window `duration` long: 1 at
 * full, 0 at silence/transparent.
 *
 * Fades that would overlap share the window in proportion rather than fighting
 * over it, so a clip trimmed shorter than its own fades still resolves to a
 * clean in-and-out instead of jumping. An unbounded window (a clip with no
 * duration) can only fade in — there is no end to fade out of.
 */
export function clipFadeLevelAt(fade: HfClipFade, elapsed: number, duration: number): number {
  if (elapsed <= 0 && fade.fadeIn > 0) return 0;
  const finite = Number.isFinite(duration) && duration > 0;
  let { fadeIn, fadeOut } = fade;
  if (finite && fadeIn + fadeOut > duration) {
    const total = fadeIn + fadeOut;
    fadeIn = (fadeIn / total) * duration;
    fadeOut = (fadeOut / total) * duration;
  }
  if (!finite) fadeOut = 0;

  let level = 1;
  if (fadeIn > 0 && elapsed < fadeIn) {
    level = Math.min(level, fadeEase(elapsed / fadeIn, fade.curve));
  }
  if (fadeOut > 0) {
    const remaining = duration - elapsed;
    if (remaining < fadeOut) {
      level = Math.min(level, fadeEase(Math.max(0, remaining) / fadeOut, fade.curve));
    }
  }
  return level <= 0 ? 0 : level >= 1 ? 1 : level;
}

/**
 * The CSS `filter` a faded clip should carry, composed onto whatever filter the
 * author wrote. `filter`, not `opacity`: opacity is the property animation
 * engines drive, and a runtime that writes it every frame fights them for it —
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
